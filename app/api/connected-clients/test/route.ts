import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { ZodError } from "zod";

import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { connectedClientErrorResponse } from "@/lib/connected-client-api-error";
import { testInventoryApiConnection } from "@/services/inventory-api.service";
import { inventoryLoginCredentialsSchema, connectedClientBaseUrlSchema } from "@/validators/connected-client.validator";

export async function POST(req: NextRequest) {
  try {
    const actor = await authenticate(req);
    requireRole(actor, [UserRole.ADMIN]);
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ZodError([]);
    }
    const input = body as Record<string, unknown>;
    const baseUrl = connectedClientBaseUrlSchema.parse(input.baseUrl);
    const credentials = inventoryLoginCredentialsSchema.parse({
      username: input.username,
      password: input.password,
    });
    const result = await testInventoryApiConnection(baseUrl, credentials);
    return NextResponse.json({ success: true, productCount: result.productCount });
  } catch (error) {
    return connectedClientErrorResponse(error);
  }
}
