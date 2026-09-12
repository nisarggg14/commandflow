import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    if (/(authorization|bearer|jwt|token|password|mfa|otp|api[_ -]?key|secret)/i.test(value)) {
      return "[redacted]";
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeValue(entry),
      ])
    );
  }

  return value;
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticate(req);

    if (authUser.role === "VIEWER") {
      throw new ForbiddenError("Only ADMIN and MANAGER users can view audit logs.");
    }

    const params = req.nextUrl.searchParams;
    const userId = params.get("userId") || undefined;
    const connectedClientId = params.get("connectedClientId") || undefined;
    const status = params.get("status");
    const risk = params.get("risk")?.toUpperCase();
    const search = params.get("search")?.trim();
    const from = params.get("from"); const to = params.get("to");
    const logs = await prisma.activityLog.findMany({
      where: {
        companyId: authUser.companyId,
        ...(userId ? { userId } : {}),
        ...(connectedClientId ? { connectedClientId } : {}),
        ...(status && ["SUCCESS", "FAILED", "PENDING"].includes(status) ? { status: status as "SUCCESS" | "FAILED" | "PENDING" } : {}),
        ...(risk ? { details: { contains: `"riskLevel":"${risk}"` } } : {}),
        ...(search ? { OR: [{ action: { contains: search, mode: "insensitive" } }, { details: { contains: search, mode: "insensitive" } }] } : {}),
        ...((from || to) ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 250,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        connectedClient: { select: { id: true, name: true, slug: true } },
      },
    });

    const safeLogs = logs.map((log) => {
      let parsedDetails: Record<string, unknown> = {};

      if (log.details) {
        try {
          const parsed = JSON.parse(log.details);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            parsedDetails = parsed as Record<string, unknown>;
          } else {
            parsedDetails = { value: parsed };
          }
        } catch {
          parsedDetails = { raw: log.details };
        }
      }

      const safeDetails = sanitizeValue(parsedDetails) as Record<string, unknown>;

      return {
        id: log.id,
        action: log.action,
        status: log.status,
        createdAt: log.createdAt.toISOString(),
        user: {
          id: log.user.id,
          name: log.user.name,
          email: log.user.email,
        },
        details: safeDetails,
        approvalId: typeof safeDetails.approvalId === "string" ? safeDetails.approvalId : null,
        requestId: typeof safeDetails.requestId === "string" ? safeDetails.requestId : null,
        riskLevel: typeof safeDetails.riskLevel === "string" ? safeDetails.riskLevel : null,
        safeOperationSummary:
          typeof safeDetails.safeOperationSummary === "string"
            ? safeDetails.safeOperationSummary
            : typeof safeDetails.operation === "string"
              ? safeDetails.operation
              : typeof safeDetails.summary === "string"
                ? safeDetails.summary
              : null,
        connectedClient: log.connectedClient,
      };
    });

    return NextResponse.json({ success: true, logs: safeLogs });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 403 });
    }

    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unable to load audit logs.",
      },
      { status: 500 }
    );
  }
}
