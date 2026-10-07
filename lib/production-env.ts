const REQUIRED = ["DATABASE_URL", "JWT_SECRET", "MFA_ENCRYPTION_KEY", "GEMINI_API_KEY"] as const;
export function assertProductionEnvironment(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  if ((process.env.JWT_SECRET ?? "").length < 32 || (process.env.MFA_ENCRYPTION_KEY ?? "").length < 32) throw new Error("JWT_SECRET and MFA_ENCRYPTION_KEY must each be at least 32 characters in production.");
  const defaults = ["commandflow-demo-secret", "commandflow-demo-mfa-key-32chars-long", "admin123"];
  if (defaults.some((value) => process.env.JWT_SECRET === value || process.env.MFA_ENCRYPTION_KEY === value || process.env.COMMANDER_BOOTSTRAP_PASSWORD === value)) throw new Error("Demo/default production credentials are not permitted.");
}