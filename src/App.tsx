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
  Send,
  Trash2,
  LogOut,
  Sparkle,
  Phone,
  FileText,
  BadgeAlert
} from "lucide-react";

export default function App() {
  const [spreadsheets, setSpreadsheets] = useState<Spreadsheet[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  // Tab control for the main Workspace
  const [activeAdminTab, setActiveAdminTab] = useState<"upload" | "tables">("upload");
  
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Floating Chat Widget state
  const [isWidgetOpen, setIsWidgetOpen] = useState<boolean>(true);
  const [widgetInput, setWidgetInput] = useState<string>("");

  // Initialize and load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sheet_assistant_spreadsheets");
    if (saved) {
      try {
        setSpreadsheets(JSON.parse(saved));
      } catch (err) {
        console.error("Erro ao carregar do cache local:", err);
        setSpreadsheets(DEFAULT_SPREADSHEETS);
      }
    } else {
      setSpreadsheets(DEFAULT_SPREADSHEETS);
      localStorage.setItem("sheet_assistant_spreadsheets", JSON.stringify(DEFAULT_SPREADSHEETS));
    }
  }, []);

  const saveSpreadsheets = (updated: Spreadsheet[]) => {
    setSpreadsheets(updated);
    localStorage.setItem("sheet_assistant_spreadsheets", JSON.stringify(updated));
  };

  const handleImportSpreadsheet = (newSheet: Spreadsheet) => {
    const updated = [newSheet, ...spreadsheets];
    saveSpreadsheets(updated);
  };

  const handleDeleteSpreadsheet = (id: string) => {
    const updated = spreadsheets.filter((s) => s.id !== id);
    saveSpreadsheets(updated);
  };

  const handleUpdateSpreadsheet = (updatedSheet: Spreadsheet) => {
    const updated = spreadsheets.map((s) => s.id === updatedSheet.id ? updatedSheet : s);
    saveSpreadsheets(updated);
  };

  const handleResetDefaults = () => {
    if (confirm("Deseja restaurar as planilhas de demonstração? Seus dados atuais serão mantidos junto com os novos.")) {
      const merged = [...DEFAULT_SPREADSHEETS, ...spreadsheets.filter(s => !DEFAULT_SPREADSHEETS.some(df => df.id === s.id))];
      saveSpreadsheets(merged);
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

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: text,
          history: messages,
          sheets: spreadsheets
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
              luismariofilho@gmail.com
            </span>
            <span className="text-[10px] text-zinc-500 font-bold uppercase mt-0.5">
              Administrador / Staff
            </span>
          </div>
          
          <button 
            onClick={() => alert("Simulando desautenticação do Portal do Staff.")}
            className="p-1 px-2.5 text-zinc-500 hover:text-rose-400 transition cursor-pointer"
            title="Sair do Portal"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

      </aside>

      {/* MAIN VIEWPORT BODY CONTAINER */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0B0616]" style={{ backgroundImage: "radial-gradient(circle at top right, rgba(217, 70, 239, 0.03) 0%, rgba(11, 6, 22, 0) 60%)" }}>
        
        {/* VIEW: THE EXPERT IA BASE WORKSPACE (UPLOAD, TABLE BUILDERS & REVOLUTIONARY LOVABLE GUIDE) */}
        <div className="p-6 md:p-8 space-y-6 overflow-y-auto max-h-screen">
          
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
          <div className="flex bg-[#0E0B1B] p-1 rounded-xl border border-[#241B3E] self-start w-fit">
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
          </div>

          {/* TAB CONTENT A: UPLOAD INTERFACES */}
          {activeAdminTab === "upload" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Upload drag drop zone */}
              <div className="lg:col-span-5 space-y-6">
                <SpreadsheetImport onImport={handleImportSpreadsheet} />
                
                {/* Local Info panel */}
                <div className="bg-[#120D23] border border-[#241B3E] p-5 rounded-2xl space-y-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-emerald-400" />
                    Status do Banco Local (RAG)
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
                    As planilhas carregadas são guardadas com segurança no <strong>localStorage</strong> de desenvolvimento do seu navegador. 
                    O chat flutuante na direita lerá estas tabelas para responder as perguntas imediatamente.
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
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
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
