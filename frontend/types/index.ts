export interface Template {
  key: string;
  label: string;
  description: string;
  is_default: boolean;
}

export interface UploadResult {
  upload_id: number;
  status: "done" | "error";
  original_filename: string;
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
