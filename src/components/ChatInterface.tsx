import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Send, Bot, User, Sparkles, AlertCircle, HelpCircle, ArrowRight, RefreshCw, Trash2 } from "lucide-react";
import { ChatMessage, Spreadsheet } from "../types";

interface ChatInterfaceProps {
  spreadsheets: Spreadsheet[];
  messages: ChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  onClearHistory: () => void;
  isGenerating: boolean;
  errorMessage: string | null;
}

export default function ChatInterface({
  spreadsheets,
  messages,
  onSendMessage,
  onClearHistory,
  isGenerating,
  errorMessage
}: ChatInterfaceProps) {
  const [inputText, setInputText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  // Suggested Prompts based on available spreadsheets
  const getSuggestions = () => {
    if (!spreadsheets || spreadsheets.length === 0) {
      return [
        "Quais planilhas estão disponíveis e como posso carregá-las?",
        "Como configurar e sincronizar uma planilha do Google Sheets?",
        "Quais são as diretrizes de resposta para incidentes operacionais?"
      ];
    }

    const suggestions: string[] = [];

    // Loop through spreadsheets and tabs to find relevant headers and rows
    for (const sheet of spreadsheets) {
      for (const tab of sheet.tabs) {
        if (tab.rows && tab.rows.length > 0) {
          const headers = tab.headers.map(h => h.toLowerCase().trim());
          
          // 1. Look for Contact info
          const nameIdx = headers.findIndex(h => h.includes("nome") || h.includes("conselheiro") || h.includes("embaixador") || h.includes("ej") || h.includes("empresa"));
          const contactIdx = headers.findIndex(h => h.includes("contato") || h.includes("telefone") || h.includes("email") || h.includes("whatsapp") || h.includes("celular"));
          
          if (nameIdx !== -1 && tab.rows[0]) {
            const row = tab.rows[0];
            const nameCol = tab.headers[nameIdx];
            const nameValue = String(row[nameCol] || "").trim();
            
            if (nameValue && nameValue.length < 50) {
              if (contactIdx !== -1) {
                suggestions.push(`Qual o contato do ${nameValue} (${sheet.name})?`);
              } else {
                suggestions.push(`Quais são os dados cadastrados para ${nameValue}?`);
              }
            }
          }

          // 2. Look for Procedures/Incidents
          const probIdx = headers.findIndex(h => h.includes("situa") || h.includes("problema") || h.includes("incidente") || h.includes("emerg") || h.includes("caso") || h.includes("ocorr"));
          if (probIdx !== -1 && tab.rows[0]) {
            const row = tab.rows[0];
            const probCol = tab.headers[probIdx];
            const probValue = String(row[probCol] || "").trim();
            if (probValue && probValue.length > 3 && probValue.length < 80) {
              suggestions.push(`O que fazer em caso de: "${probValue}"?`);
            }
          }
          
          // 3. Look for Location/Role info
          const locIdx = headers.findIndex(h => h.includes("local") || h.includes("sala") || h.includes("pavilhao") || h.includes("setor"));
          if (locIdx !== -1 && tab.rows[0]) {
            const row = tab.rows[0];
            const locCol = tab.headers[locIdx];
            const locValue = String(row[locCol] || "").trim();
            if (locValue && locValue.length < 55) {
              suggestions.push(`Quais atividades ou contatos estão alocados no setor/local ${locValue}?`);
            }
          }
        }
      }
    }

    // 4. Fallback based on Sheet names
    if (suggestions.length < 3) {
      for (const sheet of spreadsheets) {
        suggestions.push(`Quais informações estão registradas na planilha "${sheet.name}"?`);
        if (sheet.tabs.length > 0) {
          suggestions.push(`Faça um resumo dos dados encontrados na aba "${sheet.tabs[0].name}" de "${sheet.name}".`);
        }
      }
    }

    // Remove duplicates and slice to 3
    const uniqueSuggestions = Array.from(new Set(suggestions)).filter(Boolean);
    
    // Final fallback to guarantee 3 items
    if (uniqueSuggestions.length < 3) {
      uniqueSuggestions.push("Faça um resumo geral de quem trabalha em cada setor.");
      uniqueSuggestions.push("Como entrar em contato com os embaixadores do evento?");
      uniqueSuggestions.push("Quais são as colunas de dados registradas nas planilhas ativas?");
    }

    return uniqueSuggestions.slice(0, 3);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isGenerating) return;
    
    const textToSend = inputText;
    setInputText("");
    onSendMessage(textToSend);
  };

  const handleSuggestionClick = (text: string) => {
    if (isGenerating) return;
    onSendMessage(text);
  };

  return (
    <div className="flex flex-col bg-white rounded-xl border border-slate-100 shadow-sm h-[500px] sm:h-[600px] overflow-hidden w-full" id="chat-interface">
      {/* Mini Header */}
      <div className="bg-slate-50/50 border-b border-slate-50 px-3 sm:px-5 py-3 flex items-center justify-between shrink-0 gap-2" id="chat-header">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-slate-800 truncate">Assistente IA de Planilhas</h3>
            <p className="text-[9px] sm:text-[10px] text-slate-500 font-medium truncate">Buscando respostas nos registros ativos</p>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            id="btn-clear-chat"
            onClick={onClearHistory}
            className="flex items-center gap-1 text-[10px] sm:text-[11px] text-slate-400 hover:text-rose-600 font-medium px-2 py-1.5 rounded-lg hover:bg-rose-50 transition shrink-0 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Limpar Conversa</span><span className="sm:hidden">Limpar</span>
          </button>
        )}
      </div>

      {/* Main Conversation Logs */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 bg-slate-50/30 mini-scrollbar" id="chat-scroller">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-4" id="chat-welcome-state">
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Pronto para responder suas dúvidas</h4>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                As planilhas carregadas servem como base de conhecimento para o assistente. Faça perguntas diretas em português sobre contatos, condutas e protocolos.
              </p>
            </div>

            {/* Suggestions cards */}
            <div className="w-full space-y-2 pt-2" id="chat-suggestions-list">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                Sugestões de Perguntas
              </p>
              {getSuggestions().map((sug, i) => (
                <button
                  id={`suggestion-btn-${i}`}
                  key={i}
                  onClick={() => handleSuggestionClick(sug)}
                  className="w-full text-left text-xs text-slate-700 bg-white border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/10 p-3 rounded-xl flex items-center justify-between group transition duration-200 cursor-pointer"
                >
                  <span className="font-medium line-clamp-1">{sug}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition shrink-0 ml-1.5" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4" id="messages-list">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 max-w-[85%] ${
                  msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                }`}
                id={`msg-bubble-${msg.id}`}
              >
                {/* Avatar Icon */}
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 select-none ${
                    msg.role === "user"
                      ? "bg-slate-200 text-slate-700"
                      : "bg-emerald-500 text-white"
                  }`}
                >
                  {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                {/* Bubble message box */}
                <div className="space-y-1">
                  <div
                    className={`px-4 py-3 rounded-2xl text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-slate-800 text-slate-100 rounded-tr-xs"
                        : "bg-white border border-slate-100 text-slate-700 shadow-xs rounded-tl-xs"
                    }`}
                  >
                    <div className="markdown-body">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                  <p className="text-[9px] text-slate-400 px-1 text-right">
                    {msg.timestamp}
                  </p>
                </div>
              </div>
            ))}

            {/* Simulated generation loading state */}
            {isGenerating && (
              <div className="flex gap-3 max-w-[80%]" id="assistant-typing-status">
                <div className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center text-xs shrink-0 select-none">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-white border border-slate-100 text-slate-700 px-4 py-3.5 rounded-2xl rounded-tl-xs shadow-xs text-xs flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
                  <span className="font-semibold text-slate-500">Analisando planilhas e redigindo resposta...</span>
                </div>
              </div>
            )}

            {/* Error notifications */}
            {errorMessage && (
              <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl flex gap-2 text-rose-800 text-xs text-left max-w-[90%]" id="gemini-error-card">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Erro do Sistema</p>
                  <p className="font-medium leading-normal">{errorMessage}</p>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input panel form */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-slate-100 bg-white" id="chat-input-form">
        <div className="relative flex items-center" id="input-chat-row">
          <input
            id="chat-text-input"
            type="text"
            placeholder={
              spreadsheets.length === 0
                ? "Alimente uma planilha para liberar o assistente..."
                : "Digite sua dúvida (ex: Quem é o conselheiro do Adm Consult?)..."
            }
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={spreadsheets.length === 0 || isGenerating}
            className="w-full text-xs pl-4 pr-12 py-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-emerald-500 focus:bg-white text-slate-800 font-semibold transition placeholder:font-medium placeholder:text-slate-400"
          />
          <button
            id="chat-submit-btn"
            type="submit"
            disabled={spreadsheets.length === 0 || !inputText.trim() || isGenerating}
            className="absolute right-2 p-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded-lg transition"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
