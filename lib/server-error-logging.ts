const SENSITIVE_TEXT_PATTERNS = [
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]*/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential|client[_-]?secret|database[_-]?url)\s*[:=]\s*["']?[^"'\s,;}\]]+/gi,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi,
  /https?:\/\/[^\s"'<>]+/gi,
];

export function redactDiagnosticText(value: string, sensitiveValues: string[] = []): string {
  let redacted = value;

  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue) {
      redacted = redacted.replace(
        new RegExp(sensitiveValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        "[redacted]",
      );
    }
  }

  for (const pattern of SENSITIVE_TEXT_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      const separator = match.search(/[:=]/);
      if (separator >= 0 && !/^https?:\/\//i.test(match)) {
        return `${match.slice(0, separator + 1)} [redacted]`;
      }
      return "[redacted]";
    });
  }

  return redacted;
}

export function logServerError(
  context: string,
  error: unknown,
  sensitiveValues: string[] = [],
  requestId?: string,
): void {
  const record = error && typeof error === "object"
    ? error as { name?: unknown; message?: unknown; stack?: unknown }
    : undefined;
  const cause = record && "cause" in record && record.cause && typeof record.cause === "object"
    ? record.cause as { name?: unknown; message?: unknown; stack?: unknown }
    : undefined;
  const details = record && "details" in record && record.details && typeof record.details === "object"
    ? record.details as { status?: unknown; providerCode?: unknown; providerMessage?: unknown }
    : undefined;
  const errorName = error instanceof Error
    ? error.name
    : typeof record?.name === "string"
      ? record.name
      : "UnknownError";
  const errorMessage = error instanceof Error
    ? error.message
    : typeof record?.message === "string"
      ? record.message
      : "Unknown error";
  const errorStack = error instanceof Error
    ? error.stack
    : typeof record?.stack === "string"
      ? record.stack
      : undefined;

  console.error(`[${context}] request failed`, {
    ...(requestId ? { requestId } : {}),
    errorName: redactDiagnosticText(errorName, sensitiveValues),
    errorMessage: redactDiagnosticText(errorMessage, sensitiveValues),
    ...(errorStack
      ? { errorStack: redactDiagnosticText(errorStack, sensitiveValues) }
      : {}),
    ...(details && typeof details.status === "number"
      ? { providerStatus: details.status }
      : {}),
    ...(details && typeof details.providerCode === "string"
      ? { providerCode: redactDiagnosticText(details.providerCode, sensitiveValues) }
      : {}),
    ...(details && typeof details.providerMessage === "string"
      ? { providerMessage: redactDiagnosticText(details.providerMessage, sensitiveValues) }
      : {}),
    ...(cause
      ? {
          causeName: redactDiagnosticText(
            typeof cause.name === "string" ? cause.name : "UnknownError",
            sensitiveValues,
          ),
          ...(!details
            ? {
                causeMessage: redactDiagnosticText(
                  typeof cause.message === "string" ? cause.message : "Unknown error",
                  sensitiveValues,
                ),
                ...(typeof cause.stack === "string"
                  ? { causeStack: redactDiagnosticText(cause.stack, sensitiveValues) }
                  : {}),
              }
            : {}),
        }
      : {}),
  });
}
