import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export async function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const windowStart = new Date(now - (now % windowMs));
  const expiresAt = new Date(now + windowMs);
  const bucketKey = crypto.createHash("sha256").update(key).digest("hex");
  await prisma.$executeRaw`
    INSERT INTO "RateLimitBucket" ("id", "key", "count", "windowStart", "expiresAt") VALUES (${crypto.randomUUID()}, ${bucketKey}, 1, ${windowStart}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RateLimitBucket"."windowStart" < ${windowStart} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < ${windowStart} THEN ${windowStart} ELSE "RateLimitBucket"."windowStart" END,
      "expiresAt" = CASE WHEN "RateLimitBucket"."windowStart" < ${windowStart} THEN ${expiresAt} ELSE "RateLimitBucket"."expiresAt" END
  `;
  const rows = await prisma.$queryRaw<Array<{ count: number; expiresAt: Date }>>`SELECT "count", "expiresAt" FROM "RateLimitBucket" WHERE "key" = ${bucketKey}`;

  const bucket = rows[0];
  return { allowed: (bucket?.count ?? limit + 1) <= limit, retryAfterSeconds: Math.max(1, Math.ceil(((bucket?.expiresAt.getTime() ?? now + windowMs) - now) / 1000)) };
}

export function requestAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}