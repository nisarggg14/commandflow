import { GoogleGenAI } from "@google/genai";

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
    return "gemini-2.0-flash";
  }

  return trimmed
    .replace(/^models\//i, "")
    .replace(/^publishers\/google\/models\//i, "")
    .replace(/^google\//i, "")
    .trim();
}

const MODEL = normalizeModelName(process.env.GEMINI_MODEL);

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
    throw error;
  }
}