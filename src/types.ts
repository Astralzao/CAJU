export interface Tab {
  name: string;
  headers: string[];
  rows: Array<Record<string, string | number | boolean>>;
}

export interface Spreadsheet {
  id: string;
  name: string;
  rawFileName: string;
  updatedAt: string;
  tabs: Tab[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
