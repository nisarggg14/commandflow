import type { ConnectedClient, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/mfa";
import {
  AuthenticationServiceError,
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from "@/lib/errors";
import { parseStoredEnabledToolNames } from "@/mcp/client-tool-policy";
import {
  createConnectedClientSchema,
  updateConnectedClientSchema,
  slugifyName,
  type CreateConnectedClientInput,
  type UpdateConnectedClientInput,
} from "@/validators/connected-client.validator";

type PrismaLike = PrismaClient | Prisma.TransactionClient;
const PRISMA_UNIQUE_CONSTRAINT_CODE = "P2002";

export interface SafeConnectedClient {
  id: string; name: string; slug: string; description: string | null; status: string;
  baseUrl: string; authType: string; hasCredentials: boolean; companyId: string;
  createdAt: string; updatedAt: string; enabledTools: string[] | null;
}

function parseEnabledTools(value: unknown): string[] | null {
  return parseStoredEnabledToolNames(value) ?? null;
}

export function toSafeConnectedClient(client: ConnectedClient): SafeConnectedClient {
  return {
    id: client.id, name: client.name, slug: client.slug, description: client.description,
    status: client.status, baseUrl: client.baseUrl, authType: client.authType,
    hasCredentials: Boolean(client.authConfig), companyId: client.companyId,
    createdAt: client.createdAt.toISOString(), updatedAt: client.updatedAt.toISOString(),
    enabledTools: parseEnabledTools((client as ConnectedClient & { enabledTools?: string | null }).enabledTools),
  };
}

async function assertSlugAvailable(db: PrismaLike, companyId: string, slug: string, excludeId?: string) {
  const existing = await db.connectedClient.findFirst({
    where: { companyId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (existing) throw new ConflictError(`A connected client with slug "${slug}" already exists for this company.`);
}

async function writeAuditLog(db: PrismaLike, params: { action: string; userId: string; companyId: string; details: Record<string, unknown> }) {
  await db.activityLog.create({
    data: { action: params.action, status: "SUCCESS", details: JSON.stringify(params.details), userId: params.userId, companyId: params.companyId },
  });
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === PRISMA_UNIQUE_CONSTRAINT_CODE;
}

export async function createConnectedClient(rawInput: unknown, actingUser: { id: string; companyId: string }, db: PrismaLike = defaultPrisma): Promise<SafeConnectedClient> {
  const input: CreateConnectedClientInput = createConnectedClientSchema.parse(rawInput);
  const slug = input.slug ?? slugifyName(input.name);
  if (!slug) throw new ConflictError("Unable to derive a valid slug from the provided name. Please provide one explicitly.");
  await assertSlugAvailable(db, actingUser.companyId, slug);
  const encryptedAuthConfig = input.authType === "NONE" ? null : (input.authConfig && Object.keys(input.authConfig).length > 0 ? encryptSecret(JSON.stringify(input.authConfig)) : null);
  let created: ConnectedClient;
  try {
    created = await db.connectedClient.create({ data: {
      name: input.name, slug, description: input.description ?? null, baseUrl: input.baseUrl,
      authType: input.authType, authConfig: encryptedAuthConfig, status: input.status ?? "ACTIVE",
      companyId: actingUser.companyId,
      enabledTools: input.enabledTools !== undefined ? JSON.stringify(input.enabledTools) : null,
    } as any });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ConflictError(`A connected client with slug "${slug}" already exists for this company.`);
    throw error;
  }
  await writeAuditLog(db, { action: "CONNECTED_CLIENT_CREATED", userId: actingUser.id, companyId: actingUser.companyId, details: { connectedClientId: created.id, name: created.name, slug: created.slug, authType: created.authType, status: created.status } });
  return toSafeConnectedClient(created);
}

export async function listConnectedClients(companyId: string, filters: { status?: "ACTIVE" | "INACTIVE" } = {}, db: PrismaLike = defaultPrisma): Promise<SafeConnectedClient[]> {
  let clients: ConnectedClient[];
  try {
    clients = await db.connectedClient.findMany({
      where: { companyId, ...(filters.status ? { status: filters.status } : {}) },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    throw new AuthenticationServiceError("Connected clients could not be loaded.", error);
  }
  return clients.map(toSafeConnectedClient);
}

export async function getConnectedClientById(id: string, companyId: string, db: PrismaLike = defaultPrisma): Promise<SafeConnectedClient> {
  const client = await db.connectedClient.findFirst({ where: { id, companyId } });
  if (!client) throw new NotFoundError("Connected client not found.");
  return toSafeConnectedClient(client);
}

export async function updateConnectedClient(id: string, rawInput: unknown, actingUser: { id: string; companyId: string }, db: PrismaLike = defaultPrisma): Promise<SafeConnectedClient> {
  const input: UpdateConnectedClientInput = updateConnectedClientSchema.parse(rawInput);
  const existing = await db.connectedClient.findFirst({ where: { id, companyId: actingUser.companyId } });
  if (!existing) throw new NotFoundError("Connected client not found.");
  const nextAuthType = input.authType ?? existing.authType;
  const nextBaseUrl = input.baseUrl ?? existing.baseUrl;
  if (nextAuthType !== "NONE" && new URL(nextBaseUrl).protocol !== "https:") {
    throw new ValidationFailedError("Authenticated connected clients must use HTTPS.");
  }
  if (input.slug && input.slug !== existing.slug) await assertSlugAvailable(db, actingUser.companyId, input.slug, id);

  const data: Prisma.ConnectedClientUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.description !== undefined) data.description = input.description;
  if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
  if (input.authType !== undefined) data.authType = input.authType;
  if (input.status !== undefined) data.status = input.status;
  if (input.enabledTools !== undefined) (data as any).enabledTools = JSON.stringify(input.enabledTools);
  // Switching to NONE is an explicit credential revocation, even when the
  // PATCH omits authConfig. Credentials supplied alongside NONE are ignored.
  if (input.authType === "NONE") data.authConfig = null;
  else if (input.authConfig !== undefined) data.authConfig = Object.keys(input.authConfig).length > 0 ? encryptSecret(JSON.stringify(input.authConfig)) : null;

  let updated: ConnectedClient;
  try { updated = await db.connectedClient.update({ where: { id }, data }); }
  catch (error) {
    if (isUniqueConstraintError(error)) throw new ConflictError(`A connected client with slug "${input.slug ?? existing.slug}" already exists for this company.`);
    throw error;
  }
  await writeAuditLog(db, { action: "CONNECTED_CLIENT_UPDATED", userId: actingUser.id, companyId: actingUser.companyId, details: { connectedClientId: updated.id, slug: updated.slug, status: updated.status, changedFields: Object.keys(input) } });
  return toSafeConnectedClient(updated);
}

export async function deleteConnectedClient(id: string, actingUser: { id: string; companyId: string }, db: PrismaLike = defaultPrisma): Promise<{ success: true; message: string }> {
  const existing = await db.connectedClient.findFirst({ where: { id, companyId: actingUser.companyId } });
  if (!existing) throw new NotFoundError("Connected client not found.");
  await db.connectedClient.delete({ where: { id } });
  await writeAuditLog(db, { action: "CONNECTED_CLIENT_DELETED", userId: actingUser.id, companyId: actingUser.companyId, details: { connectedClientId: existing.id, slug: existing.slug, name: existing.name } });
  return { success: true, message: "Connected client deleted successfully." };
}
