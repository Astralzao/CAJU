import React, { useState, useEffect } from "react";
import { Spreadsheet, ChatMessage } from "./types";
import { DEFAULT_SPREADSHEETS } from "./data/defaultSheets";
import SpreadsheetImport from "./components/SpreadsheetImport";
import SpreadsheetViewer from "./components/SpreadsheetViewer";
import { 
  FileSpreadsheet, 
  Database, 
  Bot, 
  RotateCcw, 
  AlertCircle,
  Copy,
  Check,
  Sparkles,
  Zap,
  Cpu,
  Send,
  Trash2,
  LogOut,
  Sparkle,
  Phone,
  FileText,
  BadgeAlert,
  Key,
  RefreshCw
} from "lucide-react";

export default function App() {
  const [spreadsheets, setSpreadsheets] = useState<Spreadsheet[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  // Tab control for the main Workspace
  const [activeAdminTab, setActiveAdminTab] = useState<"upload" | "tables" | "config" >("upload");
  
  // API Provider & Key states
  const [apiProvider, setApiProvider] = useState<"gemini" | "groq" | "openai">(() => {
    return (localStorage.getItem("destine_api_provider") as any) || "gemini";
  });
  const [apiModel, setApiModel] = useState<string>(() => {
    return localStorage.getItem("destine_api_model") || "";
  });
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return localStorage.getItem("destine_gemini_api_key") || "";
  });
  const [groqApiKey, setGroqApiKey] = useState<string>(() => {
    return localStorage.getItem("destine_groq_api_key") || "";
  });
  const [openaiApiKey, setOpenaiApiKey] = useState<string>(() => {
    return localStorage.getItem("destine_openai_api_key") || "";
  });
  
  // Custom Google Sheet URL and Tab lists
  const [customGoogleSheetUrl, setCustomGoogleSheetUrl] = useState<string>(() => {
    return localStorage.getItem("destine_google_sheet_url") || "";
  });
  const [customGoogleSheetTabs, setCustomGoogleSheetTabs] = useState<string>(() => {
    return localStorage.getItem("destine_google_sheet_tabs") || "";
  });
  
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Check if the application is running in Embed Mode (Only Chat UI, no Admin/Config controls)
  const [isEmbedMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("embed") === "true" || params.get("chat_only") === "true";
    }
    return false;
  });

  // Floating Chat Widget state
  const [isWidgetOpen, setIsWidgetOpen] = useState<boolean>(true);
  const [widgetInput, setWidgetInput] = useState<string>("");

  // Admin password states
  const [adminPassword, setAdminPassword] = useState<string>(() => {
    return localStorage.getItem("destine_staff_password") || "";
  });
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isVerifyingLogin, setIsVerifyingLogin] = useState<boolean>(false);

  const [sheetError, setSheetError] = useState<string | null>(null);

  // Load spreadsheets from server
  const fetchSpreadsheets = async (overrideUrl?: string, overrideTabs?: string) => {
    try {
      const activeUrl = overrideUrl !== undefined ? overrideUrl : customGoogleSheetUrl;
      const activeTabs = overrideTabs !== undefined ? overrideTabs : customGoogleSheetTabs;
      
      let queryUrl = `/api/spreadsheets?t=${Date.now()}`;
      if (activeUrl) {
        queryUrl += `&customUrl=${encodeURIComponent(activeUrl)}`;
      }
      if (activeTabs) {
        queryUrl += `&customTabs=${encodeURIComponent(activeTabs)}`;
      }
      
      const res = await fetch(queryUrl);
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Erro ao carregar planilhas.");
      }

      if (data.spreadsheets) {
        setSpreadsheets(data.spreadsheets);
        setSheetError(null);
      }
    } catch (err: any) {
      console.error("Erro ao carregar planilhas do servidor:", err);
      setSheetError(err.message || "Erro desconhecido ao carregar planilhas.");
      if (overrideUrl !== undefined) {
        throw err;
      }
    }
  };

  const handleAdminLogin = async (password: string) => {
    setIsVerifyingLogin(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsAdminLoggedIn(true);
        setAdminPassword(password);
        localStorage.setItem("destine_staff_password", password);
      } else {
        setLoginError(data.error || "Senha incorreta.");
        setIsAdminLoggedIn(false);
      }
    } catch (err) {
      setLoginError("Erro ao conectar com o servidor.");
      setIsAdminLoggedIn(false);
    } finally {
      setIsVerifyingLogin(false);
    }
  };

  const handleAdminLogout = () => {
    setIsAdminLoggedIn(false);
    setAdminPassword("");
    localStorage.removeItem("destine_staff_password");
  };

  useEffect(() => {
    fetchSpreadsheets();
    
    // Poll the server for the latest spreadsheets every 5 seconds to sync all visitors automatically
    const interval = setInterval(() => {
      fetchSpreadsheets();
    }, 5000);

    if (adminPassword) {
      handleAdminLogin(adminPassword);
    }

    return () => clearInterval(interval);
  }, [adminPassword]);

  const saveSpreadsheets = async (updated: Spreadsheet[]) => {
    try {
      await fetch("/api/spreadsheets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${adminPassword}`
        },
        body: JSON.stringify({ spreadsheets: updated })
      });
    } catch (err: any) {
      console.error("Erro de sincronização de dados:", err);
    }
  };

  const handleImportSpreadsheet = (newSheet: Spreadsheet) => {
    const updated = [newSheet, ...spreadsheets];
    setSpreadsheets(updated);
    saveSpreadsheets(updated);
  };

  const handleDeleteSpreadsheet = (id: string) => {
    const updated = spreadsheets.filter((s) => s.id !== id);
    setSpreadsheets(updated);
    saveSpreadsheets(updated);
  };

  const handleUpdateSpreadsheet = (updatedSheet: Spreadsheet) => {
    const updated = spreadsheets.map((s) => s.id === updatedSheet.id ? updatedSheet : s);
    setSpreadsheets(updated);
    saveSpreadsheets(updated);
  };

  const handleResetDefaults = async () => {
    if (confirm("Deseja restaurar as planilhas de demonstração? Isso substituirá as modificações atuais pelas planilhas padrão.")) {
      try {
        const res = await fetch("/api/spreadsheets/reset", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${adminPassword}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          setSpreadsheets(data.spreadsheets || []);
          alert("Demonstração restaurada com sucesso!");
        } else {
          const data = await res.json();
          alert("Erro ao restaurar: " + data.error);
        }
      } catch (err: any) {
        alert("Erro de conexão ao restaurar: " + err.message);
      }
    }
  };

  const handleClearHistory = () => {
    setMessages([]);
    setErrorMessage(null);
  };

  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsGenerating(true);
    setErrorMessage(null);

    // Get custom key based on current provider
    const currentApiKey = 
      apiProvider === "gemini" ? geminiApiKey :
      apiProvider === "groq" ? groqApiKey :
      openaiApiKey;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: text,
          history: messages,
          customApiKey: currentApiKey,
          apiProvider: apiProvider,
          apiModel: apiModel,
          customGoogleSheetUrl: customGoogleSheetUrl,
          customGoogleSheetTabs: customGoogleSheetTabs,
          clientSpreadsheets: spreadsheets
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Algo deu errado durante a consulta.");
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-bot`,
        role: "assistant",
        content: data.reply,
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error("Erro na comunicação com a API:", err);
      setErrorMessage(
        err.message || "Erro de conexão ao servidor. Verifique o servidor local ou a chave de API."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // Aggregated Statistics
  const totalSheets = spreadsheets.length;
  const totalTabs = spreadsheets.reduce((acc, s) => acc + s.tabs.length, 0);
  const totalRecords = spreadsheets.reduce(
    (acc, s) => acc + s.tabs.reduce((innerAcc, t) => innerAcc + t.rows.length, 0),
    0
  );

  if (isEmbedMode) {
    return (
      <div className="w-full h-screen flex flex-col bg-[#0B0616] text-slate-100 font-sans antialiased overflow-hidden" id="embed-chat-root">
        {/* Header */}
        <div className="bg-[#120D23] border-b border-[#241B3E] p-4 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-500 to-[#D946EF] flex items-center justify-center border border-pink-400/30 shadow-[0_0_15px_rgba(217,70,239,0.15)]">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black text-white tracking-wide uppercase font-display flex items-center gap-1.5">
                <span>Suporte Digital • DESTINE 26</span>
                <Sparkle className="w-3.5 h-3.5 text-pink-400 fill-pink-400 animate-pulse" />
              </h1>
              <p className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D946EF] animate-pulse"></span>
                Base Operacional Ativa • {totalSheets} Fontes Integradas
              </p>
            </div>
          </div>

          {messages.length > 0 && (
            <button 
              onClick={handleClearHistory}
              className="text-[10px] text-zinc-400 hover:text-[#D946EF] bg-[#0B0616] border border-[#241B3E] hover:border-[#D946EF]/20 px-2.5 py-1.5 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> Limpar Histórico
            </button>
          )}
        </div>

        {/* Scrollable messages box */}
        <div className="flex-1 p-4 md:p-6 overflow-y-auto space-y-4 bg-[#0B0616]" style={{ backgroundImage: "radial-gradient(circle at top right, rgba(217, 70, 239, 0.02) 0%, rgba(11, 6, 22, 0) 60%)" }}>
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto px-4">
              <div className="w-16 h-16 rounded-2xl bg-pink-500/10 flex items-center justify-center border border-[#D946EF]/20 shadow-[0_0_20px_rgba(217,70,239,0.1)] animate-bounce">
                <Bot className="w-8 h-8 text-[#D946EF]" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Como posso ajudar você hoje?</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Consulte informações operacionais, horários de plantão, contatos de conselheiros e rotas médicas instantaneamente de forma segura.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full pt-3">
                <button 
                  onClick={() => handleSendMessage("Quem é o conselheiro da Adm Consult e qual o contato dele?")}
                  className="w-full text-left p-3 rounded-xl bg-[#120D23] border border-[#241B3E] hover:border-[#D946EF]/30 text-xs text-zinc-300 hover:text-[#D946EF] transition cursor-pointer"
                >
                  🏥 "Quem é o conselheiro da Adm Consult?"
                </button>
                <button 
                  onClick={() => handleSendMessage("O que fazer em caso de congressista passando mal no Pavilhão A?")}
                  className="w-full text-left p-3 rounded-xl bg-[#120D23] border border-[#241B3E] hover:border-[#D946EF]/30 text-xs text-zinc-300 hover:text-[#D946EF] transition cursor-pointer"
                >
                  🚨 "Congressista passando mal: qual protocolo?"
                </button>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <span className="text-[9px] text-[#D946EF]/70 mb-1 px-1">{msg.role === "user" ? "Você" : "Assistente"} • {msg.timestamp}</span>
                <div className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-[85%] md:max-w-[75%] ${
                  msg.role === "user" 
                    ? "bg-[#D946EF]/10 text-pink-200 border border-[#D946EF]/30 rounded-tr-none" 
                    : "bg-[#120D23] border border-[#241B3E] text-zinc-200 rounded-tl-none shadow-sm"
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))
          )}

          {isGenerating && (
            <div className="flex items-center gap-2 text-[#D946EF] px-1 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#D946EF] animate-bounce"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#D946EF] animate-bounce [animation-delay:0.2s]"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#D946EF] animate-bounce [animation-delay:0.4s]"></div>
              <span className="text-[9px] uppercase font-bold tracking-widest pl-1">Processando fontes integradas...</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-rose-950/60 border border-rose-900 rounded-xl text-xs text-rose-300 flex items-start gap-2 max-w-xl">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Input box */}
        <div className="p-4 bg-[#120D23] border-t border-[#241B3E] shrink-0">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              if (widgetInput.trim() && !isGenerating) {
                handleSendMessage(widgetInput);
                setWidgetInput("");
              }
            }}
            className="flex gap-2 max-w-4xl mx-auto"
          >
            <input
              type="text"
              value={widgetInput}
              onChange={(e) => setWidgetInput(e.target.value)}
              placeholder="Digite sua dúvida operacional aqui..."
              disabled={isGenerating}
              className="flex-1 bg-[#0B0616] rounded-xl px-4 py-3 text-xs border border-[#241B3E] text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#D946EF] focus:border-[#D946EF] transition"
            />
            <button
              type="submit"
              disabled={isGenerating || !widgetInput.trim()}
              className="p-3 rounded-xl bg-gradient-to-r from-pink-500 to-[#D946EF] hover:opacity-90 text-slate-950 disabled:bg-slate-800 disabled:text-zinc-600 transition shrink-0 flex items-center justify-center cursor-pointer"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </form>
          <div className="text-center mt-2">
            <span className="text-[9px] text-zinc-500">Destine 26 Intelligent System • Gemini/LLM Hybrid</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0616] text-slate-100 font-sans antialiased flex" id="app-root">
      
      {/* PERFECT REPLICA OF THE DESTINE 26 PORTAL DO STAFF SIDEBAR */}
      <aside className="w-64 border-r border-[#241B3E] bg-[#120D23] flex flex-col justify-between shrink-0 select-none" id="sidebar-portal">
        
        <div className="flex flex-col">
          {/* Logo Heading Header */}
          <div className="p-6 border-b border-[#241B3E]/60 flex flex-col gap-0.5">
            <h1 className="text-[#D946EF] font-black tracking-wider text-xl uppercase font-display flex items-center gap-1.5">
              <span>DESTINE 26</span>
              <Sparkle className="w-4 h-4 text-pink-400 animate-pulse fill-pink-400" />
            </h1>
            <span className="text-[11px] text-zinc-400 uppercase tracking-widest font-bold">
              Portal do Staff
            </span>
          </div>

          {/* Navigation Tree */}
          <nav className="p-3 space-y-1" id="sidebar-nav">
            <p className="px-3 py-1.5 text-[9px] font-bold text-zinc-500 uppercase tracking-widest pt-4">
              Base da Inteligência
            </p>

            <button
              className="w-full px-3 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer bg-gradient-to-r from-emerald-500/25 to-emerald-500/5 border-l-4 border-emerald-400 text-emerald-400"
            >
              <div className="flex items-center gap-2.5">
                <Bot className="w-4 h-4 text-emerald-400" />
                <span>Alimentação IA (Planilhas)</span>
              </div>
              <span className="text-[9px] bg-emerald-500/20 text-emerald-300 font-extrabold uppercase px-1.5 py-0.5 rounded-full shrink-0">
                Ativo
              </span>
            </button>
          </nav>
        </div>

        {/* PROFILE CARD AT BOTTOM LEFT (Exact replica of luismariofilho@gmail.com) */}
        <div className="p-4 border-t border-[#241B3E]/60 bg-[#0E0B1B]/80 flex items-center justify-between">
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold text-white truncate" title="luismariofilho@gmail.com">
              {isAdminLoggedIn ? "luismariofilho@gmail.com" : "Visitante Anônimo"}
            </span>
            <span className={`text-[9px] font-extrabold uppercase mt-0.5 px-2 py-0.5 rounded-full w-fit ${
              isAdminLoggedIn ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
            }`}>
              {isAdminLoggedIn ? "Staff Autenticado" : "Acesso Visitante"}
            </span>
          </div>
          
          {isAdminLoggedIn && (
            <button 
              onClick={handleAdminLogout}
              className="p-1 px-2.5 text-zinc-500 hover:text-rose-400 transition cursor-pointer"
              title="Sair do Portal"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>

      </aside>

      {/* MAIN VIEWPORT BODY CONTAINER */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0B0616]" style={{ backgroundImage: "radial-gradient(circle at top right, rgba(217, 70, 239, 0.03) 0%, rgba(11, 6, 22, 0) 60%)" }}>
        
        {/* VIEW: THE EXPERT IA BASE WORKSPACE (UPLOAD, TABLE BUILDERS & REVOLUTIONARY LOVABLE GUIDE) */}
        <div className="p-6 md:p-8 space-y-6 overflow-y-auto max-h-screen">
          
          {!isAdminLoggedIn ? (
            <div className="flex flex-col items-center justify-center py-20 px-4 max-w-md mx-auto text-center space-y-6" id="auth-gate-box">
              <div className="w-16 h-16 rounded-full bg-pink-500/10 flex items-center justify-center border border-pink-500/30 shadow-[0_0_20px_rgba(217,70,239,0.15)] animate-pulse">
                <Database className="w-8 h-8 text-[#D946EF]" />
              </div>
              
              <div>
                <h3 className="text-lg font-black text-white tracking-tight uppercase font-display">Portal do Staff • Acesso Restrito</h3>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                  O carregamento e edição de planilhas de contingência, conselheiros e manuais de emergência são restritos a organizadores credenciados do evento.
                </p>
              </div>

              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const pass = fd.get("password") as string;
                  if (pass.trim()) {
                    handleAdminLogin(pass);
                  }
                }}
                className="w-full space-y-3"
              >
                <div className="space-y-1 text-left">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">Senha do Staff</label>
                  <input
                    type="password"
                    name="password"
                    placeholder="Digite a senha..."
                    className="w-full bg-[#120D23] rounded-xl px-4 py-3 text-xs border border-[#241B3E] text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#D946EF] focus:border-[#D946EF] transition"
                  />
                  <p className="text-[10px] text-zinc-500 italic mt-1.5 pl-1">Dica de desenvolvimento: a senha padrão é <strong className="text-[#D946EF]">destine26</strong></p>
                </div>

                {loginError && (
                  <div className="p-3 bg-rose-950/40 border border-rose-900/60 rounded-xl text-[11px] text-rose-300 text-left flex items-start gap-2 animate-bounce">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{loginError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isVerifyingLogin}
                  className="w-full py-3 bg-gradient-to-r from-pink-500 to-[#D946EF] hover:opacity-95 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-50"
                >
                  {isVerifyingLogin ? "Verificando Credenciais..." : "Autenticar no Portal"}
                </button>
              </form>
            </div>
          ) : (
            <>
              {/* Tab header */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                    <Bot className="w-3.5 h-3.5" /> Workspace de Alimentação Automatizada
                  </span>
                  <h2 className="text-2xl font-black text-white tracking-tight mt-1">Sincronizador de Dados Gemini</h2>
                  <p className="text-xs text-zinc-400 mt-1">Carregue novos manuais, contatos de conselheiros e rotas médicas instantaneamente para a IA.</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleResetDefaults}
                    className="px-3.5 py-1.5 bg-[#120D23] hover:bg-[#1E1639] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 border border-[#241B3E] transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#D946EF]" /> Restaurar Demonstração
                  </button>
                </div>
              </div>

              {/* Upper Workspace Switcher inside page */}
              <div className="flex bg-[#0E0B1B] p-1 rounded-xl border border-[#241B3E] self-start w-fit flex-wrap gap-1">
                <button
                  onClick={() => setActiveAdminTab("upload")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    activeAdminTab === "upload" ? "bg-emerald-500 text-slate-950 shadow-md" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  1. Upload de Novas Planilhas
                </button>
                <button
                  onClick={() => setActiveAdminTab("tables")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    activeAdminTab === "tables" ? "bg-emerald-500 text-slate-950 shadow-md" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  2. Visualizar & Editar Tabelas ({totalSheets})
                </button>
                <button
                  onClick={() => setActiveAdminTab("config")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    activeAdminTab === "config" ? "bg-emerald-500 text-slate-950 shadow-md" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  3. Chave de API Gemini 🔑
                </button>
              </div>

              {/* TAB CONTENT A: UPLOAD INTERFACES */}
              {activeAdminTab === "upload" && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  
                  {sheetError && (
                    <div className="lg:col-span-12 bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl flex items-start gap-3 text-rose-200">
                      <BadgeAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <p className="font-bold text-rose-400">Aviso de Sincronização:</p>
                        <p className="leading-relaxed">{sheetError}</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Upload drag drop zone */}
                  <div className="lg:col-span-5 space-y-6">
                    <SpreadsheetImport onImport={handleImportSpreadsheet} />
                    
                    {/* Local Info panel */}
                    <div className="bg-[#120D23] border border-[#241B3E] p-5 rounded-2xl space-y-3">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <Database className="w-4 h-4 text-emerald-400" />
                        Status da Base Operacional
                      </h3>
                      <div className="grid grid-cols-2 gap-3 text-center">
                        <div className="p-3 bg-[#0B0616] rounded-xl border border-[#241B3E]">
                          <span className="text-[10px] text-zinc-500 font-bold block uppercase">Arquivos ativos</span>
                          <span className="text-xl font-bold text-white">{totalSheets}</span>
                        </div>
                        <div className="p-3 bg-[#0B0616] rounded-xl border border-[#241B3E]">
                          <span className="text-[10px] text-zinc-500 font-bold block uppercase">Registros totais</span>
                          <span className="text-xl font-bold text-emerald-400">{totalRecords}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed pt-1">
                        As planilhas carregadas são sincronizadas e guardadas no servidor central, garantindo que qualquer membro do staff possa consultar os dados atualizados em tempo real através do chat flutuante!
                      </p>
                    </div>
                  </div>

                  {/* Loaded list */}
                  <div className="lg:col-span-7 bg-[#120D23] border border-[#241B3E] rounded-2xl p-6 space-y-4">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Planilhas na Base Contextual da IA</h3>
                    
                    {spreadsheets.length > 0 ? (
                      <div className="space-y-3.5">
                        {spreadsheets.map((sheet) => (
                          <div key={sheet.id} className="p-4 bg-[#0B0616] border border-[#241B3E] rounded-xl flex items-center justify-between hover:border-emerald-500/20 transition">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shrink-0">
                                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-white leading-snug">{sheet.name}</h4>
                                <p className="text-[10px] text-zinc-500 mt-0.5">
                                  {sheet.rawFileName} — {sheet.tabs.reduce((sum, t) => sum + t.rows.length, 0)} registros em {sheet.tabs.length} abas
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => {
                                  setActiveAdminTab("tables");
                                }}
                                className="text-[11px] text-emerald-400 hover:underline font-bold"
                              >
                                Inspecionar
                              </button>
                              <button
                                onClick={() => handleDeleteSpreadsheet(sheet.id)}
                                className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/5 rounded transition cursor-pointer"
                                title="Remover fonte"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-zinc-500 text-xs italic">
                        Nenhuma planilha ativa. Faça upload de arquivos acima ou clique em "Restaurar Demonstração" no topo para restaurar as planilhas padrão!
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* TAB CONTENT B: DATABASE VIEWER */}
              {activeAdminTab === "tables" && (
                <div className="bg-[#120D23] border border-[#241B3E] rounded-2xl p-6 min-h-[500px]">
                  <SpreadsheetViewer
                    spreadsheets={spreadsheets}
                    onDeleteSheet={handleDeleteSpreadsheet}
                    onUpdateSheet={handleUpdateSpreadsheet}
                  />
                </div>
              )}

              {/* TAB CONTENT C: CONFIGURATIONS & GOOGLE SHEETS */}
              {activeAdminTab === "config" && (
                <div className="bg-[#120D23] border border-[#241B3E] rounded-2xl p-6 min-h-[400px] space-y-6 animate-fadeIn" id="api-key-config-tab">
                  {/* Section 1: Google Sheets Integration */}
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                      Integração de Planilhas Google (Google Sheets)
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1">
                      Conecte e sincronize suas planilhas do Google Drive em tempo real. Os dados da planilha serão lidos de forma serverless, e as respostas do chat de IA serão atualizadas instantaneamente!
                    </p>
                  </div>

                  {sheetError && (
                    <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl flex items-start gap-3 text-rose-200">
                      <BadgeAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <p className="font-bold text-rose-400">Erro de Sincronização:</p>
                        <p className="leading-relaxed">{sheetError}</p>
                      </div>
                    </div>
                  )}

                  <div className="p-4 bg-[#0B0616] rounded-xl border border-[#241B3E] space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">URL da Planilha Google (Compartilhada como "Qualquer pessoa com o link pode ler")</label>
                      <input
                        type="text"
                        value={customGoogleSheetUrl}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCustomGoogleSheetUrl(val);
                          localStorage.setItem("destine_google_sheet_url", val);
                        }}
                        placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                        className="w-full bg-[#120D23] rounded-lg px-3 py-2 text-xs border border-[#241B3E] text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Abas/Páginas a Carregar (Separadas por vírgula)</label>
                        <input
                          type="text"
                          value={customGoogleSheetTabs}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomGoogleSheetTabs(val);
                            localStorage.setItem("destine_google_sheet_tabs", val);
                          }}
                          placeholder="Geral, Protocolos_Saude, Fornecedores_Principais"
                          className="w-full bg-[#120D23] rounded-lg px-3 py-2 text-xs border border-[#241B3E] text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={async () => {
                            try {
                              await fetchSpreadsheets(customGoogleSheetUrl, customGoogleSheetTabs);
                              alert("Planilhas do Google Sheets importadas e sincronizadas com sucesso!");
                            } catch (e: any) {
                              alert("Erro ao sincronizar do Google Sheets: " + e.message);
                            }
                          }}
                          className="w-full px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                        >
                          <RefreshCw className="w-4 h-4 animate-spin-slow" />
                          Salvar e Sincronizar Agora 🔄
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 text-[11px] text-zinc-400 leading-relaxed bg-[#120D23]/50 p-3 rounded-lg border border-[#241B3E]">
                      <span className="text-amber-400 font-bold shrink-0">💡 Como preparar sua planilha:</span>
                      <div className="space-y-1 text-zinc-300">
                        <p>1. No seu Google Sheets, clique no botão azul <strong>Compartilhar (Share)</strong> no canto superior direito.</p>
                        <p>2. Mude o acesso geral para <strong>"Qualquer pessoa com o link" (Anyone with the link)</strong> como <strong>Leitor (Viewer)</strong>.</p>
                        <p>3. Certifique-se de que os nomes das abas correspondem aos nomes listados acima (ex: <code className="text-emerald-400 bg-black/30 px-1 py-0.5 rounded">Geral</code>, <code className="text-emerald-400 bg-black/30 px-1 py-0.5 rounded">Protocolos_Saude</code>, etc).</p>
                      </div>
                    </div>
                  </div>

                  <hr className="border-[#241B3E]" />

                  {/* Section 2: AI Provider Settings */}
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Key className="w-4 h-4 text-[#D946EF]" />
                      Configuração do Provedor de IA
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1">
                      Escolha o provedor de Inteligência Artificial desejado e configure as chaves de API correspondentes. Suas chaves são armazenadas com segurança localmente no seu navegador.
                    </p>
                  </div>

                  <div className="p-4 bg-[#0B0616] rounded-xl border border-[#241B3E] space-y-4">
                    {/* Segmented control for Provider Selection */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Provedor Ativo</label>
                      <div className="grid grid-cols-3 gap-2 bg-[#120D23] p-1 rounded-lg border border-[#241B3E]">
                        <button
                          type="button"
                          onClick={() => {
                            setApiProvider("gemini");
                            localStorage.setItem("destine_api_provider", "gemini");
                          }}
                          className={`py-1.5 rounded-md text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                            apiProvider === "gemini"
                              ? "bg-gradient-to-r from-[#D946EF] to-pink-600 text-white shadow-sm"
                              : "text-zinc-400 hover:text-white hover:bg-zinc-800/20"
                          }`}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Gemini
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setApiProvider("groq");
                            localStorage.setItem("destine_api_provider", "groq");
                          }}
                          className={`py-1.5 rounded-md text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                            apiProvider === "groq"
                              ? "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-sm"
                              : "text-zinc-400 hover:text-white hover:bg-zinc-800/20"
                          }`}
                        >
                          <Zap className="w-3.5 h-3.5" />
                          Groq
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setApiProvider("openai");
                            localStorage.setItem("destine_api_provider", "openai");
                          }}
                          className={`py-1.5 rounded-md text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                            apiProvider === "openai"
                              ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm"
                              : "text-zinc-400 hover:text-white hover:bg-zinc-800/20"
                          }`}
                        >
                          <Cpu className="w-3.5 h-3.5" />
                          OpenAI
                        </button>
                      </div>
                    </div>

                    {/* API Key Input based on selection */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">
                        {apiProvider === "gemini" && "Chave de API Gemini (AIzaSy...)"}
                        {apiProvider === "groq" && "Chave de API Groq (gsk-...)"}
                        {apiProvider === "openai" && "Chave de API OpenAI (sk-...)"}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={
                            apiProvider === "gemini" ? geminiApiKey :
                            apiProvider === "groq" ? groqApiKey :
                            openaiApiKey
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (apiProvider === "gemini") {
                              setGeminiApiKey(val);
                              localStorage.setItem("destine_gemini_api_key", val);
                            } else if (apiProvider === "groq") {
                              setGroqApiKey(val);
                              localStorage.setItem("destine_groq_api_key", val);
                            } else {
                              setOpenaiApiKey(val);
                              localStorage.setItem("destine_openai_api_key", val);
                            }
                          }}
                          placeholder={
                            apiProvider === "gemini" ? "Cole sua GEMINI_API_KEY aqui..." :
                            apiProvider === "groq" ? "Cole sua GROQ_API_KEY aqui..." :
                            "Cole sua OPENAI_API_KEY aqui..."
                          }
                          className="flex-1 bg-[#120D23] rounded-lg px-3 py-2 text-xs border border-[#241B3E] text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-[#D946EF] transition"
                        />
                        {((apiProvider === "gemini" && geminiApiKey) ||
                          (apiProvider === "groq" && groqApiKey) ||
                          (apiProvider === "openai" && openaiApiKey)) && (
                          <button
                            onClick={() => {
                              if (apiProvider === "gemini") {
                                setGeminiApiKey("");
                                localStorage.removeItem("destine_gemini_api_key");
                              } else if (apiProvider === "groq") {
                                setGroqApiKey("");
                                localStorage.removeItem("destine_groq_api_key");
                              } else {
                                setOpenaiApiKey("");
                                localStorage.removeItem("destine_openai_api_key");
                              }
                            }}
                            className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-bold transition border border-rose-500/20 cursor-pointer"
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Custom Model Input */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Modelo Customizado (Opcional)</label>
                        <span className="text-[9px] text-zinc-500 font-medium">Deixe em branco para usar o padrão</span>
                      </div>
                      <input
                        type="text"
                        value={apiModel}
                        onChange={(e) => {
                          const val = e.target.value;
                          setApiModel(val);
                          localStorage.setItem("destine_api_model", val);
                        }}
                        placeholder={
                          apiProvider === "gemini" ? "Ex: gemini-3.5-flash ou gemini-2.5-pro" :
                          apiProvider === "groq" ? "Ex: llama-3.1-8b-instant ou mixtral-8x7b-32768" :
                          "Ex: gpt-4o-mini ou gpt-4o"
                        }
                        className="w-full bg-[#120D23] rounded-lg px-3 py-2 text-xs border border-[#241B3E] text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-[#D946EF] transition"
                      />
                    </div>
                    
                    <div className="flex items-start gap-2.5 text-[11px] text-zinc-400 leading-relaxed bg-[#120D23]/50 p-3 rounded-lg border border-[#241B3E]">
                      <span className="text-amber-400 font-bold shrink-0">💡 Nota:</span>
                      <div className="text-zinc-300">
                        {apiProvider === "gemini" && "Se deixado em branco, o sistema tentará usar a chave padrão configurada na nuvem / variáveis de ambiente do servidor (process.env.GEMINI_API_KEY) rodando o modelo gemini-3.5-flash."}
                        {apiProvider === "groq" && "O sistema usará a variável de ambiente GROQ_API_KEY se nenhuma chave personalizada for inserida aqui. O modelo padrão é llama-3.1-8b-instant, perfeito para responder rapidamente a grandes volumes de dados."}
                        {apiProvider === "openai" && "O sistema usará a variável de ambiente OPENAI_API_KEY se nenhuma chave personalizada for inserida aqui. O modelo padrão é gpt-4o-mini."}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3.5 pt-2">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Como obter uma Chave de API?</h4>
                    {apiProvider === "gemini" && (
                      <ol className="list-decimal list-inside text-xs text-zinc-400 space-y-2 leading-relaxed">
                        <li>Acesse o console do <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-[#D946EF] hover:underline font-bold">Google AI Studio</a></li>
                        <li>Clique em <strong>"Get API key"</strong> no menu superior</li>
                        <li>Clique em <strong>"Create API key"</strong> e copie a chave gerada</li>
                        <li>Cole a chave no campo acima para uso imediato no sistema!</li>
                      </ol>
                    )}
                    {apiProvider === "groq" && (
                      <ol className="list-decimal list-inside text-xs text-zinc-400 space-y-2 leading-relaxed">
                        <li>Acesse o <a href="https://console.groq.com/" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline font-bold">Groq Console</a></li>
                        <li>Navegue até a seção <strong>"API Keys"</strong> no menu lateral</li>
                        <li>Clique em <strong>"Create API Key"</strong>, dê um nome e copie a chave (gsk-...)</li>
                        <li>Cole a chave acima. O Groq oferece velocidades absurdamente rápidas de processamento!</li>
                      </ol>
                    )}
                    {apiProvider === "openai" && (
                      <ol className="list-decimal list-inside text-xs text-zinc-400 space-y-2 leading-relaxed">
                        <li>Acesse a plataforma <a href="https://platform.openai.com/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline font-bold">OpenAI Platform</a></li>
                        <li>Vá em <strong>"API Keys"</strong> no menu lateral esquerdo</li>
                        <li>Clique em <strong>"Create new secret key"</strong> e copie a chave (sk-...)</li>
                        <li>Cole no campo acima. Lembre-se de que sua conta OpenAI precisa ter créditos ativos.</li>
                      </ol>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

        </div>

      </main>

      {/* ABSOLUTE FLOATING CHAT WIDGET - Bottom Right Corner */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3" id="floating-widget-wrapper">
        
        {/* Expanded Chat Widget window */}
        {isWidgetOpen && (
          <div className="w-[380px] sm:w-[420px] h-[580px] bg-[#120D23] border border-[#D946EF]/30 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 scale-100 origin-bottom-right" id="widget-box-frame">
            
            {/* Widget Header with clean styling */}
            <div className="bg-gradient-to-r from-[#D946EF] via-pink-600 to-[#9d17aa] p-4 flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-slate-950/30 flex items-center justify-center border border-white/10">
                  <Bot className="w-4.5 h-4.5 text-pink-200" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white tracking-wide">Suporte Interno • Staff DESTINE</h3>
                  <p className="text-[10px] text-pink-100 opacity-90 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-pink-300 animate-pulse"></span>
                    Base da IA Conectada ({totalSheets} Planilhas)
                  </p>
                </div>
              </div>
              
              <button 
                onClick={() => setIsWidgetOpen(false)}
                className="p-1 px-2.5 bg-slate-950/20 hover:bg-slate-950/40 text-white rounded-md text-[11px] transition"
              >
                Fechar
              </button>
            </div>

            {/* Sub-header info banner indicating loaded source sheets */}
            <div className="bg-[#0B0616] px-4 py-2.5 border-b border-[#241B3E]/60 text-[10px] text-zinc-400 flex items-center justify-between">
              <span>📂 Fontes Operacionais: <strong>{totalSheets} planilhas</strong> e <strong>{totalTabs} abas</strong></span>
              <button 
                onClick={() => {
                  setActiveAdminTab("upload");
                }}
                className="text-[#D946EF] hover:underline font-bold"
              >
                Carregar Planilhas
              </button>
            </div>

            {/* Widget Messages Container */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#120D23]/40">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-3 px-4">
                  <div className="w-12 h-12 rounded-full bg-[#1C1236] flex items-center justify-center border border-[#D946EF]/20">
                    <Bot className="w-6 h-6 text-[#D946EF]" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-white">Pronto para apoiar o Staff</p>
                    <p className="text-[11px] text-zinc-400 max-w-64 leading-relaxed">
                      Pergunte sobre procedimentos de saúde, regras operacionais, ou plantão de conselheiros indexados nas planilhas.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 w-full pt-2">
                    <button 
                      onClick={() => handleSendMessage("Quem é o conselheiro da Adm Consult e qual o contato dele?")}
                      className="w-full text-left p-2.5 rounded-lg bg-[#0B0616] border border-[#241B3E] text-[11px] text-zinc-300 hover:text-[#D946EF] hover:border-[#D946EF]/30 transition"
                    >
                      🏥 "Quem é o conselheiro da Adm Consult?"
                    </button>
                    <button 
                      onClick={() => handleSendMessage("O que fazer em caso de congressista passando mal no Pavilhão A?")}
                      className="w-full text-left p-2.5 rounded-lg bg-[#0B0616] border border-[#241B3E] text-[11px] text-zinc-300 hover:text-[#D946EF] hover:border-[#D946EF]/30 transition"
                    >
                      🚨 "Congressista passando mal: qual protocolo?"
                    </button>
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div 
                    key={msg.id} 
                    className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <span className="text-[9px] text-[#D946EF]/70 mb-0.5 px-1">{msg.role === "user" ? "Staff" : "IA Assistente"} • {msg.timestamp}</span>
                    <div className={`p-3 rounded-xl text-xs leading-relaxed max-w-[85%] ${
                      msg.role === "user" 
                        ? "bg-[#D946EF]/10 text-pink-200 border border-[#D946EF]/30 rounded-tr-none" 
                        : "bg-[#0B0616] border border-[#241B3E] text-zinc-200 rounded-tl-none"
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))
              )}

              {isGenerating && (
                <div className="flex items-center gap-2 text-[#D946EF] px-1 py-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#D946EF] animate-bounce"></div>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#D946EF] animate-bounce [animation-delay:0.2s]"></div>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#D946EF] animate-bounce [animation-delay:0.4s]"></div>
                  <span className="text-[9px] uppercase font-bold tracking-widest pl-1">Vasculhando planilhas...</span>
                </div>
              )}

              {errorMessage && (
                <div className="p-3 bg-rose-950/60 border border-rose-900 rounded-xl text-[11px] text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>

            {/* Widget Input Area */}
            <div className="p-3 bg-[#0B0616] border-t border-[#241B3E]/60">
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (widgetInput.trim() && !isGenerating) {
                    handleSendMessage(widgetInput);
                    setWidgetInput("");
                  }
                }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  value={widgetInput}
                  onChange={(e) => setWidgetInput(e.target.value)}
                  placeholder="Faça perguntas operacionais..."
                  disabled={isGenerating}
                  className="flex-1 bg-[#120D23] rounded-xl px-3 py-2.5 text-xs border border-[#241B3E] text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#D946EF] focus:border-[#D946EF]"
                />
                <button
                  type="submit"
                  disabled={isGenerating || !widgetInput.trim()}
                  className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-[#D946EF] hover:opacity-90 text-slate-950 disabled:bg-slate-800 disabled:text-zinc-600 transition shrink-0 animate-pulse"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </form>
              <div className="flex items-center justify-between mt-2.5 px-1">
                <span className="text-[9px] text-zinc-500">Gemini Active RAG • Destine 26</span>
                {messages.length > 0 && (
                  <button 
                    onClick={handleClearHistory}
                    className="text-[9px] text-[#D946EF] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" /> Limpar Conversa
                  </button>
                )}
              </div>
            </div>

          </div>
        )}

        {/* Glowing Trigger Circle Button */}
        <button
          onClick={() => setIsWidgetOpen(!isWidgetOpen)}
          className="w-14 h-14 rounded-full bg-gradient-to-tr from-pink-500 to-[#D946EF] text-white flex items-center justify-center shadow-2xl shadow-pink-500/20 border border-pink-400 transition transform hover:scale-105 active:scale-95 cursor-pointer relative"
          title="Abrir Chat de Suporte Staff"
        >
          {isWidgetOpen ? (
            <span className="text-base font-extrabold font-mono text-white">X</span>
          ) : (
            <Bot className="w-6 h-6 text-white animate-pulse" />
          )}
        </button>

      </div>

    </div>
  );
}
