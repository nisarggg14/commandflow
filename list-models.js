const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  for await (const model of ai.models.list()) {
    console.log(model.name);
  }
}

main().catch(console.error);