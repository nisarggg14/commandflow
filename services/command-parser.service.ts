import { CommandFlowMCPServer } from "@/mcp/server";
import {
  generateResponse,
  GeminiIntentAnalysisError,
  GeminiIntentResponseError,
  GeminiQuotaError,
  GeminiTemporaryUnavailableError,
  getGeminiConfigurationStatus,
  getGeminiFailureDetails,
} from "./llm.service";
import type { ExecutionStageId } from "@/types/execution-trace";

export interface ParsedCommand {
  tool?: string;
  arguments?: Record<string, unknown>;
  action?: "unknown";
  unsupportedMessage?: string;
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
  traceHooks?.onStageStart?.("intent-analysis");
  const routed = deterministicPreRouter(message, server);
  if (routed) {
    traceHooks?.onStageComplete?.("intent-analysis");
    traceHooks?.onStageStart?.("mcp-plan-preparation");
    traceHooks?.onStageComplete?.("mcp-plan-preparation");
    return routed;
  }

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

  let llmResponse;
  try {
    llmResponse = await generate(prompt, [message]);
  } catch (error) {
    const fallback = deterministicPreRouter(message, server);
    if (fallback?.tool) {
      traceHooks?.onStageFallback?.("intent-analysis", "Used a validated deterministic route after Gemini intent analysis failed.");
      traceHooks?.onStageComplete?.("intent-analysis");
      traceHooks?.onStageStart?.("mcp-plan-preparation");
      traceHooks?.onStageComplete?.("mcp-plan-preparation");
      return fallback;
    }
    if (error instanceof GeminiQuotaError || error instanceof GeminiTemporaryUnavailableError) {
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
    const fallback = deterministicPreRouter(message, server);
    if (fallback?.tool) {
      traceHooks?.onStageFallback?.("intent-analysis", "Used a validated deterministic route after Gemini returned an unsuccessful result.");
      traceHooks?.onStageComplete?.("intent-analysis");
      traceHooks?.onStageStart?.("mcp-plan-preparation");
      traceHooks?.onStageComplete?.("mcp-plan-preparation");
      return fallback;
    }
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
    const fallback = deterministicPreRouter(message, server);
    if (fallback?.tool) {
      traceHooks?.onStageFallback?.("intent-analysis", "Used a validated deterministic route after Gemini returned an invalid intent.");
      traceHooks?.onStageComplete?.("mcp-plan-preparation");
      return fallback;
    }
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

const DETERMINISTIC_COMMANDS: ReadonlyArray<{
  phrases: readonly string[];
  tool: string;
  arguments: Record<string, unknown>;
}> = [
  {
    phrases: ["show products", "list products", "show all products", "list all products"],
    tool: "products.getProducts",
    arguments: {},
  },
  {
    phrases: ["show inventory summary", "inventory summary"],
    tool: "analytics.inventorySummary",
    arguments: {},
  },
];

function deterministicPreRouter(message: string, server: CommandFlowMCPServer): ParsedCommand | undefined {
  const normalizedCommand = message
    .normalize("NFKC")
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ");
  const normalized = normalizedCommand.toLowerCase();
  const variantDeletionMatch = matchVariantDeletionCommand(normalizedCommand);
  const deleteProductMatch = normalizedCommand.match(/^delete product (\S+)$/i);
  const getProductMatch = normalizedCommand.match(
    /^(?:what is the )?name of product (\S+)$/i,
  ) ?? normalizedCommand.match(/^(?:show|get|find|lookup) product (\S+)$/i);
  const getProductDetailsMatch = normalizedCommand.match(
    /^(?:get|show|fetch|find|lookup) details for (?:product )?(\S+)$/i,
  );
  const stockUpdateMatch = normalizedCommand.match(
    /^(?:set|update) stock of (?:sku\s+(\S+)|(?!sku\b)(\S+))\s+to\s+(\d+)$/i,
  );
  const priceUpdateMatch = normalizedCommand.match(
    /^(?:set|update|change) price of (?:product\s+)?(\S+)(?:\s+variant\s+(\S+))?\s+to\s+(\d+(?:\.\d+)?)$/i,
  );
  const candidate = DETERMINISTIC_COMMANDS.find((item) => item.phrases.includes(normalized))
    ?? (variantDeletionMatch
      ? {
        tool: "products.deleteVariant",
        arguments: {
          productId: variantDeletionMatch.productId,
          sku: variantDeletionMatch.sku,
        },
      }
      : undefined)
    ?? (deleteProductMatch
      ? { tool: "products.deleteProduct", arguments: { productId: deleteProductMatch[1] } }
      : undefined)
    ?? (getProductMatch
      ? { tool: "products.getProduct", arguments: { productId: getProductMatch[1] } }
      : undefined)
    ?? (getProductDetailsMatch
      ? { tool: "products.getProduct", arguments: { productId: getProductDetailsMatch[1] } }
      : undefined)
    ?? (stockUpdateMatch
      ? {
        tool: "products.updateStock",
        arguments: { sku: stockUpdateMatch[1] ?? stockUpdateMatch[2], stock: Number(stockUpdateMatch[3]) },
      }
      : undefined);

  const routedCandidate = candidate ?? (priceUpdateMatch
    ? {
      tool: "products.adjustPrice",
      arguments: {
        productId: priceUpdateMatch[1],
        operation: "set",
        price: Number(priceUpdateMatch[3] ?? priceUpdateMatch[2]),
        ...(priceUpdateMatch[2] ? { sku: priceUpdateMatch[2] } : {}),
      },
    }
    : undefined);

  if (routedCandidate) {
    if (!server.listTools().some((tool) => tool.name === routedCandidate.tool)) {
      if (routedCandidate.tool === "products.deleteVariant") {
        return {
          action: "unknown",
          unsupportedMessage: "Variant deletion is not supported by the connected Inventory Backend.",
        };
      }
      return {
        action: "unknown",
        unsupportedMessage: "This command is not available to your account.",
      };
    }

    try {
      const argumentsObject = server.validateToolInput(routedCandidate.tool, { ...routedCandidate.arguments });
      if (isPlainObject(argumentsObject)) return { tool: routedCandidate.tool, arguments: argumentsObject };
    } catch {
      return {
        action: "unknown",
        unsupportedMessage: "The command arguments are invalid for the requested operation.",
      };
    }
    return {
      action: "unknown",
      unsupportedMessage: "The command arguments are invalid for the requested operation.",
    };
  }

  if (/^delete\b/i.test(normalizedCommand)) {
    return {
      action: "unknown",
      unsupportedMessage: "Variant deletion is not supported by the connected Inventory Backend; deleting a variant or other item is not supported by the registered product tools.",
    };
  }

  const isUiModificationRequest = /^(?:change|set|update)\b/i.test(normalizedCommand)
    && /\b(?:background|theme|colour|color|frontend|interface)\b/i.test(normalizedCommand);
  const backgroundMatch = normalizedCommand.match(
    /^(?:change|set|update)\s+(?:the\s+)?(?:(frontend)\s+)?background(?:\s+(?:colour|color))?\s+to\s+(.+)$/i,
  );
  if (backgroundMatch) {
    const toolName = backgroundMatch[1] ? "frontend.updateBackground" : "ui.setBackground";
    if (!server.listTools().some((tool) => tool.name === toolName)) {
      return { action: "unknown", unsupportedMessage: "Background changes are not available to your account." };
    }
    const background = backgroundMatch[2].trim().toLowerCase();
    try {
      const argumentsObject = server.validateToolInput(toolName, { background });
      if (isPlainObject(argumentsObject)) return { tool: toolName, arguments: argumentsObject };
    } catch {
      return {
        action: "unknown",
        unsupportedMessage: "That background value is unsupported by the registered CommandFlow background tools.",
      };
    }
    return {
      action: "unknown",
      unsupportedMessage: "That background value is unsupported by the registered CommandFlow background tools.",
    };
  }

  const themeMatch = normalizedCommand.match(
    /^(?:change|set|update)\s+(?:the\s+)?(?:frontend\s+)?theme\s+to\s+(light|dark|system)$/i,
  );
  if (themeMatch) {
    return validateDeterministicUiCandidate(
      server,
      "frontend.updateTheme",
      { theme: themeMatch[1].toLowerCase() },
      "That theme value is unsupported by the registered frontend tools.",
    );
  }

  const navbarMatch = normalizedCommand.match(
    /^(?:change|set|update)\s+(?:the\s+)?(?:frontend\s+)?navbar(?:\s+density\s+to\s+(comfortable|compact))?\s*(?:and\s+)?(show company name|hide company name)$/i,
  );
  if (navbarMatch) {
    const density = navbarMatch[1] ?? "comfortable";
    const showCompanyName = navbarMatch[2].toLowerCase() === "show company name";
    return validateDeterministicUiCandidate(
      server,
      "frontend.updateNavbar",
      { density, showCompanyName },
      "That navbar setting is unsupported or incomplete for the registered frontend tools.",
    );
  }

  const brandingMatch = normalizedCommand.match(
    /^(?:change|set|update)\s+(?:the\s+)?(?:frontend\s+)?branding\s+accent\s+to\s+(mint|sky|amber)\s+and\s+mark\s+to\s+(commandflow|inventory)$/i,
  );
  if (brandingMatch) {
    return validateDeterministicUiCandidate(
      server,
      "frontend.updateBranding",
      { accent: brandingMatch[1].toLowerCase(), mark: brandingMatch[2].toLowerCase() },
      "That branding value is unsupported or incomplete for the registered frontend tools.",
    );
  }

  if (isUiModificationRequest) {
    return {
      action: "unknown",
      unsupportedMessage: "This UI modification is not supported by the registered CommandFlow tools.",
    };
  }

  return undefined;
}

function matchVariantDeletionCommand(
  command: string,
): { productId?: string; sku: string } | undefined {
  const token = `(?:"([^"\r\n]+)"|'([^'\r\n]+)'|(\S+))`;
  const explicitVariant = command.match(new RegExp(`^delete variant ${token}$`, "i"));
  if (explicitVariant) {
    return { sku: explicitVariant[1] ?? explicitVariant[2] ?? explicitVariant[3] };
  }

  const productAndVariant = command.match(
    new RegExp(`^delete product (?:"([^"\r\n]+)"|'([^'\r\n]+)'|(\S+)) variant ${token}$`, "i"),
  );
  if (productAndVariant) {
    return {
      productId: productAndVariant[1] ?? productAndVariant[2] ?? productAndVariant[3],
      sku: productAndVariant[4] ?? productAndVariant[5] ?? productAndVariant[6],
    };
  }

  const quotedSku = command.match(
    /^delete product (?:"([^"\r\n]+)"|'([^'\r\n]+)'|(\S+))\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)')$/i,
  );
  if (quotedSku) {
    return {
      productId: quotedSku[1] ?? quotedSku[2] ?? quotedSku[3],
      sku: quotedSku[4] ?? quotedSku[5],
    };
  }

  return undefined;
}

function validateDeterministicUiCandidate(
  server: CommandFlowMCPServer,
  tool: string,
  argumentsObject: Record<string, unknown>,
  invalidMessage: string,
): ParsedCommand {
  if (!server.listTools().some((item) => item.name === tool)) {
    return { action: "unknown", unsupportedMessage: "This UI tool is not available to your account." };
  }

  try {
    const validated = server.validateToolInput(tool, argumentsObject);
    if (isPlainObject(validated)) return { tool, arguments: validated };
  } catch {
    // Return a safe non-executable result for unsupported values.
  }
  return { action: "unknown", unsupportedMessage: invalidMessage };
}
