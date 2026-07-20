import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY is missing in .env");
}

const ai = new GoogleGenAI({
  apiKey,
});

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

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