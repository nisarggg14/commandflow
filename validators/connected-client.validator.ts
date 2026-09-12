import { z } from "zod";
import { clientToolNameSchema } from "@/mcp/client-tool-policy";

export const connectedClientAuthTypeEnum = z.enum(["NONE", "BEARER", "API_KEY", "BASIC"]);
export const connectedClientStatusEnum = z.enum(["ACTIVE", "INACTIVE"]);

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const connectedClientSlugSchema = z.string()
  .min(2, "Slug must be at least 2 characters.")
  .max(60, "Slug must be at most 60 characters.")
  .regex(SLUG_PATTERN, "Slug may only contain lowercase letters, numbers, and single hyphens between segments.");

export const connectedClientBaseUrlSchema = z.string()
  .min(1, "Base URL is required.")
  .max(500, "Base URL must be at most 500 characters.")
  .superRefine((value, ctx) => {
    let parsed: URL;
    try { parsed = new URL(value); } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Base URL must be a valid absolute URL." });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Base URL must use the http or https protocol." });
    }
    if (parsed.username || parsed.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Base URL must not contain embedded credentials." });
    }
    if (!parsed.hostname) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Base URL must include a hostname." });
    }
  });

export const connectedClientAuthConfigSchema = z.record(z.string(), z.string().max(2000)).optional();

function requireAuthConfigForAuthType(
  data: { authType?: string; authConfig?: Record<string, string> },
  ctx: z.RefinementCtx,
) {
  if (data.authType && data.authType !== "NONE" && (!data.authConfig || Object.keys(data.authConfig).length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `authConfig is required when authType is ${data.authType}.`,
      path: ["authConfig"],
    });
  }
}

export const createConnectedClientSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters.").max(100),
  slug: connectedClientSlugSchema.optional(),
  description: z.string().max(500).optional(),
  baseUrl: connectedClientBaseUrlSchema,
  authType: connectedClientAuthTypeEnum.default("BEARER"),
  authConfig: connectedClientAuthConfigSchema,
  status: connectedClientStatusEnum.optional(),
  enabledTools: z.array(clientToolNameSchema).max(100).optional(),
}).superRefine(requireAuthConfigForAuthType);

export const updateConnectedClientSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  slug: connectedClientSlugSchema.optional(),
  description: z.string().max(500).optional().nullable(),
  baseUrl: connectedClientBaseUrlSchema.optional(),
  authType: connectedClientAuthTypeEnum.optional(),
  authConfig: connectedClientAuthConfigSchema,
  status: connectedClientStatusEnum.optional(),
  enabledTools: z.array(clientToolNameSchema).max(100).optional(),
}).superRefine((data, ctx) => {
  if (Object.keys(data).length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one field must be provided to update." });
    return;
  }
  requireAuthConfigForAuthType(data, ctx);
});

export type CreateConnectedClientInput = z.infer<typeof createConnectedClientSchema>;
export type UpdateConnectedClientInput = z.infer<typeof updateConnectedClientSchema>;

export function slugifyName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
