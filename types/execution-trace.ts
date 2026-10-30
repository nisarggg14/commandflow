export type ExecutionStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type ExecutionStageId =
  | "intent-analysis"
  | "mcp-plan-preparation"
  | "tool-selection-validation"
  | "tool-execution"
  | "client-api-request"
  | "result-processing";

export interface ExecutionStage {
  id: ExecutionStageId;
  label: string;
  status: ExecutionStageStatus;
  requestId?: string;
  toolName?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  httpStatus?: number;
  errorCategory?: string;
  error?: string;
  note?: string;
}

export interface ExternalRequestTraceHooks {
  onRequestStart: () => void;
  onRequestComplete: (httpStatus?: number) => void;
  onRequestFailed: (error: string, httpStatus?: number, errorCategory?: string) => void;
}

export const EXECUTION_STAGE_DEFINITIONS: ReadonlyArray<Pick<ExecutionStage, "id" | "label">> = [
  { id: "intent-analysis", label: "Intent Analysis (Gemini)" },
  { id: "mcp-plan-preparation", label: "MCP Plan Preparation" },
  { id: "tool-selection-validation", label: "Tool Selection / Validation" },
  { id: "tool-execution", label: "Tool Execution" },
  { id: "client-api-request", label: "Client API Request" },
  { id: "result-processing", label: "Result Processing" },
];
