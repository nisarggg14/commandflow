export type ExecutionStageStatus = "pending" | "running" | "completed" | "failed";

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
  durationMs?: number;
  error?: string;
}

export interface ExternalRequestTraceHooks {
  onRequestStart: () => void;
  onRequestComplete: () => void;
  onRequestFailed: (error: string) => void;
}

export const EXECUTION_STAGE_DEFINITIONS: ReadonlyArray<Pick<ExecutionStage, "id" | "label">> = [
  { id: "intent-analysis", label: "Intent Analysis (Gemini)" },
  { id: "mcp-plan-preparation", label: "MCP Plan Preparation" },
  { id: "tool-selection-validation", label: "Tool Selection / Validation" },
  { id: "tool-execution", label: "Tool Execution" },
  { id: "client-api-request", label: "Client API Request" },
  { id: "result-processing", label: "Result Processing" },
];
