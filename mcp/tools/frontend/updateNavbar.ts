import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

const inputSchema = z.object({
  density: z.enum(["comfortable", "compact"]),
  showCompanyName: z.boolean(),
}).strict();

export function createUpdateNavbarTool(): MCPTool {
  return {
    name: "frontend.updateNavbar",
    description: "Update the frontend navbar using allowlisted layout settings.",
    category: ToolCategory.UI,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    riskLevel: RiskLevel.MEDIUM,
    inputSchema,
    execute(input) {
      return { type: "frontend-control", action: "updateNavbar", ...inputSchema.parse(input) };
    },
  };
}
