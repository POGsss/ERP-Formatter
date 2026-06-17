export interface UploadResult {
  upload_id: number;
  status: "done" | "error";
  row_count: number;
  error_count: number;
  warnings: string[];
  errors: string[];
  column_summary: ColumnSummaryItem[];
  download_url: string;
  error_report_url: string | null;
  preview: Record<string, any>[];
}

export interface ColumnSummaryItem {
  column: string;
  source: string;
  status: "mapped" | "hardcoded" | "defaulted" | "computed";
  note?: string;
  required?: boolean;
  value_type?: string;
  description?: string;
}

export interface SuggestionItem {
  output_col: string;
  suggested_input_col: string | null;
  confidence: number;
  match_reason: string;
}

export interface MappingItem {
  output_col: string;
  source: "direct" | "hardcoded";
  input_col?: string;
  transform?: string;
  value?: string;
}
