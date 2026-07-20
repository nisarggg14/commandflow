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

User request:
${message}
`;

  const llmResponse = await generateResponse(prompt);

  if (!llmResponse.success) {
    return { action: "unknown" };
  }

  return sanitizeCommand(llmResponse.text);
}
