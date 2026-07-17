require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function test() {
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: "Say hello in one sentence.",
  });

  console.log(response.text);
}

test().catch(console.error);