export type ExecutionResultStatus = "SUCCESS" | "FAILED" | "PENDING_APPROVAL";

export function getExecutionStatus(result: { success: boolean; outcome?: "APPROVAL_REQUIRED" }): ExecutionResultStatus {
  return result.outcome === "APPROVAL_REQUIRED" ? "PENDING_APPROVAL" : result.success ? "SUCCESS" : "FAILED";
}

export type AutomationExecutionStatus = "SUCCEEDED" | "FAILED" | "PENDING_APPROVAL";

export function getAutomationExecutionStatus(result: { success: boolean; outcome?: "APPROVAL_REQUIRED" }): AutomationExecutionStatus {
  const status = getExecutionStatus(result);
  return status === "SUCCESS" ? "SUCCEEDED" : status;
}
