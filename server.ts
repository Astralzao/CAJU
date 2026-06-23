import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables from .env
dotenv.config();

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

// Query Endpoint for Sheet Chat
app.post("/api/chat", async (req: Request, res: Response) => {
  try {
    const { message, history, sheets } = req.body;

    if (!message) {
       res.status(400).json({ error: "Mensagem é obrigatória." });
       return;
    }

    if (!apiKey) {
       res.status(500).json({ 
        error: "GEMINI_API_KEY não configurada. Por favor, adicione sua chave de API nas configurações de Segredos (Secrets) do AI Studio." 
      });
      return;
    }

    const ai = getGeminiClient();

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

buildApp();
