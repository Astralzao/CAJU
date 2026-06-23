import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { DEFAULT_SPREADSHEETS } from "./src/data/defaultSheets.js";

// Load environment variables from .env
dotenv.config();

const DB_PATH = path.join(process.cwd(), "spreadsheets-db.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "destine26";

// In-memory cache for Vercel/Serverless where file system is read-only
let globalInMemorySpreadsheets: any[] | null = null;

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

async function loadSpreadsheets(customUrl?: string, customTabs?: string): Promise<any[]> {
  const googleSheetUrl = customUrl || process.env.GOOGLE_SHEET_URL;
  const googleSheetTabs = customTabs || process.env.GOOGLE_SHEET_TABS || "Geral,Protocolos_Saude,Fornecedores_Principais";

  if (googleSheetUrl) {
    try {
      const sheetIdMatch = googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (sheetIdMatch) {
        const sheetId = sheetIdMatch[1];
        const tabsList = googleSheetTabs.split(",").map(t => t.trim());
        const fetchedTabs: any[] = [];

        for (const tabName of tabsList) {
          const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
          const response = await fetch(exportUrl);
          if (response.ok) {
            const csvText = await response.text();
            const parsedLines = parseCSV(csvText);
            if (parsedLines.length > 0) {
              const headers = parsedLines[0].map((h: string) => h.trim());
              const rows = parsedLines.slice(1).map((rowArr: string[]) => {
                const rowObj: any = {};
                headers.forEach((header: string, index: number) => {
                  if (header) {
                    rowObj[header] = rowArr[index] !== undefined ? rowArr[index].trim() : "";
                  }
                });
                return rowObj;
              }).filter(row => Object.values(row).some(val => val !== ""));

              fetchedTabs.push({
                name: tabName,
                headers: headers.filter((h: string) => h !== ""),
                rows: rows
              });
            }
          } else {
            console.error(`Erro ao buscar aba ${tabName} do Google Sheets: ${response.statusText}`);
          }
        }

        if (fetchedTabs.length > 0) {
          return [{
            id: "google-sheet",
            name: "Planilha Integrada (Google Sheets)",
            rawFileName: "Google Sheets Live",
            updatedAt: new Date().toLocaleDateString("pt-BR"),
            tabs: fetchedTabs
          }];
        }
      }
    } catch (err) {
      console.error("Erro ao carregar dados do Google Sheets:", err);
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

// Public GET spreadsheets
app.get("/api/spreadsheets", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const customUrl = req.query.customUrl as string;
  const customTabs = req.query.customTabs as string;
  const sheets = await loadSpreadsheets(customUrl, customTabs);
  res.json({ spreadsheets: sheets });
});

// Protected POST spreadsheets
app.post("/api/spreadsheets", checkAdminAuth, (req: Request, res: Response) => {
  const { spreadsheets } = req.body;
  if (!Array.isArray(spreadsheets)) {
    res.status(400).json({ error: "O campo 'spreadsheets' deve ser uma lista válida." });
    return;
  }
  saveSpreadsheets(spreadsheets);
  res.json({ spreadsheets });
});

// Protected POST reset spreadsheets to defaults
app.post("/api/spreadsheets/reset", checkAdminAuth, (req: Request, res: Response) => {
  saveSpreadsheets(DEFAULT_SPREADSHEETS);
  res.json({ spreadsheets: DEFAULT_SPREADSHEETS });
});


// Query Endpoint for Sheet Chat
app.post("/api/chat", async (req: Request, res: Response) => {
  try {
    const { message, history, customApiKey, customGoogleSheetUrl, customGoogleSheetTabs } = req.body;

    if (!message) {
       res.status(400).json({ error: "Mensagem é obrigatória." });
       return;
    }

    const activeApiKey = customApiKey || apiKey;

    if (!activeApiKey) {
       res.status(400).json({ 
        error: "GEMINI_API_KEY não configurada. Por favor, adicione sua chave de API nas configurações ou use a opção de Chave de API Personalizada no painel." 
      });
      return;
    }

    // Initialize client for this request with the appropriate key
    const ai = new GoogleGenAI({
      apiKey: activeApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    const sheets = await loadSpreadsheets(customGoogleSheetUrl, customGoogleSheetTabs);

    // 1. Format Sheet Data for the prompt context
    let sheetsContextText = "";
    if (sheets && Array.isArray(sheets) && sheets.length > 0) {
      sheetsContextText = "--- DADOS DAS PLANILHAS ALIMENTADAS ---\n\n";
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
              rows.forEach((row: any, idx: number) => {
                const rowCells = headers.map((h: string) => `${h}: ${row[h] !== undefined ? row[h] : ""}`);
                sheetsContextText += `    [Resgistro ${idx + 1}] ${rowCells.join(", ")}\n`;
              });
            } else {
              sheetsContextText += `  (Esta aba está vazia)\n`;
            }
            sheetsContextText += `\n`;
          });
        }
        sheetsContextText += `------------------------------------\n\n`;
      });
    } else {
      sheetsContextText = "Nenhuma planilha foi alimentada até o momento. O usuário ainda não carregou dados. Oriente-o com gentileza a carregar suas planilhas de contatos, escala ou contingência utilizando o painel lateral.";
    }

    // 2. Build system instruction
    const systemInstruction = `Você é um Assistente Especialista de Consultas a Planilhas do evento/operação.
Seu objetivo é dar respostas extremamente diretas, gentis, precisas e profissionais baseadas APENAS nos dados fornecidos de planilhas.

Regras fundamentais de resposta:
1. Sempre indique em qual planilha, aba e registro você encontrou as informações buscadas (ex: "Conforme a aba 'Geral' da planilha 'Conselheiros'...").
2. Caso encontre múltiplos resultados semelhantes, apresente-os de forma clara em tópicos com todos os detalhes disponíveis (ex: nome, contato, telefone, cargo, e-mail).
3. Se a pergunta do usuário não contiver resposta nos dados das planilhas, diga de forma muito gentil e objetiva que não pôde encontrar essa informação específica nos dados carregados, mas mencione o que você encontrou de mais próximo caso haja algo parecido.
4. NUNCA invente fatos ou dados. Mantenha os contatos e instruções exatamente como escritos nas tabelas.
5. Se o usuário estiver perguntando sobre o que fazer em uma emergência ou descumprimento de fornecedor, cite exatamente os procedimentos (coluna 'O que fazer', 'Conduta', 'Procedimento' ou similar) e os contatos úteis e responsáveis listados.
6. Responda em português brasileiro. Use um tom calmo, profissional e eficiente de organizador de evento corporativo de alto nível.
`;

    // 3. Prepare Chat Prompt / Contents
    // We send previous messages to construct the conversation flow
    const formattedContents: any[] = [];
    
    // Add history
    if (history && Array.isArray(history)) {
      history.forEach((msg: any) => {
        formattedContents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }]
        });
      });
    }

    // Append the spreadsheets context and new user message
    // Putting context together with user prompt ensures it is grounded in the latest session upload
    const userPromptWithContext = `Aqui estão as planilhas disponíveis atuais:\n\n${sheetsContextText}\n\nPERGUNTA DO USUÁRIO:\n${message}`;
    
    formattedContents.push({
      role: "user",
      parts: [{ text: userPromptWithContext }]
    });

    // 4. Generate Content with Gemini model
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: formattedContents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2, // Low temperature for high accuracy/grounding in tabular data
      }
    });

    const reply = response.text || "Não foi possível gerar uma resposta para essa pergunta.";
    res.json({ reply });

  } catch (err: any) {
    console.error("Error calling Gemini API:", err);
    res.status(500).json({ 
      error: "Houve um erro técnico ao processar sua pergunta pelo Gemini.",
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
