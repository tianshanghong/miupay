import type { FulfillmentConfig, FulfillmentModuleId, ProductConfig } from "../types.js";

export function resolveProductFulfillments(
  product: ProductConfig,
  fulfillments: FulfillmentConfig | undefined,
): FulfillmentModuleId[] {
  if (product.fulfillments !== undefined) {
    return product.fulfillments;
  }
  if (!fulfillments) {
    return [];
  }
  const resolved: FulfillmentModuleId[] = [];
  if (fulfillments.media?.enabled) {
    resolved.push("media");
  }
  if (fulfillments.telegram?.enabled) {
    resolved.push("telegram");
  }
  return resolved;
}

export function productHasFulfillment(
  product: ProductConfig,
  moduleId: FulfillmentModuleId,
  fulfillments: FulfillmentConfig | undefined,
): boolean {
  return resolveProductFulfillments(product, fulfillments).includes(moduleId);
}
