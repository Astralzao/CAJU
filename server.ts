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
const KEY_STATS_PATH = getWritablePath("gemini-key-stats.json");

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

// API Key Pool and Token Tracker for Gemini
interface KeyStats {
  keyIndex: number;
  maskedKey: string;
  successCount: number;
  errorCount: number;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  lastUsed: string | null;
  status: "active" | "rate_limited" | "invalid";
  statusReason?: string;
  cooldownUntil?: number; // timestamp
}

let geminiKeyPool: string[] = [];
let geminiKeyStats: Record<number, KeyStats> = {};

function loadGeminiKeyStats() {
  try {
    if (fs.existsSync(KEY_STATS_PATH)) {
      const data = JSON.parse(fs.readFileSync(KEY_STATS_PATH, "utf8"));
      // Validate that it's a valid object
      if (data && typeof data === "object") {
        geminiKeyStats = data;
        console.log("📂 [STAT PERSISTENCE] Estatísticas carregadas com sucesso do disco.");
      }
    }
  } catch (err) {
    console.error("❌ Erro ao carregar estatísticas do pool de chaves do disco:", err);
  }
}

function saveGeminiKeyStats() {
  try {
    fs.writeFileSync(KEY_STATS_PATH, JSON.stringify(geminiKeyStats, null, 2), "utf8");
  } catch (err) {
    console.error("❌ Erro ao salvar estatísticas do pool de chaves no disco:", err);
  }
}

// Helper to initialize the pool
function initGeminiKeyPool() {
  const pool: string[] = [];
  
  // 1. Check GEMINI_API_KEY_1 to GEMINI_API_KEY_10
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key && key.trim()) {
      pool.push(key.trim());
    }
  }
  
  // 2. Check comma-separated GEMINI_API_KEY
  const mainKey = process.env.GEMINI_API_KEY || apiKey;
  if (mainKey) {
    if (mainKey.includes(",")) {
      const parts = mainKey.split(",").map(k => k.trim()).filter(Boolean);
      parts.forEach(part => {
        if (!pool.includes(part)) {
          pool.push(part);
        }
      });
    } else {
      if (mainKey.trim() && !pool.includes(mainKey.trim()) && mainKey !== "placeholder-key") {
        pool.unshift(mainKey.trim());
      }
    }
  }

  // Deduplicate
  geminiKeyPool = [...new Set(pool)];

  // Load existing persistent stats
  loadGeminiKeyStats();

  const freshStats: Record<number, KeyStats> = {};
  
  // Re-map or create stats keeping past historic metrics
  geminiKeyPool.forEach((key, index) => {
    const masked = key.length > 10 
      ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}`
      : "Chave curta";
      
    // Try to find if we already have stats for this masked key at any index
    let existing: KeyStats | undefined = undefined;
    
    // Search by masked key to preserve history even if environment reorders them
    const matchedIndex = Object.keys(geminiKeyStats).find(
      kIdx => geminiKeyStats[Number(kIdx)]?.maskedKey === masked
    );
    
    if (matchedIndex !== undefined) {
      existing = geminiKeyStats[Number(matchedIndex)];
    } else if (geminiKeyStats[index]) {
      // Fallback matching by index
      existing = geminiKeyStats[index];
    }

    if (existing) {
      freshStats[index] = {
        keyIndex: index,
        maskedKey: masked,
        successCount: existing.successCount || 0,
        errorCount: existing.errorCount || 0,
        promptTokens: existing.promptTokens || 0,
        candidatesTokens: existing.candidatesTokens || 0,
        totalTokens: existing.totalTokens || 0,
        lastUsed: existing.lastUsed || null,
        status: existing.status === "active" ? "active" : existing.status, // preserve if rate_limited / invalid
        statusReason: existing.statusReason,
        cooldownUntil: existing.cooldownUntil
      };
    } else {
      freshStats[index] = {
        keyIndex: index,
        maskedKey: masked,
        successCount: 0,
        errorCount: 0,
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        lastUsed: null,
        status: "active"
      };
    }
  });

  geminiKeyStats = freshStats;
  saveGeminiKeyStats();

  console.log(`🔑 Pool de Chaves Gemini carregado: ${geminiKeyPool.length} chaves configuradas.`);
}

function getNextAvailableGeminiKeyIndex(startIndex = 0): number {
  if (geminiKeyPool.length === 0) return -1;
  
  const now = Date.now();
  
  // First, look for any active key that isn't cooling down, starting from startIndex
  for (let i = 0; i < geminiKeyPool.length; i++) {
    const index = (startIndex + i) % geminiKeyPool.length;
    const stats = geminiKeyStats[index];
    
    if (stats.status === "active") {
      return index;
    }
    
    if (stats.cooldownUntil && now > stats.cooldownUntil) {
      // Cooldown expired, restore status to active
      stats.status = "active";
      stats.statusReason = undefined;
      stats.cooldownUntil = undefined;
      return index;
    }
  }
  
  // If all are rate-limited, fallback to the one with the earliest cooldown expiration, or index 0
  let bestIndex = 0;
  let minCooldown = Infinity;
  for (let i = 0; i < geminiKeyPool.length; i++) {
    const stats = geminiKeyStats[i];
    if (stats.cooldownUntil && stats.cooldownUntil < minCooldown) {
      minCooldown = stats.cooldownUntil;
      bestIndex = i;
    }
  }
  
  return bestIndex;
}

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

// Endpoint to view API Key pool statistics
app.get("/api/key-stats", (req: Request, res: Response) => {
  if (geminiKeyPool.length === 0) {
    initGeminiKeyPool();
  }
  res.json({
    poolSize: geminiKeyPool.length,
    stats: Object.values(geminiKeyStats)
  });
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

    const normalizeText = (text: string) => {
      return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    };

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

      const useSmartFiltering = totalLinesInAllSheets > 500;

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

              const tabNameLower = (tab.name || "").toLowerCase();
              const normalizedTabName = normalizeText(tab.name || "");
              const isTabTargeted = searchTerms.some((term: string) => {
                const normTerm = normalizeText(term);
                return normTerm.length > 3 && (normalizedTabName.includes(normTerm) || normTerm.includes(normalizedTabName));
              });

              const isCriticalTab = isTabTargeted ||
                                    tabNameLower.includes("embaixador") || 
                                    tabNameLower.includes("contato") || 
                                    tabNameLower.includes("palestrante") || 
                                    tabNameLower.includes("parceiro") || 
                                    tabNameLower.includes("patrocinador") ||
                                    tabNameLower.includes("remela") ||
                                    tabNameLower.includes("diretoria") ||
                                    tabNameLower.includes("hino");

              rows.forEach((row: any, idx: number) => {
                const rowCellsText = headers.map((h: string) => `${row[h] !== undefined ? row[h] : ""}`).join(" ").toLowerCase();
                
                // Se for aba crítica de contatos/embaixadores/palestrantes, incluímos sempre.
                // Caso contrário, verificamos correspondência com algum termo de busca.
                const isMatch = !useSmartFiltering || 
                                isCriticalTab || 
                                searchTerms.length === 0 || 
                                searchTerms.some((term: string) => rowCellsText.includes(term));
                
                if (isMatch) {
                  const rowCells = headers.map((h: string) => `${row[h] !== undefined ? row[h] : ""}`);
                  sheetsContextText += `    [Reg ${idx + 1}] ${rowCells.join(" | ")}\n`;
                  includedCount++;
                  if (useSmartFiltering && !isCriticalTab && searchTerms.length > 0) matchedCount++;
                }
              });

              // Se usou filtragem e não encontrou nada na aba, mostra apenas as colunas (conforme pedido do usuário para economizar tokens)
              if (useSmartFiltering && includedCount === 0) {
                sheetsContextText += `    (Nenhum registro correspondeu diretamente aos termos de busca: [${searchTerms.join(", ")}]. Filtrado para economizar tokens.)\n`;
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
    const systemInstruction = `Você é um Consultor Estratégico e Assistente Especialista da operação/evento. Auxilie na consulta de planilhas e resolução de problemas usando metodologias de mercado.

DIRETRIZES DE RESPOSTA (ORDENS DIRETAS):

1. CONSULTA DE DADOS (PLANILHAS):
- Seja preciso, direto e conciso. Cite explicitamente a aba de origem (ex: "De acordo com a aba 'X'"). Não invente dados de contato ou horários.
- Forneça contatos de EJs, conselheiros, pós-juniores, canga ou similares APENAS se perguntado especificamente sobre eles. Não inclua esses contatos em dúvidas operacionais gerais.

2. CONTATOS E ACIONAMENTO OPERACIONAL:
- Indique no INÍCIO da resposta os responsáveis/embaixadores encontrados na planilha.
- REGRA DE ACIONAMENTO: Selecione e liste no MÁXIMO 1 ou 2 embaixadores estritamente necessários e relevantes para a situação. Nunca liste múltiplos contatos redundantes ou desnecessários.
- REGRA DE PALESTRANTES/MARCAS: Se o problema envolver palestrantes, patrocinadores, marcas ou fornecedores externos, procure ativamente nas planilhas (abas 'EMBAIXADORES', 'PALESTRANTES' ou equivalentes) os nomes reais e telefones dos responsáveis diretos da organização (chamados 'Remelas') por Conteúdo, Comercial, Parcerias, Marcas e liste-os obrigatoriamente de forma nominal com telefone.

3. AUTONOMIA TOTAL DO STAFF:
- DIRETRIZ: Staff tem autonomia total. Resolva o problema localmente e de imediato de forma independente.
- Não delegue nem condicione a ação do staff à presença física ou ação exclusiva do embaixador. Dê autonomia prática para agir no local usando metodologias adequadas.
- Se a situação exigir escalonamento urgente, inclua no final: "Se a situação não for resolvida imediatamente, entre em contato com os responsáveis acima."
- PROIBIÇÃO DE METATEXTO: É terminantemente proibido criar seções explicativas das regras do prompt ou justificativas (ex: "ESCLARECIMENTO", "autonomia"). Vá direto ao ponto.

4. ANÁLISE E RESOLUÇÃO:
- Aplique metodologias estruturadas (Matriz SWOT/FOFA, Matriz de Risco, GUT, FMEA, Planejamento de Contingência, Metodologia Ágil) para propor planos de ação práticos e mitigação de riscos de forma proativa.

5. FORMATAÇÃO (TEXTO TOTALMENTE LIMPO - ZERO MARKDOWN):
- TERMINANTEMENTE PROIBIDO usar formatação Markdown.
- NÃO use asteriscos (* ou **) para negrito/itálico.
- NÃO use hashtags (#, ##, ###) para títulos. Use apenas LETRAS MAIÚSCULAS para títulos de destaque (ex: "PASSO 1: ISOLAMENTO").
- NÃO use barras verticais (|) ou múltiplos hífens/iguais (---, ===) para tabelas ou divisores. Use listas textuais simples, hífens comuns (-) ou números normais para tópicos, e quebras de linha duplas para parágrafos.
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

      // If pool is not initialized, initialize it
      if (geminiKeyPool.length === 0) {
        initGeminiKeyPool();
      }

      // Check if we can rotate keys (if user did not supply a custom API Key via UI)
      const isRotating = !customApiKey && geminiKeyPool.length > 0;
      let success = false;
      let lastError: any = null;
      let replyText = "";

      if (isRotating) {
        let currentTry = 0;
        let keyIndex = getNextAvailableGeminiKeyIndex(0); // Start lookup

        while (currentTry < geminiKeyPool.length && !success) {
          const currentKey = geminiKeyPool[keyIndex];
          const stats = geminiKeyStats[keyIndex];

          console.log(`🔄 [POOL] Tentando requisição com Chave #${keyIndex + 1} (${stats.maskedKey}). Tentativa ${currentTry + 1}/${geminiKeyPool.length}`);

          try {
            const ai = new GoogleGenAI({
              apiKey: currentKey,
              httpOptions: {
                headers: {
                  'User-Agent': 'aistudio-build',
                }
              }
            });

            const response = await ai.models.generateContent({
              model: apiModel || "gemini-2.5-flash",
              contents: formattedContents,
              config: {
                systemInstruction: systemInstruction,
                temperature: 0.4,
              }
            });

            // Update stats
            stats.successCount++;
            stats.lastUsed = new Date().toISOString();
            stats.status = "active";
            stats.statusReason = undefined;
            stats.cooldownUntil = undefined;

            if (response.usageMetadata) {
              const inT = response.usageMetadata.promptTokenCount || 0;
              const outT = response.usageMetadata.candidatesTokenCount || 0;
              const totT = response.usageMetadata.totalTokenCount || 0;

              stats.promptTokens += inT;
              stats.candidatesTokens += outT;
              stats.totalTokens += totT;

              console.log(`📊 [GEMINI RAG USAGE - CHAVE #${keyIndex + 1}]`);
              console.log(`   Tokens de Entrada (Contexto + Prompt): ${inT}`);
              console.log(`   Tokens de Saída (Resposta da IA): ${outT}`);
              console.log(`   Total de Tokens nesta consulta: ${totT}`);
              console.log(`   Consumo Acumulado desta Chave: ${stats.totalTokens} tokens (Sucessos: ${stats.successCount})`);
            }

            replyText = response.text || "Não foi possível gerar uma resposta para essa pergunta.";
            success = true;
            saveGeminiKeyStats();
          } catch (err: any) {
            console.error(`❌ [POOL] Falha na Chave #${keyIndex + 1} (${stats.maskedKey}):`, err.message || err);
            stats.errorCount++;
            stats.lastUsed = new Date().toISOString();

            // Check if rate limit (status 429 / resource exhausted / quota)
            const errMsg = (err.message || "").toLowerCase();
            if (errMsg.includes("429") || errMsg.includes("limit") || errMsg.includes("exhausted") || errMsg.includes("quota") || errMsg.includes("rate")) {
              stats.status = "rate_limited";
              stats.statusReason = "Rate limit excedido (429/Quota)";
              stats.cooldownUntil = Date.now() + 60 * 1000; // 1 minute cooldown
            } else {
              stats.status = "invalid";
              stats.statusReason = err.message || "Erro desconhecido";
            }

            lastError = err;
            currentTry++;
            // Try next key
            keyIndex = getNextAvailableGeminiKeyIndex((keyIndex + 1) % geminiKeyPool.length);
            saveGeminiKeyStats();
          }
        }

        if (!success) {
          throw lastError || new Error("Todas as chaves do pool falharam ou estão limitadas.");
        }

        reply = replyText;
      } else {
        // Fallback / Single Key path
        const ai = new GoogleGenAI({
          apiKey: activeApiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const response = await ai.models.generateContent({
          model: apiModel || "gemini-2.5-flash",
          contents: formattedContents,
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.4,
          }
        });

        if (response.usageMetadata) {
          console.log("📊 [GEMINI RAG USAGE - CHAVE ÚNICA/PERSONALIZADA]");
          console.log(`   Tokens de Entrada (Contexto + Prompt): ${response.usageMetadata.promptTokenCount}`);
          console.log(`   Tokens de Saída (Resposta da IA): ${response.usageMetadata.candidatesTokenCount}`);
          console.log(`   Total de Tokens nesta consulta: ${response.usageMetadata.totalTokenCount}`);
        }

        reply = response.text || "Não foi possível gerar uma resposta para essa pergunta.";
      }
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
