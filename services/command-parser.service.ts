import { CommandFlowMCPServer } from "@/mcp/server";
import { generateResponse } from "./llm.service";

export interface ParsedCommand {
  tool?: string;
  arguments?: Record<string, unknown>;
  action?: "unknown";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();

  if (!trimmed) {
    return { action: "unknown" };
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const payload = jsonMatch ? jsonMatch[0] : trimmed;

  try {
    const parsed = JSON.parse(payload);

    if (isPlainObject(parsed)) {
      if (typeof parsed.tool === "string") {
        const hasArguments = Object.prototype.hasOwnProperty.call(parsed, "arguments");
        const parsedArguments = hasArguments
          ? (isPlainObject(parsed.arguments) ? parsed.arguments : null)
          : (isPlainObject(parsed.parameters) ? parsed.parameters : null);

        if (!parsedArguments) {
          return { action: "unknown" };
        }

        return {
          tool: parsed.tool,
          arguments: parsedArguments,
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

function formatSchema(schema: Record<string, unknown>): string {
  if (schema.type === "object") {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const fields = Object.entries(properties).map(([name, property]) => {
      const optional = required.has(name) ? "" : " (optional)";
      return `${name}${optional}: ${formatSchema(property)}`;
    });

    return `{ ${fields.join(", ")} }`;
  }

  if (schema.type === "enum" && Array.isArray(schema.values)) {
    return schema.values.map((value) => JSON.stringify(value)).join(" | ");
  }

  if (schema.type === "array") {
    return `${formatSchema((schema.items ?? {}) as Record<string, unknown>)}[]`;
  }

  if (schema.type === "number" || schema.type === "boolean" || schema.type === "string") {
    return schema.type;
  }

  return "unknown";
}

export async function parseCommand(
  message: string,
  server: CommandFlowMCPServer
): Promise<ParsedCommand> {
  const tools = server.listTools();

  const toolPrompt = tools
    .map((tool) => {
      const schema = formatSchema(tool.inputSchema);
      return `- ${tool.name}: ${tool.description}\n  arguments: ${schema}`;
    })
    .join("\n");

  const prompt = `
You are CommandFlow command parser.
Return JSON only.
No markdown.
No explanations.
No conversational text.

If the request matches a tool, return:
{"tool":"<tool.name>","arguments":{...}}

The property must be named exactly "arguments". "parameters" is accepted only as a parser compatibility fallback.
Use only the exact argument property names and allowed values shown below. Do not invent aliases such as "color" or "accentColor".

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
