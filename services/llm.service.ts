import { GoogleGenAI } from "@google/genai";

import { assertProductionEnvironment } from "@/lib/production-env";



assertProductionEnvironment();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY is missing in .env");
}

const ai = new GoogleGenAI({
  apiKey,
});

function normalizeModelName(model?: string): string {
  const trimmed = model?.trim();

  if (!trimmed) {
    return "gemini-3.6-flash";
  }

  return trimmed
    .replace(/^models\//i, "")
    .replace(/^publishers\/google\/models\//i, "")
    .replace(/^google\//i, "")
    .trim();
}

const MODEL = normalizeModelName(process.env.GEMINI_MODEL);

export const GEMINI_QUOTA_MESSAGE = "AI service temporarily unavailable because the Gemini API quota has been exceeded. Please try again later.";

export class GeminiQuotaError extends Error {
  constructor() {
    super(GEMINI_QUOTA_MESSAGE);
    this.name = "GeminiQuotaError";
  }
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

export async function generateResponse(
  prompt: string
): Promise<LLMResponse> {
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });

    return {
      success: true,
      text: response.text ?? "",
    };
  } catch (error) {
    console.error("Gemini Error:", error);
    if (isGeminiQuotaError(error)) {
      throw new GeminiQuotaError();
    }
    throw error;
  }
}