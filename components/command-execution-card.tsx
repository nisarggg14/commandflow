import React from "react";

export interface CommandExecutionPayload {
  type: "execution";
  status: "SUCCESS" | "FAILED" | "UNKNOWN";
  toolName?: string | null;
  rowsAffected?: number;
  executionTimeMs?: number;
  errors?: string[];
  data?: unknown;
  message?: string;
  metrics?: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
  };
}

interface CommandExecutionCardProps {
  payload: CommandExecutionPayload;
}

function getBadgeStyles(status: CommandExecutionPayload["status"]) {
  switch (status) {
    case "SUCCESS":
      return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
    case "FAILED":
      return "bg-red-500/15 text-red-600 border-red-500/30";
    default:
      return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  }
}

export function CommandExecutionCard({ payload }: CommandExecutionCardProps) {
  const { status, toolName, rowsAffected, executionTimeMs, errors, data, message, metrics } = payload;

  return (
    <div className="w-full rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Execution Result</p>
          <p className="text-xs text-muted-foreground">{toolName ?? "No tool selected"}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${getBadgeStyles(status)}`}>
          {status}
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-lg bg-muted/60 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Tool Name</p>
          <p className="mt-1 font-medium text-foreground">{toolName ?? "Unknown"}</p>
        </div>
        <div className="rounded-lg bg-muted/60 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Execution Status</p>
          <p className="mt-1 font-medium text-foreground">{status}</p>
        </div>
        <div className="rounded-lg bg-muted/60 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Rows Affected</p>
          <p className="mt-1 font-medium text-foreground">{rowsAffected ?? 0}</p>
        </div>
        <div className="rounded-lg bg-muted/60 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Execution Time</p>
          <p className="mt-1 font-medium text-foreground">{executionTimeMs ?? 0} ms</p>
        </div>
      </div>

      {errors && errors.length > 0 ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">Errors</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {message ? (
        <div className="mt-4 rounded-lg bg-background p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Message</p>
          <p className="mt-1">{message}</p>
        </div>
      ) : null}

      {metrics ? (
        <div className="mt-4 rounded-lg bg-background p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Metrics</p>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <div className="rounded border border-border p-2">
              <p className="text-xs uppercase">Total Executions</p>
              <p className="mt-1 font-semibold text-foreground">{metrics.totalExecutions}</p>
            </div>
            <div className="rounded border border-border p-2">
              <p className="text-xs uppercase">Successful</p>
              <p className="mt-1 font-semibold text-foreground">{metrics.successfulExecutions}</p>
            </div>
            <div className="rounded border border-border p-2">
              <p className="text-xs uppercase">Failed</p>
              <p className="mt-1 font-semibold text-foreground">{metrics.failedExecutions}</p>
            </div>
            <div className="rounded border border-border p-2">
              <p className="text-xs uppercase">Avg Execution Time</p>
              <p className="mt-1 font-semibold text-foreground">{metrics.averageExecutionTime} ms</p>
            </div>
          </div>
        </div>
      ) : null}

      {data !== undefined ? (
        <div className="mt-4 rounded-lg bg-background p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Returned Data</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-foreground">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
