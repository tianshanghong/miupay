import crypto from "crypto";
import type { ConfigIndex } from "../../config.js";
import type { FulfillmentEventType, FulfillmentQueueItem, Invoice, State } from "../types.js";
import { productHasFulfillment } from "./selection.js";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 5_000;

export function enqueueFulfillments(
  state: State,
  event: FulfillmentEventType,
  invoice: Invoice,
  configIndex: ConfigIndex,
  now: number,
) {
  const fulfillments = configIndex.config.fulfillments;
  if (!fulfillments) {
    return;
  }

  const product = configIndex.productsById.get(invoice.productId);
  if (!product) {
    return;
  }

  if (productHasFulfillment(product, "media", fulfillments) && event === "invoice.paid") {
    const item: FulfillmentQueueItem = {
      id: crypto.randomUUID(),
      moduleId: "media",
      event,
      idempotencyId: invoice.idempotencyId,
      attempt: 0,
      nextAttemptAt: now,
      createdAt: now,
    };
    state.fulfillmentQueue.push(item);
  }
}

export function computeNextAttempt(attempt: number, now: number): number {
  const factor = Math.min(5, attempt + 1);
  return now + BASE_BACKOFF_MS * factor;
}

export function shouldDeadLetter(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}
