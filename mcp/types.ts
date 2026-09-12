import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

export enum Permission {
  ADMIN = "ADMIN",
  MANAGER = "MANAGER",
  VIEWER = "VIEWER",
}

export enum ToolCategory {
  PRODUCTS = "PRODUCTS",
  ORDERS = "ORDERS",
  USERS = "USERS",
  CONVERSATIONS = "CONVERSATIONS",
  ANALYTICS = "ANALYTICS",
  SYSTEM = "SYSTEM",
  UI = "UI",
}

export enum RiskLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export interface MCPContext {
  userId: string;
  companyId: string;
  role: Permission | string;
  requestId: string;
  timestamp: string;
  prisma: PrismaClient;
  logger: MCPLogger;
  mfaVerified?: boolean;
  mfaChallengeToken?: string;
  connectedClientId?: string;
}

export interface AuditLogEntry {
  tool: string;
  user: string;
  company: string;
  timestamp: string;
  duration: number;
  status: "SUCCESS" | "FAILED";
  riskLevel?: string;
  mfaRequired?: boolean;
  mfaResult?: "SUCCESS" | "FAILED" | "NOT_REQUIRED";
  details?: string;
  errorMessage?: string;
}

export type MCPLogger = (entry: AuditLogEntry) => void | Promise<void>;

export interface ToolMetadata {
  name: string;
  description: string;
  category: ToolCategory | string;
  permissions: Permission[];
  inputSchema: Record<string, unknown>;
}

export interface MCPTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  category: ToolCategory;
  permissions: Permission[];
  riskLevel?: RiskLevel;
  requiresMfaStepUp?: boolean;
  mfaPurpose?: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: TInput, context: MCPContext) => Promise<TOutput> | TOutput;
}

export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  tool: string;
  data?: T;
  message?: string;
  error?: {
    name: string;
    message: string;
  };
}

export interface ToolRegistry {
  register(tool: MCPTool): void;
  unregister(name: string): void;
  get(name: string): MCPTool | undefined;
  list(): MCPTool[];
  execute(name: string, input: unknown, context: MCPContext): Promise<ToolExecutionResult>;
}

export class ToolNotFoundError extends Error {
  constructor(message = "Tool not found") {
    super(message);
    this.name = "ToolNotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message = "Validation failed") {
    super(message);
    this.name = "ValidationError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(message = "Permission denied") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export class ExecutionError extends Error {
  constructor(message = "Tool execution failed") {
    super(message);
    this.name = "ExecutionError";
  }
}
