import { createGetProductsTool } from "./products/getProducts";
import { createGetProductTool } from "./products/getProduct";
import { createCreateProductTool } from "./products/createProduct";
import { createSearchProductsTool } from "./products/searchProducts";
import { createUpdateProductTool } from "./products/updateProduct";
import { createBulkUpdateStatusTool } from "./products/bulkUpdateStatus";
import { createUpdateStockTool } from "./products/updateStock";
import { createAdjustPriceTool } from "./products/adjustPrice";
import { createDeleteProductTool } from "./products/deleteProduct";
import { createGetUsersTool } from "./users/getUsers";
import { createGetUserTool } from "./users/getUser";
import { createCreateUserTool } from "./users/createUser";
import { createChangeRoleTool } from "./users/changeRole";
import { createDisableUserTool } from "./users/disableUser";
import { createInventorySummaryTool } from "./analytics/inventorySummary";
import { createLowStockReportTool } from "./analytics/lowStockReport";
import { createCreateConversationTool } from "./conversations/createConversation";
import { createRenameConversationTool } from "./conversations/renameConversation";
import { createDeleteConversationTool } from "./conversations/deleteConversation";
import { createListApplicationsTool } from "./applications/listApplications";
import { createEnableApplicationTool } from "./applications/enableApplication";
import { createDisableApplicationTool } from "./applications/disableApplication";
import { createGetThemeTool } from "./ui/getTheme";
import { createSetThemeTool } from "./ui/setTheme";
import { createSetBackgroundTool } from "./ui/setBackground";
import { createSetAccentColorTool } from "./ui/setAccentColor";
import type { MCPTool } from "../types";

export function createDefaultTools(): MCPTool[] {
  return [
    createGetProductsTool(),
    createGetProductTool(),
    createCreateProductTool(),
    createSearchProductsTool(),
    createUpdateProductTool(),
    createBulkUpdateStatusTool(),
    createUpdateStockTool(),
    createAdjustPriceTool(),
    createDeleteProductTool(),
    createInventorySummaryTool(),
    createLowStockReportTool(),
    createGetUsersTool(),
    createGetUserTool(),
    createCreateUserTool(),
    createChangeRoleTool(),
    createDisableUserTool(),
    createCreateConversationTool(),
    createRenameConversationTool(),
    createDeleteConversationTool(),
    createListApplicationsTool(),
    createEnableApplicationTool(),
    createDisableApplicationTool(),
    createGetThemeTool(),
    createSetThemeTool(),
    createSetBackgroundTool(),
    createSetAccentColorTool(),
  ];
}

export {
  createGetProductsTool,
  createGetProductTool,
  createCreateProductTool,
  createSearchProductsTool,
  createUpdateProductTool,
  createBulkUpdateStatusTool,
  createUpdateStockTool,
  createAdjustPriceTool,
  createDeleteProductTool,
  createInventorySummaryTool,
  createLowStockReportTool,
  createGetUsersTool,
  createGetUserTool,
  createCreateUserTool,
  createChangeRoleTool,
  createDisableUserTool,
  createCreateConversationTool,
  createRenameConversationTool,
  createDeleteConversationTool,
  createListApplicationsTool,
  createEnableApplicationTool,
  createDisableApplicationTool,
};
