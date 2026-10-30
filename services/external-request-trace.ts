import { AsyncLocalStorage } from "node:async_hooks";
import type { ExternalRequestTraceHooks } from "@/types/execution-trace";

const requestTraceStorage = new AsyncLocalStorage<ExternalRequestTraceHooks>();

export function runWithExternalRequestTrace<T>(hooks: ExternalRequestTraceHooks, operation: () => Promise<T>): Promise<T> {
  return requestTraceStorage.run(hooks, operation);
}

export function getExternalRequestTrace(): ExternalRequestTraceHooks | undefined {
  return requestTraceStorage.getStore();
}
