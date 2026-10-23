import { GoogleGenAI } from "@google/genai";

import { assertProductionEnvironment } from "@/lib/production-env";
import { redactDiagnosticText } from "@/lib/server-error-logging";



assertProductionEnvironment();

export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";

function normalizeModelName(model?: string): string {
  const trimmed = model?.trim();

  if (!trimmed) {
    return GEMINI_DEFAULT_MODEL;
  }

  return trimmed
    .replace(/^models\//i, "")
    .replace(/^publishers\/google\/models\//i, "")
    .replace(/^google\//i, "")
    .trim();
}

const MODEL = normalizeModelName(process.env.GEMINI_MODEL);

export const GEMINI_QUOTA_MESSAGE = "AI service temporarily unavailable because the Gemini API quota has been exceeded. Please try again later.";
export const GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE = "Command understanding is temporarily unavailable. Please try again shortly.";

function configuredInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const configured = process.env[name]?.trim();
  if (!configured) return fallback;

  const value = Number(configured);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

const GEMINI_MAX_ATTEMPTS = configuredInteger("GEMINI_MAX_ATTEMPTS", 3, 1, 5);
const GEMINI_MAX_ELAPSED_MS = configuredInteger("GEMINI_MAX_ELAPSED_MS", 15_000, 1_000, 60_000);
const GEMINI_REQUEST_TIMEOUT_MS = configuredInteger("GEMINI_REQUEST_TIMEOUT_MS", 4_000, 500, 30_000);
const GEMINI_RETRY_BASE_DELAY_MS = configuredInteger("GEMINI_RETRY_BASE_DELAY_MS", 250, 0, 2_500);
const GEMINI_RETRY_MAX_DELAY_MS = configuredInteger("GEMINI_RETRY_MAX_DELAY_MS", 2_500, 0, 10_000);

if (GEMINI_MAX_ELAPSED_MS < GEMINI_REQUEST_TIMEOUT_MS) {
  throw new Error("GEMINI_MAX_ELAPSED_MS must be at least GEMINI_REQUEST_TIMEOUT_MS.");
}

export type GeminiErrorCategory = "unavailable" | "rate_limited" | "network" | "permanent";

export interface GeminiFailureDetails {
  status?: number;
  providerCode?: string;
  providerMessage?: string;
  category: GeminiErrorCategory;
}

function providerPayload(error: unknown): Record<string, unknown> | undefined {
  const visited = new Set<object>();
  const visit = (value: unknown, depth: number): Record<string, unknown> | undefined => {
    if (depth > 6 || value === null || value === undefined) return undefined;

    if (typeof value === "string") {
      const jsonStart = value.indexOf("{");
      if (jsonStart < 0) return undefined;
      try {
        return visit(JSON.parse(value.slice(jsonStart)), depth + 1);
      } catch {
        return undefined;
      }
    }

    if (typeof value !== "object" || visited.has(value)) return undefined;
    visited.add(value);
    const record = value as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : undefined;
    const hasProviderFields = message !== undefined
      || typeof record.code === "string"
      || typeof record.code === "number"
      || typeof record.status === "string";

    if (hasProviderFields && record.error === undefined) {
      const parsedMessage = message ? visit(message, depth + 1) : undefined;
      return parsedMessage ?? record;
    }

    for (const key of ["error", "details", "response", "responseInternal", "body", "data", "cause"]) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        for (const item of nested.slice(0, 20)) {
          const payload = visit(item, depth + 1);
          if (payload) return payload;
        }
      } else {
        const payload = visit(nested, depth + 1);
        if (payload) return payload;
      }
    }

    return message ? visit(message, depth + 1) : undefined;
  };

  return visit(error, 0);
}

function redactProviderMessage(value: string, sensitiveValues: string[] = []): string {
  return redactDiagnosticText(value, sensitiveValues)
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)["']?[^"',\s}]+/gi, "$1[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[provider URL]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function getGeminiFailureDetails(
  error: unknown,
  sensitiveValues: string[] = [],
): GeminiFailureDetails {
  const category = classifyGeminiError(error);
  const status = readStatus(error);
  const provider = providerPayload(error);
  const rawCode = [provider?.status, provider?.code, error && typeof error === "object"
    ? (error as { code?: unknown }).code
    : undefined].find((value) => typeof value === "string" && !/^\d+$/.test(value));
  const rawMessage = typeof provider?.message === "string"
    ? provider.message
    : error instanceof Error
      ? error.message
      : "";

  return {
    ...(status === undefined ? {} : { status }),
    ...(typeof rawCode === "string" && !/^\d+$/.test(rawCode)
      ? { providerCode: rawCode.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) }
      : {}),
    ...(rawMessage ? { providerMessage: redactProviderMessage(rawMessage, sensitiveValues) } : {}),
    category,
  };
}

export function geminiSafeFailureMessage(details: GeminiFailureDetails): string {
  if (details.category === "rate_limited" || details.status === 429) {
    return GEMINI_QUOTA_MESSAGE;
  }
  if (details.category !== "permanent") {
    return GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE;
  }
  if (
    details.status === 400 &&
    /api.?key|credential|authentication/i.test(details.providerMessage ?? "")
  ) {
    return "Gemini rejected the server credentials. Please contact the administrator.";
  }
  if (details.status === 401 || details.status === 403) {
    return "Gemini rejected the server credentials or permissions. Please contact the administrator.";
  }
  if (details.status === 404) {
    return `Gemini API returned HTTP 404${details.providerMessage ? `: ${details.providerMessage}` : ""}. Verify the configured model and endpoint.`;
  }
  if (details.status === 400) {
    return `Gemini API rejected the intent-analysis request (HTTP 400)${details.providerMessage ? `: ${details.providerMessage}` : ""}.`;
  }
  if (details.status !== undefined) {
    return `Gemini API returned HTTP ${details.status}${details.providerCode ? ` (${details.providerCode})` : ""}${details.providerMessage ? `: ${details.providerMessage}` : ""}.`;
  }
  if (details.providerCode || details.providerMessage) {
    return `Gemini intent analysis failed${details.providerCode ? ` (${details.providerCode})` : ""}${details.providerMessage ? `: ${details.providerMessage}` : ""}. Please try again or contact the administrator.`;
  }
  return `Gemini intent analysis failed (${details.category}). Please check server diagnostics or contact the administrator.`;
}

export class GeminiIntentAnalysisError extends Error {
  readonly cause?: unknown;

  constructor(readonly details: GeminiFailureDetails, cause?: unknown) {
    super(geminiSafeFailureMessage(details));
    this.name = "GeminiIntentAnalysisError";
    this.cause = cause;
  }
}

export class GeminiIntentResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiIntentResponseError";
  }
}

export class GeminiTemporaryUnavailableError extends Error {
  constructor(
    readonly attempts: number,
    readonly elapsedMs: number,
    readonly category: Exclude<GeminiErrorCategory, "permanent">,
  ) {
    super(
      `${GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE} (${attempts} attempts, ${(elapsedMs / 1000).toFixed(1)} seconds).`,
    );
    this.name = "GeminiTemporaryUnavailableError";
  }
}

export class GeminiQuotaError extends Error {
  constructor() {
    super(GEMINI_QUOTA_MESSAGE);
    this.name = "GeminiQuotaError";
  }
}

function readStatus(error: unknown): number | undefined {
  const visited = new Set<object>();
  const visit = (value: unknown, depth: number): number | undefined => {
    if (depth > 6 || value === null || value === undefined) return undefined;
    if (typeof value === "string") {
      const jsonStart = value.indexOf("{");
      if (jsonStart < 0) return undefined;
      try {
        return visit(JSON.parse(value.slice(jsonStart)), depth + 1);
      } catch {
        return undefined;
      }
    }
    if (typeof value !== "object" || visited.has(value)) return undefined;
    visited.add(value);
    const record = value as Record<string, unknown>;

    for (const candidate of [
      record.status,
      record.statusCode,
      record.code,
      (record.responseInternal as { status?: unknown } | undefined)?.status,
      (record.response as { status?: unknown } | undefined)?.status,
    ]) {
      const status = Number(candidate);
      if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
    }
    if (record.code === "UNAVAILABLE") return 503;
    if (record.code === "RESOURCE_EXHAUSTED") return 429;

    for (const nested of [
      record.error,
      record.details,
      record.response,
      record.responseInternal,
      record.body,
      record.data,
      record.cause,
      record.message,
    ]) {
      const status = visit(nested, depth + 1);
      if (status !== undefined) return status;
    }
    return undefined;
  };

  return visit(error, 0);
}

function readNetworkCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; cause?: unknown };
  if (typeof value.code === "string") return value.code.toUpperCase();
  return readNetworkCode(value.cause);
}

export function classifyGeminiError(error: unknown): GeminiErrorCategory {
  const status = readStatus(error);
  if ([500, 502, 503, 504].includes(status ?? 0)) return "unavailable";
  if (status === 429) return "rate_limited";

  const networkCode = readNetworkCode(error);
  if (
    status === 408 ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) ||
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"].includes(networkCode ?? "")
  ) {
    return "network";
  }

  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    const message = typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
    const provider = providerPayload(error);
    const providerCode = [provider?.status, provider?.code].find((value) => typeof value === "string");
    if (code === "UNAVAILABLE" || providerCode === "UNAVAILABLE") return "unavailable";
    if (code === "RESOURCE_EXHAUSTED" || providerCode === "RESOURCE_EXHAUSTED") return "rate_limited";
    if (!provider && /\bUNAVAILABLE\b|SERVICE_UNAVAILABLE/i.test(message)) return "unavailable";
    if (!provider && /RESOURCE_EXHAUSTED|rate.?limit|\b429\b/i.test(message)) return "rate_limited";
  }

  return "permanent";
}

function parseRetryDelay(value: unknown, now: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value * 1000;
  if (typeof value !== "string") return undefined;

  const seconds = value.trim().match(/^(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?$/i);
  if (seconds) return Number(seconds[1]) * 1000;
  const milliseconds = value.trim().match(/^(\d+(?:\.\d+)?)\s*ms$/i);
  if (milliseconds) return Number(milliseconds[1]);
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function retryDelayFromHeaders(headers: unknown, now: number): number | undefined {
  if (headers instanceof Headers) {
    return parseRetryDelay(headers.get("retry-after") ?? undefined, now);
  }
  if (!headers || typeof headers !== "object") return undefined;
  const value = Object.entries(headers as Record<string, unknown>)
    .find(([key]) => key.toLowerCase() === "retry-after")?.[1];
  return parseRetryDelay(value, now);
}

function providerRetryDelay(error: unknown, now: number): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const visited = new Set<object>();
  const visit = (value: unknown, depth: number): number | undefined => {
    if (!value || typeof value !== "object" || depth > 5 || visited.has(value)) return undefined;
    visited.add(value);
    const record = value as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : "";
    const messageDelay = message.match(/\bretry\s+(?:after|in)\s+(\d+(?:\.\d+)?)\s*(ms|s|seconds?)\b/i);
    if (messageDelay) {
      return parseRetryDelay(`${messageDelay[1]}${messageDelay[2].toLowerCase().startsWith("m") ? "ms" : "s"}`, now);
    }

    const headersDelay =
      retryDelayFromHeaders(record.headers, now) ??
      retryDelayFromHeaders((record.response as { headers?: unknown } | undefined)?.headers, now) ??
      retryDelayFromHeaders((record.responseInternal as { headers?: unknown } | undefined)?.headers, now);
    if (headersDelay !== undefined) return headersDelay;

    for (const [key, nested] of Object.entries(record)) {
      if (/^(retryafter|retry_after|retrydelay|retry_delay)$/i.test(key)) {
        const delay = parseRetryDelay(nested, now);
        if (delay !== undefined) return delay;
      }
    }

    for (const nested of Object.values(record)) {
      const delay = visit(nested, depth + 1);
      if (delay !== undefined) return delay;
    }
    return undefined;
  };

  return visit(error, 0);
}

interface GeminiRetryOptions {
  model?: string;
  sensitiveValues?: string[];
  maxAttempts?: number;
  maxElapsedMs?: number;
  requestTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  log?: (entry: {
    model: string;
    endpoint: string;
    attempt: number;
    maxAttempts: number;
    category: GeminiErrorCategory;
    status?: number;
    providerCode?: string;
    providerMessage?: string;
  }) => void;
}

export async function retryGeminiRequest<T>(
  operation: () => Promise<T>,
  options: GeminiRetryOptions = {},
): Promise<T> {
  const model = options.model ?? MODEL;
  const maxAttempts = options.maxAttempts ?? GEMINI_MAX_ATTEMPTS;
  const maxElapsedMs = options.maxElapsedMs ?? GEMINI_MAX_ELAPSED_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS;
  const baseDelayMs = options.baseDelayMs ?? GEMINI_RETRY_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? GEMINI_RETRY_MAX_DELAY_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  const log = options.log ?? ((entry) => console.warn("[llm] Gemini request attempt failed", entry));
  const startedAt = now();
  let attempts = 0;
  let lastCategory: Exclude<GeminiErrorCategory, "permanent"> = "unavailable";

  while (attempts < maxAttempts) {
    const elapsedBeforeAttempt = now() - startedAt;
    if (elapsedBeforeAttempt + requestTimeoutMs > maxElapsedMs) break;

    attempts += 1;
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new DOMException("Gemini request timed out.", "TimeoutError")),
            requestTimeoutMs,
          );
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });
      if (attempts > 1) {
        console.info("[llm] Gemini request recovered", {
          model,
          attempts,
          category: lastCategory,
        });
      }
      return result;
    } catch (error) {
      const details = getGeminiFailureDetails(error, options.sensitiveValues);
      const { category } = details;
      log({
        model,
        endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
        attempt: attempts,
        maxAttempts,
        category,
        ...(details.status === undefined ? {} : { status: details.status }),
        ...(details.providerCode ? { providerCode: details.providerCode } : {}),
        ...(details.providerMessage ? { providerMessage: details.providerMessage } : {}),
      });
      if (category === "permanent") throw error;

      lastCategory = category;
      if (attempts >= maxAttempts) break;

      const exponentialCap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempts - 1));
      const backoff = Math.max(0, Math.min(1, random())) * exponentialCap;
      const providerDelay = providerRetryDelay(error, now());
      const delayMs = Math.max(backoff, providerDelay ?? 0);
      const elapsed = now() - startedAt;
      if (elapsed + delayMs + requestTimeoutMs > maxElapsedMs) break;
      await sleep(delayMs);
    }
  }

  throw new GeminiTemporaryUnavailableError(attempts, now() - startedAt, lastCategory);
}

export function isGeminiQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const providerError = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = Number(providerError.status ?? providerError.code);
  const message = typeof providerError.message === "string" ? providerError.message : "";

  return status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit|\b429\b/i.test(message);
}

export interface LLMResponse {
  success: boolean;
  text: string;
}

interface GeminiInteractionRequest {
  model: string;
  input: string;
  store: false;
  response_format: {
    type: "text";
    mime_type: "application/json";
  };
}

interface GeminiRequestOptions {
  timeout: number;
  maxRetries: number;
}

interface GeminiClientFactory {
  (apiKey: string): {
    interactions: {
      create(
        request: GeminiInteractionRequest,
        options: GeminiRequestOptions,
      ): Promise<{ output_text?: string }>;
    };
  };
}

function createGeminiClient(apiKey: string): ReturnType<GeminiClientFactory> {
  return new GoogleGenAI({ apiKey });
}

export function getGeminiConfigurationStatus() {
  return {
    model: MODEL,
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
    apiVersion: "v1beta",
    sdkRetries: 0,
    maxAttempts: GEMINI_MAX_ATTEMPTS,
    maxElapsedMs: GEMINI_MAX_ELAPSED_MS,
    requestTimeoutMs: GEMINI_REQUEST_TIMEOUT_MS,
    retryBaseDelayMs: GEMINI_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: GEMINI_RETRY_MAX_DELAY_MS,
  } as const;
}

export async function generateResponse(
  prompt: string,
  sensitiveValues: string[] = [],
  createClient: GeminiClientFactory = createGeminiClient,
): Promise<LLMResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    const details: GeminiFailureDetails = {
      category: "permanent",
      providerCode: "MISSING_API_KEY",
    };
    console.error("[llm] Gemini configuration failure", {
      model: MODEL,
      ...details,
    });
    throw new GeminiIntentAnalysisError(details);
  }
  const ai = createClient(apiKey);
  try {
    const response = await retryGeminiRequest(
      () => ai.interactions.create({
        model: MODEL,
        input: prompt,
        store: false,
        response_format: { type: "text", mime_type: "application/json" },
      }, {
        timeout: GEMINI_REQUEST_TIMEOUT_MS,
        maxRetries: 0,
      }),
      { model: MODEL, sensitiveValues: [apiKey, prompt, ...sensitiveValues] },
    );

    return {
      success: true,
      text: response.output_text ?? "",
    };
  } catch (error) {
    if (error instanceof GeminiTemporaryUnavailableError) throw error;
    const diagnosticSensitiveValues = [apiKey, prompt, ...sensitiveValues];
    const details = getGeminiFailureDetails(error, diagnosticSensitiveValues);
    const original = error && typeof error === "object"
      ? error as { name?: unknown; stack?: unknown }
      : undefined;
    console.error("[llm] Gemini intent request failed", {
      model: MODEL,
      endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
      category: details.category,
      ...(details.status === undefined ? {} : { providerStatus: details.status }),
      ...(details.providerCode ? { providerCode: details.providerCode } : {}),
      ...(details.providerMessage ? { providerMessage: details.providerMessage } : {}),
      errorName: error instanceof Error
        ? redactDiagnosticText(error.name, diagnosticSensitiveValues)
        : typeof original?.name === "string"
          ? redactDiagnosticText(original.name, diagnosticSensitiveValues)
          : "UnknownError",
      ...(typeof original?.stack === "string"
        ? { errorStack: redactDiagnosticText(original.stack, diagnosticSensitiveValues) }
        : {}),
    });
    throw new GeminiIntentAnalysisError(details, error);
  }
}