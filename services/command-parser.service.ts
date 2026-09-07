import { CommandFlowMCPServer } from "@/mcp/server";
import { generateResponse } from "./llm.service";

export interface ParsedCommand {
  tool?: string;
  arguments?: Record<string, unknown>;
  action?: "unknown";
}

function sanitizeCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();

  if (!trimmed) {
    return { action: "unknown" };
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const payload = jsonMatch ? jsonMatch[0] : trimmed;

  try {
    const parsed = JSON.parse(payload);

    if (parsed && typeof parsed === "object") {
      if (typeof parsed.tool === "string") {
        return {
          tool: parsed.tool,
          arguments: parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {},
        };
      }

      if (parsed.action === "unknown") {
        return { action: "unknown" };
      }
    }
  } catch {
    // Fall back to a safe unknown response.
  }

  return { action: "unknown" };
}

export async function parseCommand(
  message: string,
  server: CommandFlowMCPServer
): Promise<ParsedCommand> {
  const tools = server.listTools();

  const toolPrompt = tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  const prompt = `
You are CommandFlow command parser.
Return JSON only.
No markdown.
No explanations.
No conversational text.

If the request matches a tool, return:
{"tool":"<tool.name>","arguments":{...}}

If the request does not match any tool, return:
{"action":"unknown"}

Available tools:
${toolPrompt}

Argument rules:
- For a product operation, use the exact productId when the user provides one, such as P1002.
- If the user gives a product name, put it in productQuery and do not invent an ID.
- For products.updateProduct, put the requested field directly in its supported field name.
- For products.updateStock, include stock for an absolute value and include sku or variantId when the product has multiple variants.
- For products.adjustPrice, use operation increase, reduce, or set; use percentage for increase/reduce and price for set.
- For analytics tools, do not include productId or productQuery unless the user explicitly asks for a category filter.

User request:
${message}
`;

  const llmResponse = await generateResponse(prompt);

  if (!llmResponse.success) {
    return { action: "unknown" };
  }

  return sanitizeCommand(llmResponse.text);
}
