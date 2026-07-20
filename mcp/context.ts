import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MCPContext, MCPLogger, Permission } from "./types";

interface CreateMcpContextOptions {
  userId: string;
  companyId: string;
  role: Permission | string;
  requestId?: string;
  prismaClient?: PrismaClient;
  logger?: MCPLogger;
}

export function createMcpContext({
  userId,
  companyId,
  role,
  requestId,
  prismaClient,
  logger,
}: CreateMcpContextOptions): MCPContext {
  return {
    userId,
    companyId,
    role,
    requestId: requestId ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    prisma: prismaClient ?? prisma,
    logger: logger ?? (() => undefined),
  };
}
