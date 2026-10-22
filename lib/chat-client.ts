type SecureCrypto = Pick<Crypto, "getRandomValues"> &
  Partial<Pick<Crypto, "randomUUID">>;

export function createClientId(
  cryptoSource: SecureCrypto | null = globalThis.crypto,
): string {
  if (typeof cryptoSource?.randomUUID === "function") {
    return cryptoSource.randomUUID();
  }
  if (typeof cryptoSource?.getRandomValues !== "function") {
    throw new Error("Secure random ID generation is unavailable in this browser.");
  }

  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function chatSubmissionErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    error.message === "Secure random ID generation is unavailable in this browser."
  ) {
    return "This browser cannot securely create command IDs. Use a supported browser or secure origin.";
  }
  return "Unable to submit the command. Please try again.";
}
