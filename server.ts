import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import * as XLSX from "xlsx";
import { GoogleGenAI } from "@google/genai";
import { DEFAULT_SPREADSHEETS } from "./src/data/defaultSheets.js";

// Load environment variables from .env
dotenv.config();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "destine26";

function getWritablePath(filename: string): string {
  const localPath = path.join(process.cwd(), filename);
  try {
    const testFile = path.join(process.cwd(), `.test-write-${Date.now()}`);
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
    return localPath;
  } catch (e) {
    return path.join("/tmp", filename);
  }
}

const DB_PATH = getWritablePath("spreadsheets-db.json");
const CONFIG_PATH = getWritablePath("config-db.json");

// Load Google Sheet configuration from file or env variables
function readConfig() {
  const config = {
    url: process.env.GOOGLE_SHEET_URL || "",
    tabs: process.env.GOOGLE_SHEET_TABS || ""
  };
  
  try {
    // Try primary CONFIG_PATH (which might be in /tmp)
    if (fs.existsSync(CONFIG_PATH)) {
      const savedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      if (savedConfig.url !== undefined) config.url = savedConfig.url;
      if (savedConfig.tabs !== undefined) config.tabs = savedConfig.tabs;
      return config;
    }
    
    // Fallback to local process.cwd() file if primary config isn't populated yet
    const localConfigPath = path.join(process.cwd(), "config-db.json");
    if (CONFIG_PATH !== localConfigPath && fs.existsSync(localConfigPath)) {
      const savedConfig = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
      if (savedConfig.url !== undefined) config.url = savedConfig.url;
      if (savedConfig.tabs !== undefined) config.tabs = savedConfig.tabs;
    }
  } catch (err) {
    console.error("Erro ao carregar configuração de planilhas do Google Sheets:", err);
  }
  return config;
}

let serverGoogleSheetConfig = readConfig();

// In-memory cache for Vercel/Serverless where file system is read-only
let globalInMemorySpreadsheets: any[] | null = null;

// Cache specifically for Google Sheets download to avoid rate-limiting and high serverless bills
let cachedGoogleSheetData: {
  url: string;
  tabs: string;
  timestamp: number;
  data: any;
} | null = null;

// Load / Save Helpers
function parseCSV(csvText: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let entry = "";
  
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        entry += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(entry);
      entry = "";
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(entry);
      lines.push(row);
      row = [];
      entry = "";
    } else {
      entry += char;
    }
  }
  
  if (entry || row.length > 0) {
    row.push(entry);
    lines.push(row);
  }
  
  return lines;
}

async function loadSpreadsheets(customUrl?: string, customTabs?: string, forceUpdate?: boolean): Promise<any[]> {
  const googleSheetUrl = customUrl !== undefined ? customUrl : serverGoogleSheetConfig.url;
  let googleSheetTabs = customTabs !== undefined ? customTabs : serverGoogleSheetConfig.tabs;

  let otherSheets: any[] = [];
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, "utf8");
      const saved = JSON.parse(data);
      if (Array.isArray(saved)) {
        otherSheets = saved.filter(s => s && s.id !== "google-sheet");
      }
    } else if (globalInMemorySpreadsheets && Array.isArray(globalInMemorySpreadsheets)) {
      otherSheets = globalInMemorySpreadsheets.filter(s => s && s.id !== "google-sheet");
    }
  } catch (err) {
    console.error("Erro ao ler banco de dados de planilhas para mesclagem:", err);
  }

  if (googleSheetUrl) {
    // 2-minute cache to prevent redundant fetches from concurrent client polling
    const now = Date.now();
    const cacheKeyTabs = googleSheetTabs || "";
    if (!forceUpdate && 
        cachedGoogleSheetData && 
        cachedGoogleSheetData.url === googleSheetUrl && 
        cachedGoogleSheetData.tabs === cacheKeyTabs && 
        (now - cachedGoogleSheetData.timestamp) < 120000) {
      console.log("Servindo planilha integrada do cache em memória (Poupando Vercel/Google Sheets)");
      return [cachedGoogleSheetData.data, ...otherSheets];
    }

    try {
      const isPublished = googleSheetUrl.includes("/d/e/");
      let sheetId = "";
      if (isPublished) {
        const match = googleSheetUrl.match(/\/d\/e\/([a-zA-Z0-9-_]+)/);
        if (match) sheetId = match[1];
      } else {
        const match = googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match) sheetId = match[1];
      }

      if (!sheetId) {
        throw new Error("URL do Google Sheets inválida. Certifique-se de copiar o link completo do seu navegador.");
      }

      // Fetch the entire spreadsheet as an .xlsx file! This gets ALL tabs automatically!
      const exportUrl = isPublished
        ? `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=xlsx`
        : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;

      console.log(`Buscando planilha remota via XLSX: ${exportUrl}`);
      const response = await fetch(exportUrl);
      if (!response.ok) {
        throw new Error("Não foi possível acessar a planilha. Verifique se o compartilhamento está como 'Qualquer pessoa com o link pode ler' (Leitor) ou se o documento está 'Publicado na Web'.");
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        const text = await response.text();
        if (text.includes("Google Accounts") || text.includes("login") || text.includes("signin")) {
          throw new Error("A planilha do Google Sheets parece estar PRIVADA ou restrita. No Google Sheets, clique em 'Compartilhar' no topo direito, altere o 'Acesso geral' de 'Restrito' para 'Qualquer pessoa com o link' (como Leitor), salve e tente novamente!");
        }
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Parse the .xlsx workbook
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const fetchedTabs: any[] = [];

      // Determine list of tabs to load (if specified)
      const tabsList = googleSheetTabs 
        ? googleSheetTabs.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
        : [];

      workbook.SheetNames.forEach((sheetName) => {
        // If specific tabs were specified, filter by them (case-insensitive)
        if (tabsList.length > 0 && !tabsList.includes(sheetName.toLowerCase())) {
          return;
        }

        const worksheet = workbook.Sheets[sheetName];
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as Array<Record<string, any>>;
        
        if (rawJson.length > 0) {
          // Extract unique keys as headers
          const headers = Array.from(
            new Set(rawJson.flatMap((row) => Object.keys(row)))
          );
          
          fetchedTabs.push({
            name: sheetName,
            headers: headers.filter((h: string) => h && h.trim() !== ""),
            rows: rawJson.map((row) => {
              const newRow: Record<string, any> = {};
              headers.forEach((h) => {
                newRow[h] = row[h] !== undefined ? String(row[h]).trim() : "";
              });
              return newRow;
            }).filter(row => Object.values(row).some(val => val !== ""))
          });
        }
      });

      if (fetchedTabs.length > 0) {
        const googleSheetObj = {
          id: "google-sheet",
          name: "Planilha Integrada (Google Sheets)",
          rawFileName: "Google Sheets Live",
          updatedAt: new Date().toLocaleDateString("pt-BR"),
          tabs: fetchedTabs
        };
        // Update the global cache
        cachedGoogleSheetData = {
          url: googleSheetUrl,
          tabs: googleSheetTabs || "",
          timestamp: Date.now(),
          data: googleSheetObj
        };
        return [googleSheetObj, ...otherSheets];
      } else {
        throw new Error("Não foi possível encontrar nenhum dado válido nas abas de sua Planilha Google.");
      }
    } catch (err: any) {
      console.error("Erro ao carregar dados do Google Sheets:", err);
      throw err;
    }
  }

  // Fallback to in-memory, local file, or default spreadsheets
  if (globalInMemorySpreadsheets) {
    return globalInMemorySpreadsheets;
  }

  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, "utf8");
      const sheets = JSON.parse(data);
      globalInMemorySpreadsheets = sheets;
      return sheets;
    }
    
    // Fallback to local process.cwd() file if primary DB_PATH is in /tmp and doesn't exist yet
    const localDbPath = path.join(process.cwd(), "spreadsheets-db.json");
    if (DB_PATH !== localDbPath && fs.existsSync(localDbPath)) {
      const data = fs.readFileSync(localDbPath, "utf8");
      const sheets = JSON.parse(data);
      globalInMemorySpreadsheets = sheets;
      return sheets;
    }
  } catch (err) {
    console.error("Erro ao ler banco de planilhas local, usando dados padrão:", err);
  }

  // Initialize with defaults and save
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_SPREADSHEETS, null, 2), "utf8");
  } catch (err) {
    console.error("Erro ao criar banco inicial com planilhas padrão (esperado em ambiente serverless):", err);
  }
  globalInMemorySpreadsheets = DEFAULT_SPREADSHEETS;
  return DEFAULT_SPREADSHEETS;
}

function saveSpreadsheets(sheets: any[]) {
  globalInMemorySpreadsheets = sheets;
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(sheets, null, 2), "utf8");
  } catch (err) {
    console.error("Erro ao salvar planilhas no arquivo (esperado em ambiente serverless):", err);
  }
}

// Authentication Middleware for Admins
function checkAdminAuth(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;
  const password = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  
  if (password === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: "Acesso restrito. Senha de administração incorreta ou ausente." });
  }
}

// Ensure GEMINI_API_KEY is available or output a placeholder error
const apiKey = process.env.GEMINI_API_KEY;

// Initialize GoogleGenAI SDK lazily/safely
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    if (!apiKey) {
      console.warn("warning: GEMINI_API_KEY environment variable is not set. Gemini features will require this key.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey || "placeholder-key",
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

const app = express();
const PORT = 3000;

// Body parsing logic
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Server API Routes
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
});

// Authentication verify endpoint
app.post("/api/auth", (req: Request, res: Response) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: "Senha de administração inválida." });
  }
});

// GET global Google Sheet config
app.get("/api/config", (req: Request, res: Response) => {
  res.json(serverGoogleSheetConfig);
});

// POST update global Google Sheet config
app.post("/api/config", checkAdminAuth, (req: Request, res: Response) => {
  const { url, tabs } = req.body;
  if (url !== undefined) serverGoogleSheetConfig.url = url;
  if (tabs !== undefined) serverGoogleSheetConfig.tabs = tabs;
  
  // Invalidate Google Sheet cache on configuration update
  cachedGoogleSheetData = null;
  
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(serverGoogleSheetConfig, null, 2), "utf8");
  } catch (err) {
    console.error("Erro ao salvar config no arquivo:", err);
  }
  
  res.json({ success: true, config: serverGoogleSheetConfig });
});

// Public GET spreadsheets
app.get("/api/spreadsheets", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const customUrl = req.query.customUrl as string;
  const customTabs = req.query.customTabs as string;
  const forceUpdate = req.query.force === "true";
  try {
    const sheets = await loadSpreadsheets(customUrl, customTabs, forceUpdate);
    res.json({ spreadsheets: sheets });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Erro desconhecido ao carregar planilhas." });
  }
});

// Protected POST spreadsheets
app.post("/api/spreadsheets", checkAdminAuth, (req: Request, res: Response) => {
  const { spreadsheets } = req.body;
  if (!Array.isArray(spreadsheets)) {
    res.status(400).json({ error: "O campo 'spreadsheets' deve ser uma lista válida." });
    return;
  }
  cachedGoogleSheetData = null; // Clear cache on manual update
  saveSpreadsheets(spreadsheets);
  res.json({ spreadsheets });
});

// Protected POST reset spreadsheets to defaults
app.post("/api/spreadsheets/reset", checkAdminAuth, (req: Request, res: Response) => {
  cachedGoogleSheetData = null; // Clear cache on reset
  saveSpreadsheets(DEFAULT_SPREADSHEETS);
  res.json({ spreadsheets: DEFAULT_SPREADSHEETS });
});


// Query Endpoint for Sheet Chat
app.post("/api/chat", async (req: Request, res: Response) => {
  try {
    const { 
      message, 
      history, 
      customApiKey, 
      apiProvider = "gemini", 
      apiModel, 
      customGoogleSheetUrl, 
      customGoogleSheetTabs, 
      clientSpreadsheets 
    } = req.body;

    if (!message) {
       res.status(400).json({ error: "Mensagem é obrigatória." });
       return;
    }

    // Find the correct API Key based on provider
    let activeApiKey = customApiKey;
    if (!activeApiKey) {
      if (apiProvider === "groq") {
        activeApiKey = process.env.GROQ_API_KEY;
      } else if (apiProvider === "openai") {
        activeApiKey = process.env.OPENAI_API_KEY;
      } else {
        activeApiKey = process.env.GEMINI_API_KEY || apiKey;
      }
    }

    if (!activeApiKey) {
       const providerName = apiProvider === "groq" ? "Groq" : apiProvider === "openai" ? "OpenAI" : "Gemini";
       const envVarName = apiProvider === "groq" ? "GROQ_API_KEY" : apiProvider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY";
       res.status(400).json({ 
         error: `Chave de API do ${providerName} não configurada. Por favor, adicione sua chave de API nas variáveis de ambiente (${envVarName}) ou use a opção de Chave de API Personalizada no painel.` 
       });
       return;
    }

    let sheets: any[] = [];
    let loadError: string | null = null;

    try {
      const targetUrl = customGoogleSheetUrl || serverGoogleSheetConfig.url;
      const targetTabs = customGoogleSheetUrl ? customGoogleSheetTabs : serverGoogleSheetConfig.tabs;
      if (targetUrl) {
        sheets = await loadSpreadsheets(targetUrl, targetTabs);
      }
    } catch (err: any) {
      console.error("Erro ao carregar Google Sheets para o chat:", err);
      loadError = err.message || "Erro desconhecido ao carregar planilha Google.";
    }

    // Merge client-sent uploaded spreadsheets
    if (clientSpreadsheets && Array.isArray(clientSpreadsheets) && clientSpreadsheets.length > 0) {
      const hasGoogleSheet = sheets.some((s: any) => s.id === "google-sheet");
      const filteredClient = hasGoogleSheet
        ? clientSpreadsheets.filter((s: any) => s.id !== "google-sheet")
        : clientSpreadsheets;
      sheets = [...sheets, ...filteredClient];
    } else if (sheets.length === 0) {
      // Fallback to server side loaded defaults if nothing else is active
      try {
        const serverSheets = await loadSpreadsheets();
        sheets = [...sheets, ...serverSheets];
      } catch (e) {}
    }

    // 1. Extrair termos de busca inteligentes da mensagem atual e das últimas mensagens do histórico
    const userMessageLower = message.toLowerCase();
    const historyText = (history && Array.isArray(history)) 
      ? history.slice(-2).map((h: any) => h.content.toLowerCase()).join(" ") 
      : "";
    const combinedTextForSearch = `${userMessageLower} ${historyText}`;
    
    const searchTerms = combinedTextForSearch
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
      .split(/\s+/)
      .filter((term: string) => term.length > 2 && !["dos", "das", "com", "para", "uma", "uns", "por", "sobre", "como", "quem", "qual", "onde", "quando", "quais", "esta", "este", "esse", "essa", "tudo", "nada", "que", "ele", "ela", "dele", "dela", "nos", "nas", "aos", "aas"].includes(term));

    // 2. Format Sheet Data for the prompt context with smart filtering (RAG)
    let sheetsContextText = "";
    if (sheets && Array.isArray(sheets) && sheets.length > 0) {
      sheetsContextText = "--- DADOS DAS PLANILHAS ALIMENTADAS (Filtrados por relevância para economizar limite de tokens) ---\n\n";
      
      // Calcular total de linhas para decidir se precisa de filtragem agressiva
      let totalLinesInAllSheets = 0;
      sheets.forEach((sheet: any) => {
        if (sheet.tabs && Array.isArray(sheet.tabs)) {
          sheet.tabs.forEach((tab: any) => {
            if (tab.rows && Array.isArray(tab.rows)) {
              totalLinesInAllSheets += tab.rows.length;
            }
          });
        }
      });

      const useSmartFiltering = totalLinesInAllSheets > 25;

      sheets.forEach((sheet: any) => {
        sheetsContextText += `PLANILHA: "${sheet.name}" (Arquivo original: ${sheet.rawFileName || "Nulo"})\n`;
        if (sheet.tabs && Array.isArray(sheet.tabs)) {
          sheet.tabs.forEach((tab: any) => {
            sheetsContextText += `  ABA: "${tab.name}"\n`;
            
            // Format headers
            const headers = tab.headers || [];
            if (headers.length > 0) {
              sheetsContextText += `  Colunas: [${headers.join(" | ")}]\n`;
            }
            
            // Format rows
            const rows = tab.rows || [];
            if (rows.length > 0) {
              sheetsContextText += `  Linhas:\n`;
              let includedCount = 0;
              let matchedCount = 0;

              rows.forEach((row: any, idx: number) => {
                const rowCellsText = headers.map((h: string) => `${row[h] !== undefined ? row[h] : ""}`).join(" ").toLowerCase();
                
                // Se não usarmos filtragem (planilha pequena), ou se houver correspondência com algum termo de busca
                const isMatch = !useSmartFiltering || searchTerms.length === 0 || searchTerms.some((term: string) => rowCellsText.includes(term));
                
                if (isMatch) {
                  const rowCells = headers.map((h: string) => `${h}: ${row[h] !== undefined ? row[h] : ""}`);
                  sheetsContextText += `    [Registro ${idx + 1}] ${rowCells.join(", ")}\n`;
                  includedCount++;
                  if (useSmartFiltering && searchTerms.length > 0) matchedCount++;
                }
              });

              // Se usou filtragem e não encontrou nada na aba, mostra as 5 primeiras linhas como amostra geral
              if (useSmartFiltering && includedCount === 0) {
                sheetsContextText += `    (Nenhuma linha correspondeu diretamente aos termos de busca: [${searchTerms.join(", ")}]. Exibindo primeiras linhas de amostra geral:)\n`;
                rows.slice(0, 5).forEach((row: any, idx: number) => {
                  const rowCells = headers.map((h: string) => `${h}: ${row[h] !== undefined ? row[h] : ""}`);
                  sheetsContextText += `    [Registro ${idx + 1}] ${rowCells.join(", ")}\n`;
                });
              } else if (useSmartFiltering && matchedCount > 0) {
                sheetsContextText += `    (Nota: Foram filtrados ${matchedCount} registros relevantes de um total de ${rows.length} desta aba para economizar limite de tokens)\n`;
              }
            } else {
              sheetsContextText += `  (Esta aba está vazia)\n`;
            }
            sheetsContextText += `\n`;
          });
        }
        sheetsContextText += `------------------------------------\n\n`;
      });

      if (loadError) {
        sheetsContextText += `⚠️ AVISO DE SINAL: O usuário tentou sincronizar uma planilha remota do Google Sheets, mas ocorreu o seguinte erro: "${loadError}". Explique de forma amigável essa limitação caso ele pergunte por esses dados.\n\n`;
      }
    } else {
      sheetsContextText = "Nenhuma planilha foi alimentada até o momento. O usuário ainda não carregou dados. Oriente-o com gentileza a carregar suas planilhas de contatos, escala ou contingência utilizando o painel lateral.";
    }

    // 2. Build system instruction
    const systemInstruction = `Você é um Consultor Estratégico e Assistente Especialista da operação/evento.
Seu objetivo é auxiliar a equipe tanto na consulta precisa de dados operacionais (planilhas) quanto na análise estratégica, gerenciamento de riscos, e resolução de problemas utilizando metodologias consagradas de mercado.

Suas diretrizes de comportamento e resposta:

1. CONSULTA DE DADOS (PLANILHAS):
   - Ao responder perguntas diretas sobre contatos, escalas, contingências ou escalas das planilhas, seja preciso, direto e conciso.
   - Cite explicitamente a aba de origem (ex: "De acordo com a aba 'X': [resposta]"). Não invente dados de contato ou horários. Se uma informação pontual não existir nas tabelas, informe de forma honesta que o dado específico não consta nas bases atuais.

2. DIRETRIZ CRÍTICA DE RESOLUÇÃO (EMBAIXADORES E AUTONOMIA DO STAFF):
   - Ao sugerir qualquer solução, plano de contingência, análise de riscos ou resposta a um incidente/problema, você deve OBRIGATORIAMENTE indicar no INÍCIO da resposta os nomes dos responsáveis/embaixadores relevantes encontrados na aba "EMBAIXADORES" ou contatos das planilhas.
   - ATENÇÃO: Trate a presença física do embaixador como uma possibilidade. Em casos críticos/graves, a presença dele é certa. No entanto, em casos menos graves ou urgentes, o staff pode ter que resolver a situação de forma autônoma, seja recebendo apenas direcionamentos rápidos via rádio, ou até mesmo sem conseguir contato imediato.
   - Portanto, NÃO condicione todo o plano de ação à presença física ou ação exclusiva do embaixador. O plano deve dar total autonomia técnica e prática ao usuário/staff na linha de frente para que consiga agir de imediato e de forma independente, utilizando as diretrizes e metodologias descritas na resposta.
   - Esclareça de forma explícita que, caso a situação não possa ser resolvida imediatamente de forma autônoma pelo próprio usuário, ele precisará entrar em contato com um dos embaixadores indicados para obter melhores soluções.
   - Exemplo de cabeçalho inicial de contatos (respeitando as regras de formatação sem markdown):
     RESPONSÁVEIS DE EMBAIXADORES PARA ESTA SITUAÇÃO:
     - [Nome] (Atribuição/Segmento): [Instrução ou contato se disponível]

3. AUTONOMIA ANALÍTICA E CONHECIMENTO GERAL (RESOLUÇÃO E RISCOS):
   - Quando o usuário solicitar auxílio para resolver problemas, analisar riscos ou planejar ações que vão além dos dados exatos das planilhas, use ativamente seu conhecimento geral e metodologias profissionais reconhecidas (ex: Matriz SWOT/FOFA, Matriz de Risco/Probabilidade x Impacto, GUT, FMEA, Planejamento de Contingência, Metodologia Ágil, PMBOK, etc.).
   - Faça análises de riscos estruturadas, sugira planos de ação práticos, proponha estratégias de mitigação e forneça resoluções fundamentadas de forma proativa.
   - Combine os dados das planilhas com as melhores práticas de mercado para dar respostas ricas e aplicáveis.

4. REGRAS CRÍTICAS DE FORMATAÇÃO (TEXTO LIMPO SEM CARACTERES ESPECIAIS DE MARKDOWN):
   - Você está TERMINANTEMENTE PROIBIDO de usar caracteres especiais de formatação Markdown em suas respostas.
   - NÃO use asteriscos duplos (**) ou simples (*) para fazer negritos ou itálicos.
   - NÃO use hashtags ou símbolos cardinais (#, ##, ###, ####) para criar títulos. Use apenas letras maiúsculas para destacar títulos (exemplo: "PASSO 1: ISOLAMENTO E CONFORTO").
   - NÃO use barras verticais (|) ou hífen/sinal de igual múltiplo (---, ===) para fazer tabelas ou divisores de página. Se precisar listar dados estruturados, use listas textuais simples com quebras de linha e hífens comuns.
   - Use apenas hífens comuns (-) ou números normais para tópicos, e quebras de linha duplas para parágrafos.
   - Mantenha a resposta limpa, profissional, legível e em formato de texto totalmente puro, sem marcas visuais do Markdown.
`;

    // 3. Prepare Chat Prompt / Contents based on Provider
    let reply = "";

    if (apiProvider === "gemini") {
      // Format history and prompt for Gemini
      const formattedContents: any[] = [];
      if (history && Array.isArray(history)) {
        history.forEach((msg: any) => {
          formattedContents.push({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
          });
        });
      }

      const userPromptWithContext = `Aqui estão as planilhas disponíveis atuais:\n\n${sheetsContextText}\n\nPERGUNTA DO USUÁRIO:\n${message}`;
      formattedContents.push({
        role: "user",
        parts: [{ text: userPromptWithContext }]
      });

      // Initialize client for this request with the appropriate key
      const ai = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const response = await ai.models.generateContent({
        model: apiModel || "gemini-3.5-flash",
        contents: formattedContents,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.4, // Balanced temperature for both high accuracy in tabular data and analytical capabilities
        }
      });

      reply = response.text || "Não foi possível gerar uma resposta para essa pergunta.";
    } else {
      // Format messages for OpenAI / Groq (OpenAI-compatible)
      const messagesArray: any[] = [
        { role: "system", content: systemInstruction }
      ];

      if (history && Array.isArray(history)) {
        history.forEach((msg: any) => {
          messagesArray.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: msg.content
          });
        });
      }

      const userPromptWithContext = `Aqui estão as planilhas disponíveis atuais:\n\n${sheetsContextText}\n\nPERGUNTA DO USUÁRIO:\n${message}`;
      messagesArray.push({
        role: "user",
        content: userPromptWithContext
      });

      let endpoint = "https://api.openai.com/v1/chat/completions";
      let defaultModel = "gpt-4o-mini";
      let finalModel = apiModel;

      if (apiProvider === "groq") {
        endpoint = "https://api.groq.com/openai/v1/chat/completions";
        defaultModel = "llama-3.1-8b-instant";
        if (finalModel === "llama-3.3-70b-versatile" || !finalModel) {
          finalModel = "llama-3.1-8b-instant";
        }
      } else {
        if (!finalModel) finalModel = defaultModel;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${activeApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: finalModel,
          messages: messagesArray,
          temperature: 0.2
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `Erro da API ${apiProvider} (Código ${response.status})`);
      }

      const responseData = await response.json();
      reply = responseData.choices?.[0]?.message?.content || "Não foi possível obter resposta do provedor de IA.";
    }

    res.json({ reply });

  } catch (err: any) {
    const provider = req.body?.apiProvider || "gemini";
    console.error(`Error calling ${provider} API:`, err);
    res.status(500).json({ 
      error: `Houve um erro técnico ao processar sua pergunta pelo ${provider}.`,
      details: err.message || err 
    });
  }
});

// Setup Vite Dev server or production static serving
async function buildApp() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development middleware integrated.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Static files served in production mode.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (process.env.VERCEL !== "1") {
  buildApp();
}

export default app;
