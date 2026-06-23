import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Plus, Link, Code, CheckCircle, AlertTriangle } from "lucide-react";
import { Spreadsheet, Tab } from "../types";

interface SpreadsheetImportProps {
  onImport: (newSheet: Spreadsheet) => void;
}

export default function SpreadsheetImport({ onImport }: SpreadsheetImportProps) {
  const [activeTab, setActiveTab] = useState<"file" | "paste" | "link">("file");
  const [sheetName, setSheetName] = useState("");
  const [csvPaste, setCsvPaste] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Trigger file dialog
  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  // Drag over handler
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  // Drop handler
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  // File selection handler
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  // Process selected file (Excel or CSV)
  const processFile = (file: File) => {
    const reader = new FileReader();
    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    const defaultName = file.name.replace(/\.[^/.]+$/, ""); // strip extension
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("Não foi possível ler o conteúdo do arquivo.");

        let parsedTabs: Tab[] = [];

        if (isExcel) {
          const workbook = XLSX.read(data, { type: "binary" });
          workbook.SheetNames.forEach((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as Array<Record<string, any>>;
            
            if (rawJson.length > 0) {
              // Extract unique keys as headers
              const headers = Array.from(
                new Set(rawJson.flatMap((row) => Object.keys(row)))
              );
              
              parsedTabs.push({
                name: sheetName,
                headers: headers,
                rows: rawJson.map((row) => {
                  const newRow: Record<string, any> = {};
                  headers.forEach((h) => {
                    newRow[h] = row[h] !== undefined ? String(row[h]) : "";
                  });
                  return newRow;
                })
              });
            }
          });
        } else {
          // Process CSV
          const text = new TextDecoder("utf-8").decode(data as ArrayBuffer);
          parsedTabs = [parseCsvText("Geral", text)];
        }

        if (parsedTabs.length === 0) {
          throw new Error("O arquivo lido parece estar vazio ou não possuía linhas de dados válidas.");
        }

        const newSpreadsheet: Spreadsheet = {
          id: `sheet-${Date.now()}`,
          name: sheetName.trim() || defaultName,
          rawFileName: file.name,
          updatedAt: new Date().toLocaleDateString("pt-BR"),
          tabs: parsedTabs,
        };

        onImport(newSpreadsheet);
        setSheetName("");
        setStatus({
          type: "success",
          message: `Sucesso! Planilha "${newSpreadsheet.name}" importada com ${parsedTabs.length} abas.`
        });
      } catch (err: any) {
        console.error(err);
        setStatus({
          type: "error",
          message: `Falha na leitura do arquivo: ${err.message || "Erro desconhecido"}`
        });
      }
    };

    if (isExcel) {
      reader.readAsBinaryString(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  // Parse Raw CSV Text
  const parseCsvText = (tabName: string, text: string): Tab => {
    // Clean carriage returns
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length === 0) {
       throw new Error("Conteúdo CSV está vazio.");
    }

    // Determine separator: comma, semicolon, or tab
    const firstLine = lines[0];
    let separator = ",";
    if (firstLine.includes(";")) {
      separator = ";";
    } else if (firstLine.includes("\t")) {
      separator = "\t";
    }

    // A simple CSV cell-splitter handling quotes
    const splitCsvLine = (line: string): string[] => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === separator && !inQuotes) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      // Clean quotes from final entries
      return result.map(cell => cell.replace(/^['"]|['"]$/g, ""));
    };

    const headers = splitCsvLine(lines[0]);
    const rows: Array<Record<string, string>> = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      if (cols.length === 0) continue;
      
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = cols[index] !== undefined ? cols[index] : "";
      });
      rows.push(row);
    }

    return {
      name: tabName,
      headers,
      rows
    };
  };

  // Import pasted plain CSV
  const handlePasteImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvPaste.trim()) {
      setStatus({ type: "error", message: "Insira o conteúdo CSV primeiro." });
      return;
    }
    const nameToUse = sheetName.trim() || `Planilha Colada ${new Date().toLocaleTimeString()}`;
    try {
      const tab = parseCsvText("Geral", csvPaste);
      const newSpreadsheet: Spreadsheet = {
        id: `sheet-${Date.now()}`,
        name: nameToUse,
        rawFileName: "colagem_manual.csv",
        updatedAt: new Date().toLocaleDateString("pt-BR"),
        tabs: [tab]
      };
      onImport(newSpreadsheet);
      setSheetName("");
      setCsvPaste("");
      setStatus({
        type: "success",
        message: `Sucesso! Planilha manual "${newSpreadsheet.name}" importada com sucesso.`
      });
    } catch (err: any) {
      setStatus({ type: "error", message: err.message || "Falha ao processar texto colado." });
    }
  };

  // Google Sheets link import
  const handleLinkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleUrl.trim()) {
      setStatus({ type: "error", message: "Informe a URL da Planilha." });
      return;
    }

    let exportUrl = googleUrl;
    // Check if google spreadsheet link
    if (googleUrl.includes("docs.google.com/spreadsheets")) {
      // Modify URL to export as CSV directly
      const cleanUrl = googleUrl.split("/edit")[0];
      exportUrl = `${cleanUrl}/export?format=csv`;
    }

    setStatus({ type: "success", message: "Buscando planilha remota..." });

    try {
      const res = await fetch(exportUrl);
      if (!res.ok) {
        throw new Error("Não foi possível acessar a URL. Certifique-se de que a planilha está publicada na Web (Compartilhar -> Publicar na Web).");
      }
      const text = await res.text();
      const tab = parseCsvText("Sheet1", text);
      
      const fallbackName = `Sheets Google (${new Date().toLocaleDateString("pt-BR")})`;
      const newSpreadsheet: Spreadsheet = {
        id: `sheet-${Date.now()}`,
        name: sheetName.trim() || fallbackName,
        rawFileName: "google_sheets_import.csv",
        updatedAt: new Date().toLocaleDateString("pt-BR"),
        tabs: [tab]
      };

      onImport(newSpreadsheet);
      setSheetName("");
      setGoogleUrl("");
      setStatus({
        type: "success",
        message: `Planilha importada diretamente do Google Sheets com sucesso!`
      });
    } catch (err: any) {
      setStatus({
        type: "error",
        message: `Erro ao importar URL: ${err.message || "Erro de conexão"}. Dica: No Google Planilhas, vá em Arquivo -> Compartilhar -> Publicar na Web e selecione o formato CSV.`
      });
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4" id="import-container">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2" id="import-title">
          <Plus className="w-4 h-4 text-emerald-500" /> Alimentar Nova Planilha
        </h3>
        
        {/* Nav sub-tabs */}
        <div className="flex bg-slate-50 p-1 rounded-lg text-xs" id="import-nav">
          <button
            id="tab-btn-file"
            onClick={() => { setActiveTab("file"); setStatus(null); }}
            className={`px-3 py-1.5 rounded-md font-medium transition ${
              activeTab === "file" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Upload Arquivo
          </button>
          <button
            id="tab-btn-paste"
            onClick={() => { setActiveTab("paste"); setStatus(null); }}
            className={`px-3 py-1.5 rounded-md font-medium transition ${
              activeTab === "paste" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Copiar/Colar CSV
          </button>
          <button
            id="tab-btn-link"
            onClick={() => { setActiveTab("link"); setStatus(null); }}
            className={`px-3 py-1.5 rounded-md font-medium transition ${
              activeTab === "link" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Link Google Sheets
          </button>
        </div>
      </div>

      {/* Sheet Name Input */}
      <div className="space-y-1.5" id="sheet-name-field">
        <label className="text-xs font-semibold text-slate-600 block">
          Nome Personalizado (Opcional):
        </label>
        <input
          id="input-sheet-name"
          type="text"
          placeholder="Ex: Contatos Oficiais, Escala de Emergência..."
          value={sheetName}
          onChange={(e) => setSheetName(e.target.value)}
          className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      {/* Tab Contents */}
      <div id="tab-content" className="mt-2">
        {activeTab === "file" && (
          <div
            id="drag-and-drop-zone"
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={onButtonClick}
            className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition ${
              dragActive
                ? "border-emerald-500 bg-emerald-50/50"
                : "border-slate-200 hover:border-emerald-400 bg-slate-50/40"
            }`}
          >
            <input
              id="file-input-raw"
              ref={fileInputRef}
              type="file"
              onChange={handleChange}
              accept=".csv, .xlsx, .xls"
              className="hidden"
            />
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="p-3 bg-white rounded-full border border-slate-100 shadow-xs text-slate-500">
                <Upload className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  Arraste seu arquivo Excel ou CSV aqui
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  ou clique para navegar no seu computador (.xlsx, .xls, .csv)
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "paste" && (
          <form onSubmit={handlePasteImport} className="space-y-3" id="form-paste">
            <textarea
              id="textarea-csv-paste"
              rows={4}
              placeholder={`Cole aqui as linhas separadas por vírgula ou ponto-e-vírgula. Ex:\nEmpresa;Conselheiro;Cargo\nAdm Consult;Carlos Silva;Sênior`}
              value={csvPaste}
              onChange={(e) => setCsvPaste(e.target.value)}
              className="w-full text-xs font-mono p-3 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            />
            <button
              id="btn-submit-paste"
              type="submit"
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition"
            >
              <Code className="w-3.5 h-3.5" /> Importar Texto Colado
            </button>
          </form>
        )}

        {activeTab === "link" && (
          <form onSubmit={handleLinkImport} className="space-y-3" id="form-link">
            <input
              id="input-google-url"
              type="url"
              placeholder="Cole a URL do Google Planilhas (ex: https://docs.google.com/...)"
              value={googleUrl}
              onChange={(e) => setGoogleUrl(e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            />
            <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 text-[10px] text-slate-500 leading-relaxed">
              💡 <strong>Como publicar:</strong> No Google Sheets, clique em <strong>Arquivo</strong> → <strong>Compartilhar</strong> → <strong>Publicar na Web</strong>. Escolha "Valores Separados por Vírgula (.csv)", clique em Publicar e copie o link gerado!
            </div>
            <button
              id="btn-submit-link"
              type="submit"
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition"
            >
              <Link className="w-3.5 h-3.5" /> Conectar Planilha Remota
            </button>
          </form>
        )}
      </div>

      {/* Import status notification */}
      {status && (
        <div
          id="import-status-banner"
          className={`px-3 py-2.5 rounded-lg flex items-start gap-2 text-xs border ${
            status.type === "success"
              ? "bg-emerald-50 border-emerald-100 text-emerald-800"
              : "bg-amber-50 border-amber-100 text-amber-800"
          }`}
        >
          {status.type === "success" ? (
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          )}
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
}
