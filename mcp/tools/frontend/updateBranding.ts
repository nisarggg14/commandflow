import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

const inputSchema = z.object({
  accent: z.enum(["mint", "sky", "amber"]),
  mark: z.enum(["commandflow", "inventory"]),
}).strict();

export function createUpdateBrandingTool(): MCPTool {
  return {
    name: "frontend.updateBranding",
    description: "Update allowlisted frontend branding settings after approval and MFA.",
    category: ToolCategory.UI,
    permissions: [Permission.ADMIN],
    riskLevel: RiskLevel.HIGH,
    requiresMfaStepUp: true,
    mfaPurpose: "frontend.updateBranding",
    inputSchema,
    execute(input) {
      return { type: "frontend-control", action: "updateBranding", ...inputSchema.parse(input) };
    },
  };
}
