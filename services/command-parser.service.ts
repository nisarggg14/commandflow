import { CommandFlowMCPServer } from "@/mcp/server";
import {
  generateResponse,
  GeminiIntentAnalysisError,
  GeminiIntentResponseError,
  GeminiTemporaryUnavailableError,
  getGeminiConfigurationStatus,
  getGeminiFailureDetails,
} from "./llm.service";
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
  onStageFallback?: (stage: "intent-analysis", note: string) => void;
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
  traceHooks?: CommandParseTraceHooks,
  generate: typeof generateResponse = generateResponse,
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
    llmResponse = await generate(prompt, [message]);
  } catch (error) {
    if (error instanceof GeminiTemporaryUnavailableError) {
      const fallback = deterministicFallback(message, server);
      if (fallback) {
        traceHooks?.onStageFallback?.(
          "intent-analysis",
          "Gemini unavailable; a validated read-only fallback was selected.",
        );
        traceHooks?.onStageComplete?.("intent-analysis");
        traceHooks?.onStageStart?.("mcp-plan-preparation");
        traceHooks?.onStageComplete?.("mcp-plan-preparation");
        return fallback;
      }

      traceHooks?.onStageFailed?.("intent-analysis", error.message);
      throw error;
    }

    const details = error instanceof GeminiIntentAnalysisError
      ? error.details
      : getGeminiFailureDetails(error, [message]);
    if (!(error instanceof GeminiIntentAnalysisError)) {
      console.error("[intent] Gemini request failed", {
        ...getGeminiConfigurationStatus(),
        ...details,
      });
    }
    const intentError = error instanceof GeminiIntentAnalysisError
      ? error
      : new GeminiIntentAnalysisError(details);
    const errorMessage = intentError.message;
    traceHooks?.onStageFailed?.("intent-analysis", errorMessage);
    throw intentError;
  }

  if (!llmResponse.success) {
    const error = new GeminiIntentResponseError("Gemini intent analysis returned no successful result.");
    console.error("[intent] Gemini returned unsuccessful result", {
      ...getGeminiConfigurationStatus(),
      category: "invalid_response",
    });
    traceHooks?.onStageFailed?.("intent-analysis", error.message);
    throw error;
  }

  traceHooks?.onStageComplete?.("intent-analysis");
  traceHooks?.onStageStart?.("mcp-plan-preparation");
  try {
    const parsedCommand = validateIntentResponse(llmResponse.text, server);
    traceHooks?.onStageComplete?.("mcp-plan-preparation");
    return parsedCommand;
  } catch (error) {
    const errorMessage = error instanceof GeminiIntentResponseError
      ? error.message
      : "Gemini selected an invalid or unauthorized tool request.";
    console.warn("[intent] Gemini response rejected", {
      ...getGeminiConfigurationStatus(),
      category: "invalid_response",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    traceHooks?.onStageFailed?.("mcp-plan-preparation", errorMessage);
    throw new GeminiIntentResponseError(errorMessage);
  }
}

function validateIntentResponse(raw: string, server: CommandFlowMCPServer): ParsedCommand {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new GeminiIntentResponseError("Gemini returned an empty intent response.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new GeminiIntentResponseError("Gemini returned malformed intent JSON.");
  }
  if (!isPlainObject(payload)) {
    throw new GeminiIntentResponseError("Gemini intent response must be a JSON object.");
  }

  if (payload.action === "unknown" && Object.keys(payload).length === 1) {
    return { action: "unknown" };
  }
  if (typeof payload.tool !== "string" || !payload.tool.trim()) {
    throw new GeminiIntentResponseError("Gemini intent response did not identify a valid tool.");
  }

  const hasArguments = Object.prototype.hasOwnProperty.call(payload, "arguments");
  const hasParameters = Object.prototype.hasOwnProperty.call(payload, "parameters");
  if (hasArguments === hasParameters || Object.keys(payload).length !== 2) {
    throw new GeminiIntentResponseError("Gemini intent response has an invalid shape.");
  }

  const args = hasArguments ? payload.arguments : payload.parameters;
  if (!isPlainObject(args)) {
    throw new GeminiIntentResponseError("Gemini tool arguments must be a JSON object.");
  }

  if (!server.listTools().some((tool) => tool.name === payload.tool)) {
    throw new GeminiIntentResponseError("Gemini selected a tool that is unavailable to this account.");
  }

  let validatedArguments: unknown;
  try {
    validatedArguments = server.validateToolInput(payload.tool, args);
  } catch {
    throw new GeminiIntentResponseError("Gemini selected an invalid or unauthorized tool request.");
  }
  if (!isPlainObject(validatedArguments)) {
    throw new GeminiIntentResponseError("Gemini tool arguments failed validation.");
  }
  return { tool: payload.tool, arguments: validatedArguments };
}

const DETERMINISTIC_READ_COMMANDS: ReadonlyArray<{
  phrases: readonly string[];
  tool: string;
  arguments: Record<string, unknown>;
}> = [
  {
    phrases: ["show products", "list products"],
    tool: "products.getProducts",
    arguments: {},
  },
  {
    phrases: ["show inventory summary", "inventory summary"],
    tool: "analytics.inventorySummary",
    arguments: {},
  },
];

function deterministicFallback(message: string, server: CommandFlowMCPServer): ParsedCommand | undefined {
  const normalized = message
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ");
  const match = DETERMINISTIC_READ_COMMANDS.find((candidate) => candidate.phrases.includes(normalized));
  if (!match || !server.listTools().some((tool) => tool.name === match.tool)) return undefined;

  try {
    const argumentsObject = { ...match.arguments };
    server.validateToolInput(match.tool, argumentsObject);
    return { tool: match.tool, arguments: argumentsObject };
  } catch {
    return undefined;
  }
}
