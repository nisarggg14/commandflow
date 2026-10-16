import { CommandFlowMCPServer } from "@/mcp/server";
import { generateResponse } from "./llm.service";
import type { ExecutionStageId } from "@/types/execution-trace";

export interface ParsedCommand {
  tool?: string;
  arguments?: Record<string, unknown>;
  action?: "unknown";
}

export interface CommandParseTraceHooks {
  onStageStart?: (stage: Extract<ExecutionStageId, "intent-analysis" | "mcp-plan-preparation">) => void;
  onStageComplete?: (stage: Extract<ExecutionStageId, "intent-analysis" | "mcp-plan-preparation">) => void;
  onStageFailed?: (stage: Extract<ExecutionStageId, "intent-analysis" | "mcp-plan-preparation">, error: string) => void;
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
      const hasAction = Object.prototype.hasOwnProperty.call(parsed, "action");
      if (typeof parsed.tool === "string") {
        if (parsed.tool.trim().length === 0 || hasAction) {
          return { action: "unknown" };
        }

        const hasArguments = Object.prototype.hasOwnProperty.call(parsed, "arguments");
        const allowedProperties = hasArguments ? ["tool", "arguments"] : ["tool", "parameters"];
        if (Object.keys(parsed).some((key) => !allowedProperties.includes(key))) {
          return { action: "unknown" };
        }
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

      if (parsed.action === "unknown" && Object.keys(parsed).length === 1) {
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
  server: CommandFlowMCPServer,
  traceHooks?: CommandParseTraceHooks
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

  traceHooks?.onStageStart?.("intent-analysis");
  let llmResponse;
  try {
    llmResponse = await generateResponse(prompt);
    traceHooks?.onStageComplete?.("intent-analysis");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Intent analysis failed.";
    traceHooks?.onStageFailed?.("intent-analysis", errorMessage);
    throw error;
  }

  if (!llmResponse.success) {
    traceHooks?.onStageFailed?.("intent-analysis", "Intent analysis did not return a result.");
    return { action: "unknown" };
  }

  traceHooks?.onStageStart?.("mcp-plan-preparation");
  try {
    const parsedCommand = sanitizeCommand(llmResponse.text);
    traceHooks?.onStageComplete?.("mcp-plan-preparation");
    return parsedCommand;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "MCP plan generation failed.";
    traceHooks?.onStageFailed?.("mcp-plan-preparation", errorMessage);
    throw error;
  }
}
