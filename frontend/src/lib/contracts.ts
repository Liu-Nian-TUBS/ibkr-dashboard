export type ApiRecord = Record<string, unknown>;

export type PageKey =
  | "overview"
  | "positions"
  | "performance"
  | "trades"
  | "settings"
  | "stockAnalysis";

export type QueryValue = string | number | boolean | null | undefined;

export type RequestQuery = Record<string, QueryValue>;

export interface ListResponse {
  filters?: ApiRecord;
  display_currency?: string;
  valuation_mode?: string;
  items?: ApiRecord[];
  total?: number;
  summary?: ApiRecord;
  monthly_stats?: ApiRecord[];
}

export interface ImportContentFile {
  filename: string;
  content: string;
}

export interface ImportTaskResponse {
  task_id: string;
  task_url: string;
  run_url: string;
  accepted_files?: number;
  status?: string;
  files?: string[];
  summaries?: ApiRecord[];
  errors?: string[];
  total_files?: number;
  processed_files?: number;
  progress?: number;
}

export interface PageState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface NavItem {
  key: PageKey;
  label: string;
  detail: string;
}
