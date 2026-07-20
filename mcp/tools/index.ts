import { createGetProductsTool } from "./products/getProducts";
import { createUpdateProductPriceTool } from "./products/updateProductPrice";
import { createUpdateStockTool } from "./products/updateStock";
import { createGetOrdersTool } from "./orders/getOrders";
import { createGetUsersTool } from "./users/getUsers";
import { createCreateConversationTool } from "./conversations/createConversation";
import type { MCPTool } from "../types";

export function createDefaultTools(): MCPTool[] {
  return [
    createGetProductsTool(),
    createUpdateProductPriceTool(),
    createUpdateStockTool(),
    createGetOrdersTool(),
    createGetUsersTool(),
    createCreateConversationTool(),
  ];
}

export {
  createGetProductsTool,
  createUpdateProductPriceTool,
  createUpdateStockTool,
  createGetOrdersTool,
  createGetUsersTool,
  createCreateConversationTool,
};
