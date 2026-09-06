import { createGetProductsTool } from "./products/getProducts";
import { createGetProductTool } from "./products/getProduct";
import { createCreateProductTool } from "./products/createProduct";
import { createSearchProductsTool } from "./products/searchProducts";
import { createUpdateProductTool } from "./products/updateProduct";
import { createBulkUpdateStatusTool } from "./products/bulkUpdateStatus";
import { createUpdateStockTool } from "./products/updateStock";
import { createDeleteProductTool } from "./products/deleteProduct";
import { createGetOrdersTool } from "./orders/getOrders";
import { createCancelOrderTool } from "./orders/cancelOrder";
import { createUpdateOrderStatusTool } from "./orders/updateOrderStatus";
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
    createDeleteProductTool(),
    createInventorySummaryTool(),
    createLowStockReportTool(),
    createGetOrdersTool(),
    createCancelOrderTool(),
    createUpdateOrderStatusTool(),
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
  createDeleteProductTool,
  createInventorySummaryTool,
  createLowStockReportTool,
  createGetOrdersTool,
  createCancelOrderTool,
  createUpdateOrderStatusTool,
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
