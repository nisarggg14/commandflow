import assert from "node:assert/strict";
import test from "node:test";
import { createSetBackgroundTool } from "@/mcp/tools/ui/setBackground";
import { toolRequiresConnectedClient } from "@/mcp/client-tool-policy";
import type { MCPContext } from "@/mcp/types";
import { CommandFlowMCPServer } from "@/mcp/server";
import { Permission } from "@/mcp/types";

function createServer(connectedClientId?: string, client: Record<string, unknown> | null = null) {
  const prisma = {
    connectedClient: {
      findFirst: async () => client,
    },
  };
  const server = new CommandFlowMCPServer({
    userId: "user-1",
    companyId: "company-1",
    role: Permission.VIEWER,
    requestId: "request-1",
    timestamp: new Date().toISOString(),
    connectedClientId,
    prisma,
    logger: () => undefined,
  } as never);
  server.registerTool(createSetBackgroundTool());
  return server;
}

test("ui.setBackground uses the authoritative allowlist, including black", () => {
  const tool = createSetBackgroundTool();

  assert.equal(tool.inputSchema.safeParse({ background: "mist" }).success, true);
  assert.equal(tool.inputSchema.safeParse({ background: "obsidian" }).success, true);
  assert.equal(tool.inputSchema.safeParse({ background: "black" }).success, true);
  assert.equal(tool.inputSchema.safeParse({ background: "white" }).success, false);
});

test("ui.setBackground is explicitly bound to a selected connected client", () => {
  assert.equal(toolRequiresConnectedClient("ui.setBackground"), true);
});

test("ui.setBackground rejects a missing target before execution", async () => {
  const result = await createServer().executeTool("ui.setBackground", { background: "mist" });

  assert.equal(result.success, false);
  assert.equal(result.message, "Select a target client before running this tool.");
});

test("ui.setBackground reports unsupported connected-client capability truthfully", async () => {
  const result = await createServer("client-1", {
    id: "client-1",
    baseUrl: "https://demo.example.test",
    authType: "NONE",
    authConfig: null,
  }).executeTool("ui.setBackground", { background: "black" });

  assert.equal(result.success, false);
  assert.match(result.message ?? "", /does not expose a supported frontend background capability/i);
  assert.equal(result.data, undefined);
});

test("ui.setBackground refuses to produce a local CommandFlow UI control", async () => {
  const tool = createSetBackgroundTool();

  await assert.rejects(
    async () => await tool.execute({ background: "mist" }, {} as MCPContext),
    /does not expose a supported frontend background capability/,
  );
});
