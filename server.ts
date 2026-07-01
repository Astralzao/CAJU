import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import * as XLSX from "xlsx";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
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

// Detailed query transaction tracker
const TRANSACTIONS_PATH = getWritablePath("gemini-transactions-db.json");

interface QueryTransaction {
  id: string;
  timestamp: string;
  deviceSessionId: string;
  userQuery: string;
  agentResponse?: string;
  model: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  estimatedCostBRL: number;
  keyIndex: number;
}

let queryTransactions: QueryTransaction[] = [];

function loadQueryTransactions() {
  try {
    if (fs.existsSync(TRANSACTIONS_PATH)) {
      const data = JSON.parse(fs.readFileSync(TRANSACTIONS_PATH, "utf8"));
      if (Array.isArray(data)) {
        queryTransactions = data;
        console.log(`📂 [TRANSACTION PERSISTENCE] ${queryTransactions.length} transações de consulta carregadas do disco.`);
      }
    }
  } catch (err) {
    console.error("❌ Erro ao carregar transações de consulta do disco:", err);
  }
}

function saveQueryTransactions() {
  try {
    // Keep only last 500 records to prevent bloating the JSON file
    if (queryTransactions.length > 500) {
      queryTransactions = queryTransactions.slice(-500);
    }
    fs.writeFileSync(TRANSACTIONS_PATH, JSON.stringify(queryTransactions, null, 2), "utf8");
  } catch (err) {
    console.error("❌ Erro ao salvar transações de consulta no disco:", err);
  }
}

async function appendTransactionToGoogleSheets(tx: QueryTransaction) {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_LOG_SPREADSHEET_ID;

  if (!clientEmail || !privateKey || !spreadsheetId) {
    console.log("⚠️ [GOOGLE SHEETS LOG] Envio ignorado. Faltando variáveis de ambiente:", {
      GOOGLE_CLIENT_EMAIL: clientEmail ? "Configurado ✅" : "AUSENTE ❌",
      GOOGLE_PRIVATE_KEY: privateKey ? "Configurado ✅" : "AUSENTE ❌",
      GOOGLE_SHEETS_LOG_SPREADSHEET_ID: spreadsheetId ? "Configurado ✅" : "AUSENTE ❌"
    });
    console.log("👉 Lembre-se: Após configurar as variáveis de ambiente no painel da Vercel, você PRECISA realizar um novo Deploy (Redeploy) para que as alterações tenham efeito.");
    return;
  }

  console.log(`⏳ [GOOGLE SHEETS LOG] Iniciando envio da transação ${tx.id} para a planilha: ${spreadsheetId}`);

  try {
    // Process private key to restore newline characters (common issue with Vercel env vars)
    privateKey = privateKey.replace(/\\n/g, "\n");

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Try to read first row to check if headers are already written
    let hasHeaders = false;
    try {
      const checkRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "A1:B1",
      });
      if (checkRes.data.values && checkRes.data.values.length > 0) {
        hasHeaders = true;
      }
    } catch (readErr: any) {
      console.log(`ℹ️ [GOOGLE SHEETS LOG] Não foi possível ler cabeçalhos (pode ser planilha vazia): ${readErr.message || readErr}`);
    }

    if (!hasHeaders) {
      console.log("📝 [GOOGLE SHEETS LOG] Escrevendo linha de cabeçalhos na planilha...");
      const headers = [
        "ID da Transação",
        "Data/Hora (UTC)",
        "ID da Sessão (Dispositivo)",
        "Pergunta do Usuário",
        "Resposta do Agente",
        "Modelo Utilizado",
        "Tokens de Entrada",
        "Tokens de Saída",
        "Total de Tokens",
        "Custo Estimado (USD)",
        "Custo Estimado (BRL)",
        "Chave Utilizada"
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "A1",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [headers],
        },
      });
    }

    // Format row values nicely
    const row = [
      tx.id,
      tx.timestamp,
      tx.deviceSessionId,
      tx.userQuery,
      tx.agentResponse || "",
      tx.model,
      tx.promptTokens,
      tx.candidatesTokens,
      tx.totalTokens,
      tx.estimatedCostUSD,
      tx.estimatedCostBRL,
      tx.keyIndex !== undefined && tx.keyIndex >= 0 
        ? `Chave Pool #${tx.keyIndex + 1}` 
        : tx.keyIndex === -1 
          ? "Chave Única/Personalizada" 
          : "Outro Provedor"
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "A:L",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [row],
      },
    });

    console.log(`✅ [GOOGLE SHEETS LOG] Transação ${tx.id} enviada para a planilha com sucesso.`);
  } catch (err: any) {
    console.error("❌ [GOOGLE SHEETS LOG] Falha ao enviar transação para o Google Sheets:", err.message || err);
    console.error("💡 Dica: Verifique se o e-mail da conta de serviço está como editor na planilha e se a chave privada está correta.");
  }
}

let sheetsQueue: Promise<void> = Promise.resolve();

function registerQueryTransaction(tx: QueryTransaction) {
  queryTransactions.push(tx);
  saveQueryTransactions();
  
  // Enfileirar os envios para o Google Sheets sequencialmente para evitar conflitos de concorrência e rate limiting
  sheetsQueue = sheetsQueue
    .then(async () => {
      await appendTransactionToGoogleSheets(tx);
    })
    .catch(err => {
      console.error(`❌ [GOOGLE SHEETS LOG] Erro na fila do Google Sheets para transação ${tx.id}:`, err.message || err);
    });
}

// Cost calculation utility based on official API pricing per 1M tokens
function calculateModelCost(model: string, inputTokens: number, outputTokens: number) {
  const modelLower = (model || "").toLowerCase();
  let inputRate = 0.30;  // default to gemini-2.5-flash: $0.30 per 1M input
  let outputRate = 2.50; // default to gemini-2.5-flash: $2.50 per 1M output

  if (modelLower.includes("1.5-flash") || modelLower.includes("1.5_flash")) {
    inputRate = 0.075;
    outputRate = 0.30;
  } else if (modelLower.includes("1.5-pro") || modelLower.includes("1.5_pro")) {
    inputRate = 1.25;
    outputRate = 5.00;
  } else if (modelLower.includes("2.5-pro") || modelLower.includes("2.5_pro")) {
    inputRate = 1.25;
    outputRate = 5.00;
  } else if (modelLower.includes("gpt-4o-mini")) {
    inputRate = 0.150;
    outputRate = 0.600;
  } else if (modelLower.includes("gpt-4o")) {
    inputRate = 2.50;
    outputRate = 10.00;
  } else if (modelLower.includes("llama-3")) {
    inputRate = 0.05;
    outputRate = 0.08;
  }

  const costUSD = (inputTokens * inputRate + outputTokens * outputRate) / 1000000;
  const costBRL = costUSD * 5.50; // Exchange rate estimated at 5.50 BRL/USD
  return { costUSD, costBRL };
}

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
  loadQueryTransactions();

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

// Endpoint to view detailed query transactions
app.get("/api/transactions", (req: Request, res: Response) => {
  res.json({
    transactions: queryTransactions
  });
});

// Endpoint to secure and download a backup of key stats and transactions
app.get("/api/admin/backup", checkAdminAuth, (req: Request, res: Response) => {
  if (geminiKeyPool.length === 0) {
    initGeminiKeyPool();
  }
  res.json({
    geminiKeyStats: geminiKeyStats,
    queryTransactions: queryTransactions
  });
});

// Endpoint to restore stats and transactions from a JSON backup
app.post("/api/admin/restore", checkAdminAuth, (req: Request, res: Response) => {
  const { geminiKeyStats: importedStats, queryTransactions: importedTransactions } = req.body;
  let restoredStats = false;
  let restoredTransactions = false;

  if (importedStats && typeof importedStats === "object") {
    geminiKeyStats = importedStats;
    saveGeminiKeyStats();
    restoredStats = true;
  }

  if (Array.isArray(importedTransactions)) {
    queryTransactions = importedTransactions;
    saveQueryTransactions();
    restoredTransactions = true;
  }

  res.json({
    success: true,
    message: "Backup restaurado com sucesso!",
    restoredStats,
    restoredTransactions
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
      clientSpreadsheets,
      deviceSessionId
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

    // 1. Extrair termos de busca inteligentes da mensagem atual e fundir contexto anterior se for continuação
    const userMessageLower = message.toLowerCase();
    let combinedTextForSearch = userMessageLower;

    const normalizeText = (text: string) => {
      return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    };

    // Identificar nomes de abas presentes na mensagem atual
    const allTabNames: string[] = [];
    if (sheets && Array.isArray(sheets)) {
      sheets.forEach((sheet: any) => {
        if (sheet.tabs && Array.isArray(sheet.tabs)) {
          sheet.tabs.forEach((tab: any) => {
            if (tab.name) {
              allTabNames.push(normalizeText(tab.name));
            }
          });
        }
      });
    }

    let shouldResetHistory = false;
    let actualHistory = history || [];

    // Inteligência de contexto para perguntas continuadas (ex: "E da Adm Consult?")
    if (history && Array.isArray(history)) {
      const userMessages = history
        .filter((msg: any) => msg.role === "user")
        .map((msg: any) => msg.content.toLowerCase());

      const checkIsContinuation = (text: string) => {
        const textLower = text.toLowerCase();
        const words = textLower.split(/\s+/);
        return words.some(w => 
          ["e", "qual", "quem", "onde", "quanto", "quantos", "como", "telas", "planilha", "aba", "de", "da", "do"].includes(w)
        ) || words.length < 5;
      };

      const currentIsContinuation = checkIsContinuation(userMessageLower);

      if (currentIsContinuation) {
        let consecutiveContinuations = 1; // conta a atual
        // Varre de trás para frente no histórico
        for (let i = userMessages.length - 1; i >= 0; i--) {
          if (checkIsContinuation(userMessages[i])) {
            consecutiveContinuations++;
          } else {
            break;
          }
        }

        if (consecutiveContinuations > 3) {
          shouldResetHistory = true;
          actualHistory = [];
          console.log(`⚠️ Limite de 3 perguntas consecutivas de continuação atingido. Resetando histórico da sessão para evitar alucinações.`);
        }
      }

      if (!shouldResetHistory && currentIsContinuation && userMessages.length > 0) {
        let lastUserMsg = userMessages[userMessages.length - 1];
        
        const words = userMessageLower.split(/\s+/);
        // Se a mensagem atual cita abas específicas, removemos do histórico do usuário referências a OUTRAS abas para não misturar contextos de entidades distintas
        const tabsInCurrent = allTabNames.filter(tabName => 
          tabName.length > 2 && normalizeText(userMessageLower).includes(tabName)
        );
        
        if (tabsInCurrent.length > 0) {
          allTabNames.forEach(tabName => {
            if (!tabsInCurrent.includes(tabName)) {
              const parts = tabName.split(/\s+/);
              parts.forEach(part => {
                if (part.length > 2) {
                  const regex = new RegExp(`\\b${part}\\w*\\b`, 'gi');
                  lastUserMsg = lastUserMsg.replace(regex, "");
                }
              });
            }
          });
        }

        combinedTextForSearch = `${userMessageLower} ${lastUserMsg}`;
        
        // Se for curtíssima (ex: "E da Adm?"), puxa também a penúltima
        if (words.length <= 3 && userMessages.length > 1) {
          let secondLastUserMsg = userMessages[userMessages.length - 2];
          if (tabsInCurrent.length > 0) {
            allTabNames.forEach(tabName => {
              if (!tabsInCurrent.includes(tabName)) {
                const parts = tabName.split(/\s+/);
                parts.forEach(part => {
                  if (part.length > 2) {
                    const regex = new RegExp(`\\b${part}\\w*\\b`, 'gi');
                    secondLastUserMsg = secondLastUserMsg.replace(regex, "");
                  }
                });
              }
            });
          }
          combinedTextForSearch = `${combinedTextForSearch} ${secondLastUserMsg}`;
        }
      }
    }

    const STOP_WORDS = new Set([
      "dos", "das", "com", "para", "uma", "uns", "por", "sobre", "como", "quem", "qual", "onde", "quando", 
      "quais", "esta", "este", "esse", "essa", "tudo", "nada", "que", "ele", "ela", "dele", "dela", "nos", 
      "nas", "aos", "aas", "quantas", "quantos", "quanta", "quanto", "pessoas", "pessoa", "vem", "vão", 
      "vai", "primeiro", "primeira", "ultimo", "ultima", "mais", "menos", "estao", "isso", "aquilo", 
      "esteve", "estava", "horas", "hora", "minuto", "minutos", "dia", "dias", "mes", "ano", "evento", 
      "planilha", "aba", "registro", "linhas", "linha", "dados", "tabela", "informacao", "informacoes",
      "um", "uma", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "tem", "têm",
      "em", "no", "na", "de", "do", "da", "ao", "as", "os", "sao", "foi", "foram", "seria", "seriam"
    ]);

    const searchTerms = combinedTextForSearch
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^a-zA-Z0-9\s:]/g, " ") // keep letters, numbers, and colons
      .toLowerCase()
      .split(/\s+/)
      .map(term => term.trim())
      .filter((term: string) => {
        if (STOP_WORDS.has(term)) return false;
        
        // Keep numeric/time-like terms of length >= 2 (e.g., "12", "12h", "12:00")
        const isNumericOrTime = /^[0-9]+[a-z0-9:]*$/.test(term) || /^[a-z]+[0-9]+$/.test(term);
        if (isNumericOrTime) {
          return term.length >= 2;
        }
        
        // General words must be length > 2
        return term.length > 2;
      });

    // 2. Format Sheet Data for the prompt context with smart filtering (RAG)
    let sheetsContextText = "";
    if (sheets && Array.isArray(sheets) && sheets.length > 0) {
      sheetsContextText = "--- DADOS DAS PLANILHAS ALIMENTADAS (Filtrados por relevância para economizar limite de tokens) ---\n\n";

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

              const tabNameLower = (tab.name || "").toLowerCase();
              const normalizedTabName = normalizeText(tab.name || "");
              const isTabTargeted = searchTerms.some((term: string) => {
                const normTerm = normalizeText(term);
                return normTerm.length > 2 && (normalizedTabName.includes(normTerm) || normTerm.includes(normalizedTabName));
              });

              const isCriticalTab = isTabTargeted ||
                                    tabNameLower.includes("embaixador") || 
                                    tabNameLower.includes("contato") || 
                                    tabNameLower.includes("palestrante") || 
                                    tabNameLower.includes("parceiro") || 
                                    tabNameLower.includes("patrocinador") ||
                                    tabNameLower.includes("remela") ||
                                    tabNameLower.includes("diretoria") ||
                                    tabNameLower.includes("hino") ||
                                    tabNameLower.includes("transfer") ||
                                    tabNameLower.includes("transporte") ||
                                    tabNameLower.includes("escala") ||
                                    tabNameLower.includes("quarto") ||
                                    tabNameLower.includes("hospedagem");

              const isTransferTab = tabNameLower.includes("transfer") || 
                                    (userMessageLower.includes("transfer") && 
                                     (tabNameLower.includes("transporte") || 
                                      tabNameLower.includes("escala") || 
                                      tabNameLower.includes("voo") || 
                                      tabNameLower.includes("chegada") || 
                                      tabNameLower.includes("partida")));

              if (isTransferTab) {
                let matchedCount = 0;
                rows.forEach((row: any, idx: number) => {
                  const rowCellsText = headers.map((h: string) => {
                    const val = row[h] !== undefined ? String(row[h]) : "";
                    return normalizeText(val);
                  }).join(" ");
                  
                  const hasDirectKeywordMatch = searchTerms.some((term: string) => {
                    const normTerm = normalizeText(term);
                    return rowCellsText.includes(normTerm);
                  });

                  const tag = hasDirectKeywordMatch ? "MATCH" : "INTEGRAL-TRANSFER";
                  const rowCells = headers.map((h: string) => `${row[h] !== undefined ? row[h] : ""}`);
                  sheetsContextText += `    [${tag} ${idx + 1}] ${rowCells.join(" | ")}\n`;
                  includedCount++;
                  if (hasDirectKeywordMatch) {
                    matchedCount++;
                  }
                });
                sheetsContextText += `    (ATENÇÃO: os dados de TRANSFER da aba "${tab.name}" foram fornecidos de forma 100% INTEGRAL a pedido do usuário para que a IA filtre e agrupe a resposta com base na pergunta. Filtre de acordo com as instruções do usuário.)\n`;
              } else if (searchTerms.length === 0 && !isCriticalTab) {
                sheetsContextText += `    (Nenhum termo de busca na pergunta. Linhas ocultadas para economizar tokens. Pergunte sobre dados desta aba para visualizá-los.)\n`;
              } else {
                // Encontrar correspondências diretas nesta aba primeiro
                const matchedIndices: number[] = [];
                rows.forEach((row: any, idx: number) => {
                  const rowCellsText = headers.map((h: string) => {
                    const val = row[h] !== undefined ? String(row[h]) : "";
                    return normalizeText(val);
                  }).join(" ");
                  
                  const hasDirectKeywordMatch = searchTerms.some((term: string) => {
                    const normTerm = normalizeText(term);
                    return rowCellsText.includes(normTerm);
                  });

                  if (hasDirectKeywordMatch) {
                    matchedIndices.push(idx);
                  }
                });

                const isSmallTargeted = isTabTargeted && rows.length <= 80;

                if (isSmallTargeted) {
                  // Se a aba for explicitamente mencionada/visada na pergunta e for pequena (até 80 linhas),
                  // enviamos 100% dos dados para precisão analítica absoluta.
                  let matchedCount = 0;
                  rows.forEach((row: any, idx: number) => {
                    const hasMatch = matchedIndices.includes(idx);
                    const tag = hasMatch ? "MATCH" : "CONTEXTO-GERAL";
                    const rowCells = headers.map((h: string) => `${row[h] !== undefined ? row[h] : ""}`);
                    sheetsContextText += `    [${tag} ${idx + 1}] ${rowCells.join(" | ")}\n`;
                    includedCount++;
                    if (hasMatch) {
                      matchedCount++;
                    }
                  });

                  if (matchedCount < includedCount && includedCount > 0) {
                    sheetsContextText += `    (ATENÇÃO: as linhas marcadas como [CONTEXTO-GERAL] acima NÃO correspondem diretamente aos termos da pergunta, mas foram fornecidas por completo pois esta aba foi explicitamente visada.)\n`;
                  }
                } else if (matchedIndices.length > 0) {
                  // Se houver correspondências de palavras-chave, enviamos um bloco contínuo contendo-as
                  // mas limitamos rigorosamente o bloco contínuo para economizar tokens!
                  const lastMatchIdx = Math.max(...matchedIndices);
                  
                  // Limites de bloco contínuo muito mais rígidos para evitar token explosion
                  const maxContinuousLimit = isTabTargeted ? 40 : (isCriticalTab ? 15 : 5);
                  const endIdx = Math.min(lastMatchIdx + 2, rows.length - 1, maxContinuousLimit - 1);

                  let matchedCount = 0;
                  for (let i = 0; i <= endIdx; i++) {
                    const row = rows[i];
                    const hasMatch = matchedIndices.includes(i);
                    const tag = hasMatch ? "MATCH" : "CONTEXTO-GERAL";
                    const rowCells = headers.map((h: string) => `${row[h] !== undefined ? row[h] : ""}`);
                    sheetsContextText += `    [${tag} ${i + 1}] ${rowCells.join(" | ")}\n`;
                    includedCount++;
                    if (hasMatch) {
                      matchedCount++;
                    }
                  }

                  // Se houver registros correspondentes adicionais além do bloco contínuo limpo, incluímos apenas os MATCHES de forma pontual e isolada
                  if (lastMatchIdx > endIdx) {
                    sheetsContextText += `    ... (intervalo de segurança omitido para poupar tokens) ...\n`;
                    matchedIndices.forEach((idx) => {
                      if (idx > endIdx) {
                        const row = rows[idx];
                        const rowCells = headers.map((h: string) => `${row[h] !== undefined ? row[h] : ""}`);
                        sheetsContextText += `    [MATCH ${idx + 1}] ${rowCells.join(" | ")}\n`;
                        includedCount++;
                      }
                    });
                  }

                  if (matchedCount < includedCount) {
                    sheetsContextText += `    (ATENÇÃO: as linhas marcadas como [CONTEXTO-GERAL] acima NÃO correspondem diretamente aos termos da pergunta, mas foram fornecidas para contextualizar a sequência e continuidade local dos dados da aba "${tab.name}". Use apenas linhas [MATCH] para respostas diretas a pessoas/situações específicas.)\n`;
                  }
                } else {
                  // Sem correspondência direta de termos na aba:
                  // Se for visada, mostramos uma pequena amostra (10 linhas).
                  // Se for crítica, mostramos uma amostra ainda menor (3 linhas).
                  // Se for secundária, NÃO enviamos nenhuma linha (0 linhas) para máxima economia de tokens!
                  const fallbackCount = isTabTargeted ? 10 : (isCriticalTab ? 3 : 0);
                  if (fallbackCount > 0) {
                    const endIdx = Math.min(fallbackCount - 1, rows.length - 1);
                    for (let i = 0; i <= endIdx; i++) {
                      const row = rows[i];
                      const rowCells = headers.map((h: string) => `${row[h] !== undefined ? row[h] : ""}`);
                      sheetsContextText += `    [CONTEXTO-GERAL ${i + 1}] ${rowCells.join(" | ")}\n`;
                      includedCount++;
                    }
                    sheetsContextText += `    (ATENÇÃO: nenhuma linha desta aba correspondeu diretamente à pergunta. As linhas [CONTEXTO-GERAL] acima servem apenas como amostra estrutural de ${tab.name}.)\n`;
                  } else {
                    sheetsContextText += `    (Nenhum registro correspondeu aos termos de busca. Linhas omitidas para economizar tokens. Pergunte especificamente sobre dados desta aba para visualizá-los.)\n`;
                  }
                }

                if (rows.length > includedCount && includedCount > 0) {
                  sheetsContextText += `    (Nota: Otimizado enviando ${includedCount} de ${rows.length} registros para preservar o limite de tokens)\n`;
                }
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
- REGRA CRÍTICA DE CONTEXTO E HISTÓRICO: Use SOMENTE o resultado de busca fornecido nas planilhas do contexto atual da pergunta mais recente. Ignore completamente quaisquer dados, contatos, horários ou alocações mencionados em perguntas ou respostas anteriores do histórico de conversas, a menos que a pergunta atual faça uma referência direta a eles.
- PROIBIÇÃO ABSOLUTA DE ALUCINAÇÃO (NÃO INVENTAR): Se não houver correspondência clara ou se a informação não constar explicitamente na busca atual, responda estritamente "não encontrei" ou informe de maneira direta que os dados não estão disponíveis nas planilhas, em vez de inventar nomes, números, telefones, horários ou planos.
- Forneça contatos de EJs, conselheiros, pós-juniores, canga ou similares APENAS se perguntado especificamente sobre eles. Não inclua esses contatos em dúvidas operacionais gerais.

2. TRATAMENTO DE PERGUNTAS FORA DE CONTEXTO OU DADOS INEXISTENTES:
- Se o usuário fizer uma pergunta sobre fatos específicos, horários, atribuições de tarefas ou alocações individuais de pessoas ou organizações que NÃO constam em nenhuma planilha da base de dados (Exemplos: "o que fulano de tal vai fazer no primeiro dia?", "qual a minha alocação?", "qual a alocação de fulano de tal?"), NÃO formule planos de ação, NÃO liste embaixadores e NÃO invente dados. Responda de forma extremamente simples, direta e curta, informando apenas que não há registros ou dados sobre isso na planilha atual (usando preferencialmente "não encontrei" se for busca direta).
- EXCEÇÃO PARA SITUAÇÕES NARRADAS / INCIDENTES OPERACIONAIS: Se o usuário narrar uma situação real ou problema simulado ocorrido no evento (Exemplos: "um congressista está passando mal", "falta de energia na sala de palestra", "atraso de palestrante"), aplique bom senso e elabore um plano de ação prático usando metodologias de contingência. No entanto, inclua nos contatos de acionamento APENAS contatos que sejam estritamente pertinentes àquele problema específico (ex: não liste contatos de comercial ou marcas se a situação for médica).
- BOM SENSO NO ESCOPO: Use discernimento inteligente e bom senso. Separe de forma muito clara o que é pertinente à dúvida do usuário do que não é. Se a dúvida não tem relação direta com dados da planilha ou com incidentes operacionais a serem resolvidos, diga apenas que não encontrou informações.

3. CONTATOS E ACIONAMENTO OPERACIONAL:
- Indique no INÍCIO da resposta os responsáveis/embaixadores encontrados na planilha pertinentes à situação.
- REGRA DE ACIONAMENTO: Selecione e liste no MÁXIMO 1 ou 2 embaixadores estritamente necessários e relevantes para a situação. Nunca liste múltiplos contatos redundantes ou desnecessários.
- REGRA DE PALESTRANTES/MARCAS: Se o problem envolver palestrantes, patrocinadores, marcas ou fornecedores externos, procure ativamente nas planilhas (abas 'EMBAIXADORES', 'PALESTRANTES' ou equivalentes) os nomes reais e telefones dos responsáveis diretos da organização (chamados 'Remelas') por Conteúdo, Comercial, Parcerias, Marcas e liste-os obrigatoriamente de forma nominal com telefone.

4. AUTONOMIA TOTAL DO STAFF:
- DIRETRIZ: Staff tem autonomia total. Resolva o problema localmente e de imediato de forma independente.
- Não delegue nem condicione a ação do staff à presença física ou ação exclusiva do embaixador. Dê autonomia prática para agir no local usando metodologias adequadas.
- Se a situação exigir escalonamento urgente, inclua no final: "Se a situação não for resolvida imediatamente, entre em contato com os responsáveis acima."
- PROIBIÇÃO DE METATEXTO: É terminantemente proibido criar seções explicativas das regras do prompt ou justificativas (ex: "ESCLARECIMENTO", "autonomia"). Vá direto ao ponto.

5. ANÁLISE E RESOLUÇÃO DE INCIDENTES (SITUAÇÕES OPERACIONAIS NARRADAS):
- O agente deve classificar e responder o incidente com base em dois contextos operacionais bem definidos:
  A) TIPO 1: SITUAÇÕES DE ALTA URGÊNCIA / RISCO IMEDIATO (Ex: congressista passando mal, briga física, risco elétrico ativo, apagão súbito na palestra em andamento):
     - Prioridade: Agilidade extrema e foco na ação tática de campo.
     - Regra: NÃO use matrizes complexas ou explicações metodológicas (SWOT, GUT, FMEA) para não sobrecarregar quem está lidando com a emergência.
     - Limite: Resposta ultra-curta e direta, contendo no máximo 150 a 200 palavras, focada em passos físicos práticos e em quem acionar de imediato.
  B) TIPO 2: PROBLEMAS OPERACIONAIS COMPLEXOS, DESAFIOS ESTRATÉGICOS OU PLANEJAMENTOS (Ex: gargalos crônicos na fila de credenciamento, conflito de agenda ou salas de amanhã, plano de contingência para chuva no dia seguinte, falhas logísticas recorrentes):
     - Prioridade: Análise detalhada, profunda e estruturada.
     - Regra: PROATIVAMENTE construa e utilize ferramentas metodológicas de mercado (como Matriz SWOT/FOFA, Matriz GUT de priorização, análise FMEA ou Planos de Contingência detalhados) para dar suporte estratégico rico, estruturado e completo à equipe de coordenação. O usuário não pedirá isso explicitamente, mas necessita dessa estrutura para organizar o caos.
     - Limite: Sem limite rígido de palavras; preze por um plano detalhado, de alto nível, explicativo e robusto.
- PROIBIÇÃO DE CONSELHOS ABSTRATOS (APLICÁVEL A TODOS OS CASOS): É terminantemente proibido fornecer conselhos clichês, óbvios ou conselhos vazios (como "mantenha a calma", "comunique-se bem", "garanta a segurança"). Toda orientação deve ser uma ação prática e específica (Ex: em vez de "garanta a segurança", use "isole a área imediatamente e afaste os congressistas do local").
- INDIQUE QUEM ACIONAR: Identifique e liste no início os nomes e contatos reais de 1 ou 2 embaixadores encontrados na planilha pertinentes ao problema. Se não houver, indique de forma direta qual equipe/staff do local deve executar as ações.

6. FORMATAÇÃO (TEXTO TOTALMENTE LIMPO - ZERO MARKDOWN):
- TERMINANTEMENTE PROIBIDO usar formatação Markdown.
- NÃO use asteriscos (* ou **) para negrito/itálico.
- NÃO use hashtags (#, ##, ###) para títulos. Use apenas LETRAS MAIÚSCULAS para títulos de destaque (ex: "PASSO 1: ISOLAMENTO").
- NÃO use barras verticais (|) ou múltiplos hífens/iguais (---, ===) para tabelas ou divisores. Use listas textuais simples, hífens comuns (-) ou números normais para tópicos, e quebras de linha duplas para parágrafos.
`;

    // 3. Prepare Chat Prompt / Contents based on Provider
    let reply = "";

    if (apiProvider === "gemini") {
      // Limpar e limitar o histórico de conversa para os últimos 4 turnos (2 perguntas e 2 respostas)
      // para evitar o acúmulo de dados antigos de busca e reduzir drasticamente os tokens gastos.
      const formattedContents: any[] = [];
      const maxHistoryMessages = 4;
      
      if (actualHistory && Array.isArray(actualHistory)) {
        const lastMessages = actualHistory.slice(-maxHistoryMessages);
        lastMessages.forEach((msg: any) => {
          let content = msg.content || "";
          // Truncar mensagens muito longas do assistente para não acumular tokens no histórico
          if (msg.role === "assistant" && content.length > 800) {
            content = content.substring(0, 800) + "... (Texto longo do histórico truncado para economizar tokens)";
          }
          formattedContents.push({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: content }]
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

            replyText = response.text || "Não foi possível gerar uma resposta para essa pergunta.";

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

              // Save detailed request transaction
              const { costUSD, costBRL } = calculateModelCost(apiModel || "gemini-2.5-flash", inT, outT);
              registerQueryTransaction({
                id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                timestamp: new Date().toISOString(),
                deviceSessionId: deviceSessionId || "unknown",
                userQuery: message,
                agentResponse: replyText,
                model: apiModel || "gemini-2.5-flash",
                promptTokens: inT,
                candidatesTokens: outT,
                totalTokens: totT,
                estimatedCostUSD: costUSD,
                estimatedCostBRL: costBRL,
                keyIndex: keyIndex
              });
            }

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

        reply = response.text || "Não foi possível gerar uma resposta para essa pergunta.";

        if (response.usageMetadata) {
          const inT = response.usageMetadata.promptTokenCount || 0;
          const outT = response.usageMetadata.candidatesTokenCount || 0;
          const totT = response.usageMetadata.totalTokenCount || 0;

          console.log("📊 [GEMINI RAG USAGE - CHAVE ÚNICA/PERSONALIZADA]");
          console.log(`   Tokens de Entrada (Contexto + Prompt): ${inT}`);
          console.log(`   Tokens de Saída (Resposta da IA): ${outT}`);
          console.log(`   Total de Tokens nesta consulta: ${totT}`);

          // Save detailed request transaction
          const { costUSD, costBRL } = calculateModelCost(apiModel || "gemini-2.5-flash", inT, outT);
          registerQueryTransaction({
            id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            timestamp: new Date().toISOString(),
            deviceSessionId: deviceSessionId || "unknown",
            userQuery: message,
            agentResponse: reply,
            model: apiModel || "gemini-2.5-flash",
            promptTokens: inT,
            candidatesTokens: outT,
            totalTokens: totT,
            estimatedCostUSD: costUSD,
            estimatedCostBRL: costBRL,
            keyIndex: -1 // Custom single key
          });
        }
      }
    } else {
      // Limpar e limitar o histórico de conversa para os últimos 4 turnos (2 perguntas e 2 respostas)
      // para evitar o acúmulo de dados antigos de busca e reduzir drasticamente os tokens gastos.
      const messagesArray: any[] = [
        { role: "system", content: systemInstruction }
      ];

      const maxHistoryMessages = 4;
      if (actualHistory && Array.isArray(actualHistory)) {
        const lastMessages = actualHistory.slice(-maxHistoryMessages);
        lastMessages.forEach((msg: any) => {
          let content = msg.content || "";
          // Truncar mensagens muito longas do assistente para não acumular tokens no histórico
          if (msg.role === "assistant" && content.length > 800) {
            content = content.substring(0, 800) + "... (Texto longo do histórico truncado para economizar tokens)";
          }
          messagesArray.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: content
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

      if (responseData.usage) {
        const inT = responseData.usage.prompt_tokens || 0;
        const outT = responseData.usage.completion_tokens || 0;
        const totT = responseData.usage.total_tokens || 0;

        // Save detailed request transaction
        const { costUSD, costBRL } = calculateModelCost(finalModel, inT, outT);
        registerQueryTransaction({
          id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          timestamp: new Date().toISOString(),
          deviceSessionId: deviceSessionId || "unknown",
          userQuery: message,
          agentResponse: reply,
          model: finalModel,
          promptTokens: inT,
          candidatesTokens: outT,
          totalTokens: totT,
          estimatedCostUSD: costUSD,
          estimatedCostBRL: costBRL,
          keyIndex: -2 // Other provider code
        });
      }
    }

    if (shouldResetHistory) {
      reply = `[REINÍCIO DE CONTEXTO]\nEste chat foi reiniciado automaticamente porque atingimos o limite de 3 perguntas consecutivas com base no histórico anterior. Isso evita alucinações e garante que novas consultas sejam 100% precisas em relação aos dados atuais.\n\n${reply}`;
    }

    res.json({ reply, resetHistory: shouldResetHistory });

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
