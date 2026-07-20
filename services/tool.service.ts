import { createMcpContext } from "@/mcp/context";
import { CommandFlowMCPServer } from "@/mcp/server";
import { createDefaultTools } from "@/mcp/tools";
import { Permission } from "@/mcp/types";

export function createCommandServer(userId: string, companyId: string, role: Permission | string) {
  const context = createMcpContext({
    userId,
    companyId,
    role,
    logger: () => undefined,
  });

  const server = new CommandFlowMCPServer(context);
  server.registerTools(createDefaultTools());

  return server;
}
