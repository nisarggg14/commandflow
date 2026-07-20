import { createGetProductsTool } from "./products/getProducts";
import { createCreateProductTool } from "./products/createProduct";
import { createUpdateProductPriceTool } from "./products/updateProductPrice";
import { createUpdateStockTool } from "./products/updateStock";
import { createDeleteProductTool } from "./products/deleteProduct";
import { createGetOrdersTool } from "./orders/getOrders";
import { createCancelOrderTool } from "./orders/cancelOrder";
import { createUpdateOrderStatusTool } from "./orders/updateOrderStatus";
import { createGetUsersTool } from "./users/getUsers";
import { createCreateUserTool } from "./users/createUser";
import { createDisableUserTool } from "./users/disableUser";
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
    createCreateProductTool(),
    createUpdateProductPriceTool(),
    createUpdateStockTool(),
    createDeleteProductTool(),
    createGetOrdersTool(),
    createCancelOrderTool(),
    createUpdateOrderStatusTool(),
    createGetUsersTool(),
    createCreateUserTool(),
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
  createCreateProductTool,
  createUpdateProductPriceTool,
  createUpdateStockTool,
  createDeleteProductTool,
  createGetOrdersTool,
  createCancelOrderTool,
  createUpdateOrderStatusTool,
  createGetUsersTool,
  createCreateUserTool,
  createDisableUserTool,
  createCreateConversationTool,
  createRenameConversationTool,
  createDeleteConversationTool,
  createListApplicationsTool,
  createEnableApplicationTool,
  createDisableApplicationTool,
};
