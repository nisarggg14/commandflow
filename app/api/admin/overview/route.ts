import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    const user = await authenticate(req); requireRole(user, ["ADMIN"]);
    const companyId = user.companyId;
    const [totalUsers, activeUsers, connectedClients, commandCount, pendingApprovals, recentActivity, failedOperations, highRisk] = await Promise.all([
      prisma.user.count({ where: { companyId } }),
      prisma.user.count({ where: { companyId, active: true } }),
      prisma.connectedClient.count({ where: { companyId, status: "ACTIVE" } }),
      prisma.activityLog.count({ where: { companyId } }),
      prisma.approval.count({ where: { companyId, status: "PENDING" } }),
      prisma.activityLog.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 12, include: { user: { select: { name: true, email: true } }, connectedClient: { select: { name: true, slug: true } } } }),
      prisma.activityLog.count({ where: { companyId, status: "FAILED" } }),
      prisma.activityLog.count({ where: { companyId, details: { contains: '"riskLevel":"HIGH"' } } }),
    ]);
    return NextResponse.json({ success: true, overview: { totalUsers, activeUsers, inactiveUsers: totalUsers - activeUsers, connectedClients, commandCount, pendingApprovals, failedOperations, highRiskOperations: highRisk, recentActivity: recentActivity.map((entry) => ({ id: entry.id, action: entry.action, status: entry.status, timestamp: entry.createdAt.toISOString(), user: entry.user, client: entry.connectedClient })) } });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to load overview." }, { status });
  }
}
