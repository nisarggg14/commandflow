import { createMcpContext } from "@/mcp/context";
import { CommandFlowMCPServer } from "@/mcp/server";
import { createToolsForClient } from "@/mcp/tools";
import { Permission } from "@/mcp/types";

export function createCommandServer(
  userId: string,
  companyId: string,
  role: Permission | string,
  mfaChallengeToken?: string,
  connectedClientId?: string,
  enabledToolNames?: string[],
  requestId?: string,
  approvalId?: string,
  conversationId?: string,
  originalCommand?: string,
) {
  const context = createMcpContext({
    userId,
    companyId,
    role,
    requestId,
    logger: () => undefined,
    mfaChallengeToken,
    approvalId,
    connectedClientId,
    conversationId,
    originalCommand,
  });

  const server = new CommandFlowMCPServer(context);
  // A selected client must have an explicit server-resolved tool policy. If a
  // caller constructs a client-bound server without one, expose nothing.
  const tools = connectedClientId ? createToolsForClient(enabledToolNames ?? []) : createToolsForClient(enabledToolNames);
  server.registerTools(tools);

  return server;
}
