const SENSITIVE_KEY_PATTERN = /(password|token|api[-_ ]?key|authorization|cookie|secret|credential|otp|totp|code)/i;

export function redactAuditText(value: string): string {
  return value
    .replace(/(password|token|api[-_ ]?key|authorization|cookie|secret|credential|otp|totp|code)(\s*[=:]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
}

export function redactAuditValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return redactAuditText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(key, item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactAuditValue(childKey, childValue),
      ])
    );
  }

  return value;
}
