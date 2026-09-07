import { getProducts, type InventoryProduct } from "@/services/inventory-api.service";

const productReferenceTools = new Set([
  "products.getProduct",
  "products.updateProduct",
  "products.updateStock",
  "products.adjustPrice",
  "products.deleteProduct",
]);

export function isProductReferenceTool(toolName: string): boolean {
  return productReferenceTools.has(toolName);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export async function resolveProductReference(
  toolName: string,
  input: Record<string, unknown>,
  message: string
): Promise<Record<string, unknown>> {
  if (!isProductReferenceTool(toolName)) {
    return input;
  }

  const productId = typeof input.productId === "string" ? input.productId.trim() : "";
  const explicitQuery = ["productQuery", "productName"]
    .map((key) => input[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const idFromMessage = message.match(/\bP\d+\b/i)?.[0];
  const reference = productId || explicitQuery?.trim() || idFromMessage;

  if (!reference) {
    return input;
  }

  const products = await getProducts();
  const normalizedReference = normalize(reference);
  const exactIdMatches = products.filter(
    (product) => normalize(product.productId) === normalizedReference
  );
  const matches = exactIdMatches.length > 0
    ? exactIdMatches
    : products.filter((product) => normalize(product.name).includes(normalizedReference));

  if (matches.length === 0) {
    throw new Error(`Product not found: ${reference}.`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple products match "${reference}". Please specify a product ID: ${matches
        .map((product) => product.productId)
        .join(", ")}.`
    );
  }

  const resolved = matches[0];
  const { productQuery: _productQuery, productName: _productName, ...rest } = input;

  return {
    ...rest,
    productId: resolved.productId,
  };
}

export function resolveSingleVariant(
  product: InventoryProduct,
  input: { sku?: string; variantId?: string }
) {
  if (input.variantId) {
    const variant = product.variants.find(
      (candidate) => (candidate as typeof candidate & { variantId?: string }).variantId === input.variantId
    );
    if (!variant) {
      throw new Error(`Variant not found: ${input.variantId}.`);
    }
    return variant;
  }

  if (input.sku) {
    const variant = product.variants.find((candidate) => candidate.sku === input.sku);
    if (!variant) {
      throw new Error(`Variant not found for SKU: ${input.sku}.`);
    }
    return variant;
  }

  if (product.variants.length !== 1) {
    throw new Error(
      `Product ${product.productId} has multiple variants. Please specify a SKU or variant ID.`
    );
  }

  return product.variants[0];
}