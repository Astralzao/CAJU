import React, { useState } from "react";
import { Spreadsheet, Tab } from "../types";
import { FileSpreadsheet, Trash2, Table, Calendar, Layers, Plus, X, Edit2, Check, RefreshCw } from "lucide-react";

interface SpreadsheetViewerProps {
  spreadsheets: Spreadsheet[];
  onDeleteSheet: (id: string) => void;
  onUpdateSheet: (updatedSheet: Spreadsheet) => void;
}

export default function SpreadsheetViewer({ spreadsheets, onDeleteSheet, onUpdateSheet }: SpreadsheetViewerProps) {
  const [selectedSheetId, setSelectedSheetId] = useState<string>(spreadsheets[0]?.id || "");
  const [activeTabName, setActiveTabName] = useState<string>("");
  
  // Row editing/adding local state
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editRowIndex, setEditRowIndex] = useState<number | null>(null);
  const [editFormData, setEditFormData] = useState<Record<string, string | number | boolean>>({});
  
  const [isAddingRow, setIsAddingRow] = useState<boolean>(false);
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});

  const currentSheet = spreadsheets.find((s) => s.id === selectedSheetId) || spreadsheets[0];
  
  // Auto select active tab when current sheet changes
  const activeTab = currentSheet?.tabs.find((t) => t.name === activeTabName) || currentSheet?.tabs[0];

  // Sync state if selected sheet doesn't exist anymore
  if (currentSheet && selectedSheetId !== currentSheet.id) {
    setSelectedSheetId(currentSheet.id);
  }

  const handleTabChange = (tabName: string) => {
    setActiveTabName(tabName);
    setIsEditing(false);
    setIsAddingRow(false);
  };

  const handleSheetSelect = (sheetId: string) => {
    setSelectedSheetId(sheetId);
    const sheet = spreadsheets.find((s) => s.id === sheetId);
    if (sheet && sheet.tabs.length > 0) {
      setActiveTabName(sheet.tabs[0].name);
    }
    setIsEditing(false);
    setIsAddingRow(false);
  };

  // Row Edit actions
  const startEditRow = (index: number, row: Record<string, any>) => {
    setEditRowIndex(index);
    setEditFormData({ ...row });
    setIsEditing(true);
    setIsAddingRow(false);
  };

  const handleEditFormChange = (header: string, val: string) => {
    setEditFormData(prev => ({
      ...prev,
      [header]: val
    }));
  };

  const saveEditedRow = () => {
    if (editRowIndex === null || !currentSheet || !activeTab) return;

    const updatedTabs = currentSheet.tabs.map((t) => {
      if (t.name === activeTab.name) {
        const updatedRows = [...t.rows];
        updatedRows[editRowIndex] = editFormData;
        return { ...t, rows: updatedRows };
      }
      return t;
    });

    const updatedSheet = {
      ...currentSheet,
      updatedAt: new Date().toLocaleDateString("pt-BR"),
      tabs: updatedTabs
    };

    onUpdateSheet(updatedSheet);
    setIsEditing(false);
    setEditRowIndex(null);
  };

  // Row Delete action
  const deleteRow = (index: number) => {
    if (!currentSheet || !activeTab || !confirm("Tem certeza que deseja excluir esta linha?")) return;

    const updatedTabs = currentSheet.tabs.map((t) => {
      if (t.name === activeTab.name) {
        const updatedRows = t.rows.filter((_, idx) => idx !== index);
        return { ...t, rows: updatedRows };
      }
      return t;
    });

    const updatedSheet = {
      ...currentSheet,
      updatedAt: new Date().toLocaleDateString("pt-BR"),
      tabs: updatedTabs
    };

    onUpdateSheet(updatedSheet);
    setIsEditing(false);
  };

  // Row Add actions
  const startAddRow = () => {
    if (!activeTab) return;
    const initialRow: Record<string, string> = {};
    activeTab.headers.forEach(h => {
      initialRow[h] = "";
    });
    setNewRowData(initialRow);
    setIsAddingRow(true);
    setIsEditing(false);
  };

  const handleNewRowChange = (header: string, val: string) => {
    setNewRowData(prev => ({
      ...prev,
      [header]: val
    }));
  };

  const saveNewRow = () => {
    if (!currentSheet || !activeTab) return;

    // Build complete row matching active header checklist
    const completedRow: Record<string, string | number | boolean> = {};
    activeTab.headers.forEach(h => {
      completedRow[h] = newRowData[h] || "";
    });

    const updatedTabs = currentSheet.tabs.map((t) => {
      if (t.name === activeTab.name) {
        return {
          ...t,
          rows: [...t.rows, completedRow]
        };
      }
      return t;
    });

    const updatedSheet = {
      ...currentSheet,
      updatedAt: new Date().toLocaleDateString("pt-BR"),
      tabs: updatedTabs
    };

    onUpdateSheet(updatedSheet);
    setIsAddingRow(false);
  };

  if (spreadsheets.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 text-center text-slate-400 space-y-2" id="empty-viewer">
        <Layers className="w-10 h-10 mx-auto text-slate-300" />
        <p className="text-sm font-medium">Nenhuma planilha cadastrada no momento.</p>
        <p className="text-xs text-slate-400">Use o painel ao lado para fazer o upload ou conectar arquivos.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm flex flex-col h-full overflow-hidden" id="viewer-container">
      {/* Header bar and picker */}
      <div className="border-b border-slate-50 bg-slate-50/50 p-4 shrink-0 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between" id="viewer-header">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Planilha Selecionada
          </label>
          <div className="flex items-center gap-2">
            <select
              id="sheet-picker-select"
              value={currentSheet?.id}
              onChange={(e) => handleSheetSelect(e.target.value)}
              className="text-sm font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            >
              {spreadsheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400 font-mono hidden md:inline">
              ({currentSheet?.rawFileName})
            </span>
          </div>
        </div>

        {/* Delete current sheet and general info */}
        <div className="flex items-center gap-3 self-end sm:self-auto" id="sheet-actions">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-slate-400 flex items-center justify-end gap-1 font-medium">
              <Calendar className="w-3 h-3" /> Atualizado: {currentSheet?.updatedAt}
            </p>
            <p className="text-[11px] text-slate-500 font-medium">
              {currentSheet?.tabs.length} aba(s) • {currentSheet?.tabs.reduce((acc, t) => acc + t.rows.length, 0)} linhas
            </p>
          </div>
          <button
            id={`btn-delete-sheet-${currentSheet?.id}`}
            onClick={() => onDeleteSheet(currentSheet.id)}
            className="p-2 text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition"
            title="Excluir Painel de Planilha Inteiro"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {currentSheet?.id === "google-sheet" && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2.5 flex items-start gap-2 text-[11px] text-amber-800">
          <span className="font-bold shrink-0">⚠️ Nota de Sincronização:</span>
          <span>Esta é uma Planilha Google conectada em tempo real. Quaisquer modificações ou exclusões locais feitas nesta visualização serão sobrescritas na próxima atualização periódica automática (a cada 5 segundos). Para alterações permanentes, edite diretamente no seu documento do Google Sheets.</span>
        </div>
      )}

      {/* Sheet Tabs */}
      <div className="border-b border-slate-100 px-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between shrink-0 gap-3 py-2" id="viewer-tabs">
        <div className="flex space-x-1 overflow-x-auto mini-scrollbar pb-1 sm:pb-0 scroll-smooth w-full sm:w-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          {currentSheet?.tabs.map((tab) => (
            <button
              id={`tab-select-${tab.name}`}
              key={tab.name}
              onClick={() => handleTabChange(tab.name)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                (activeTabName === tab.name || (!activeTabName && currentSheet?.tabs[0]?.name === tab.name))
                  ? "bg-slate-100 text-slate-800 font-bold"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              <Table className="w-3.5 h-3.5 text-slate-400" />
              {tab.name}
              <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {tab.rows.length}
              </span>
            </button>
          ))}
        </div>

        {/* Add Row Button */}
        <button
          id="btn-trigger-add-row"
          onClick={startAddRow}
          className="text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/50 px-3 py-1.5 rounded-lg flex items-center justify-center gap-1 transition shrink-0 w-full sm:w-auto cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Adicionar Linha
        </button>
      </div>

      {/* Editing Form Overlay Panel */}
      {(isEditing || isAddingRow) && (
        <div className="bg-emerald-50/40 border-b border-emerald-100/50 p-4 transition animate-fade-in" id="row-form-panel">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1">
              {isEditing ? `Editando Registro #${(editRowIndex || 0) + 1}` : "Inserir Nova Linha na Tabela"}
            </h4>
            <button
              id="row-form-close"
              onClick={() => { setIsEditing(false); setIsAddingRow(false); }}
              className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeTab?.headers.map((header) => (
              <div key={header} className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 truncate block">
                  {header}
                </label>
                {isEditing ? (
                  <input
                    id={`row-form-edit-${header}`}
                    type="text"
                    value={String(editFormData[header] || "")}
                    onChange={(e) => handleEditFormChange(header, e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-500 text-slate-800 font-medium"
                  />
                ) : (
                  <input
                    id={`row-form-add-${header}`}
                    type="text"
                    value={newRowData[header] || ""}
                    onChange={(e) => handleNewRowChange(header, e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-500 text-slate-800 font-medium"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button
              id="row-form-cancel"
              onClick={() => { setIsEditing(false); setIsAddingRow(false); }}
              className="text-xs font-medium px-3 py-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"
            >
              Cancelar
            </button>
            {isEditing ? (
              <button
                id="row-form-save-edit"
                onClick={saveEditedRow}
                className="text-xs font-semibold px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1.5 transition"
              >
                <Check className="w-3.5 h-3.5" /> Salvar Alterações
              </button>
            ) : (
              <button
                id="row-form-save-add"
                onClick={saveNewRow}
                className="text-xs font-semibold px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1.5 transition"
              >
                <Check className="w-3.5 h-3.5" /> Inserir Linha
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Table Viewport */}
      <div className="flex-1 overflow-auto mini-scrollbar" id="viewer-table-scroll">
        <table className="w-full border-collapse text-left text-xs text-slate-600">
          <thead className="bg-slate-100/70 p-2 text-slate-500 font-semibold sticky top-0 uppercase text-[10px] tracking-wider border-b border-slate-100 backdrop-blur-xs">
            <tr>
              <th className="px-4 py-3 text-center w-12 font-bold">#</th>
              {activeTab?.headers.map((header) => (
                <th key={header} className="px-4 py-3 font-bold truncate max-w-[200px]">
                  {header}
                </th>
              ))}
              <th className="px-4 py-3 text-right w-24 font-bold">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {activeTab && activeTab.rows.length > 0 ? (
              activeTab.rows.map((row, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-slate-50/50 transition group"
                  id={`table-row-${idx}`}
                >
                  <td className="px-4 py-3 text-center font-mono font-medium text-slate-400">
                    {idx + 1}
                  </td>
                  {activeTab.headers.map((header) => (
                    <td key={header} className="px-4 py-3 font-medium text-slate-700 min-w-[120px] max-w-[280px]">
                      <div className="truncate group-hover:text-clip group-hover:whitespace-normal line-clamp-2">
                        {String(row[header] !== undefined ? row[header] : "") || <span className="text-slate-300 italic">Vazio</span>}
                      </div>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition">
                      <button
                        id={`btn-edit-row-${idx}`}
                        onClick={() => startEditRow(idx, row)}
                        className="p-1 text-slate-500 hover:text-emerald-600 hover:bg-slate-100 rounded-md transition"
                        title="Editar Linha"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        id={`btn-delete-row-${idx}`}
                        onClick={() => deleteRow(idx)}
                        className="p-1 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-md transition"
                        title="Remover Linha"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={(activeTab?.headers.length || 0) + 2}
                  className="text-center py-12 text-slate-400 font-mono italic"
                >
                  Nenhuma linha de registro nesta aba. Clique em "Adicionar Linha" acima para inserir dados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
