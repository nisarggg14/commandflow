import type { PrismaClient } from "@prisma/client";
import { decryptSecret } from "@/lib/mfa";
import { NotFoundError } from "@/lib/errors";
import { CLIENT_TOOL_NAMES, parseStoredEnabledToolNames } from "@/mcp/client-tool-policy";
import { runWithInventoryApiConnection, type InventoryApiConnection } from "@/services/inventory-api.service";
import { runWithOrderApiConnection } from "@/services/order-api.service";
import type { MCPContext } from "@/mcp/types";

import { assertSafeOutboundUrl } from "@/lib/ssrf";

const CONNECTOR_TIMEOUT_MS = 10_000;

export async function validateConnectedClientSelection(
  connectedClientId: string | null | undefined,
  companyId: string,
  db: Pick<PrismaClient, "connectedClient">,
): Promise<string | undefined> {
  if (!connectedClientId) return undefined;

  const client = await db.connectedClient.findFirst({
    where: { id: connectedClientId, companyId, status: "ACTIVE" },
    select: { id: true },
  });

  if (!client) throw new NotFoundError("Selected connected client is unavailable.");
  return client.id;
}

export async function getConnectedClientToolNames(
  connectedClientId: string | undefined,
  companyId: string,
  db: PrismaClient,
): Promise<string[] | undefined> {
  if (!connectedClientId) return undefined;
  const client = await db.connectedClient.findFirst({
    where: { id: connectedClientId, companyId, status: "ACTIVE" },
    select: { enabledTools: true } as any,
  } as any);
  if (!client) throw new NotFoundError("Selected connected client is unavailable.");
  return parseStoredEnabledToolNames((client as { enabledTools?: unknown }).enabledTools) ?? [...CLIENT_TOOL_NAMES];
}

function readAuthConfig(authType: string, encryptedAuthConfig: string | null): Record<string, string> {
  if (authType === "NONE") return {};
  if (!encryptedAuthConfig) throw new Error("Connected client credentials are unavailable.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptSecret(encryptedAuthConfig));
  } catch {
    throw new Error("Connected client credentials could not be loaded.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Connected client credentials are invalid.");
  }

  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") config[key] = value;
  }
  return config;
}

async function buildConnection(client: {
  baseUrl: string;
  authType: string;
  authConfig: string | null;
}): Promise<InventoryApiConnection> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(client.baseUrl);
  } catch {
    throw new Error("Connected client base URL is invalid.");
  }

  if ((parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") || parsedUrl.username || parsedUrl.password || !parsedUrl.hostname) {
    throw new Error("Connected client base URL is not allowed.");
  }

  if (client.authType !== "NONE" && client.authType !== "BEARER" && client.authType !== "API_KEY" && client.authType !== "BASIC") {
    throw new Error("Connected client authentication type is not supported.");
  }

  if (client.authType !== "NONE" && parsedUrl.protocol !== "https:") {
    throw new Error("Authenticated connected clients must use HTTPS.");
  }

  return {
    baseUrl: client.baseUrl.replace(/\/+$/, ""),
    authType: client.authType,
    authConfig: readAuthConfig(client.authType, client.authConfig),
    timeoutMs: CONNECTOR_TIMEOUT_MS,
  };
}

export async function withAuthenticatedConnectedClient<T>(
  context: Pick<MCPContext, "companyId" | "connectedClientId" | "prisma">,
  operation: () => Promise<T>,
  db: PrismaClient = context.prisma
): Promise<T> {
  if (!context.connectedClientId) return operation();

  const client = await db.connectedClient.findFirst({
    where: {
      id: context.connectedClientId,
      companyId: context.companyId,
      status: "ACTIVE",
    },
    select: { baseUrl: true, authType: true, authConfig: true },
  });

  if (!client) throw new NotFoundError("Selected connected client is unavailable.");

  const connection = await buildConnection(client);
  return runWithInventoryApiConnection(connection, () => runWithOrderApiConnection(connection, operation));
}
