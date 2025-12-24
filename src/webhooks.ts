import crypto from "crypto";
import type { ConfigIndex } from "./config.js";
import type { Invoice, State, WebhookEvent, WebhookQueueItem } from "./types.js";

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 5_000;

export function enqueueWebhooks(
  state: State,
  event: WebhookEvent,
  invoiceId: string,
  configIndex: ConfigIndex,
  now: number,
) {
  for (const endpoint of configIndex.config.webhooks.endpoints) {
    if (!endpoint.events.includes(event)) {
      continue;
    }
    const item: WebhookQueueItem = {
      id: crypto.randomUUID(),
      event,
      invoiceId,
      endpointId: endpoint.id,
      attempt: 0,
      nextAttemptAt: now,
      createdAt: now,
    };
    state.webhookQueue.push(item);
  }
}

export function buildWebhookPayload(event: WebhookEvent, invoice: Invoice) {
  return {
    event,
    data: {
      id: invoice.id,
      productId: invoice.productId,
      chainId: invoice.chainId,
      tokenId: invoice.tokenId,
      expectedAmount: invoice.expectedAmount,
      baseAmount: invoice.baseAmount ?? invoice.expectedAmount,
      verificationCode: invoice.verificationCode ?? null,
      status: invoice.status,
      createdAt: invoice.createdAt,
      expiresAt: invoice.expiresAt,
      payment: invoice.payment ?? null,
      paidAt: invoice.paidAt ?? null,
    },
  };
}

export function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function computeNextAttempt(attempt: number, now: number): number {
  const factor = Math.min(10, attempt + 1);
  return now + BASE_BACKOFF_MS * factor;
}

export function shouldDeadLetter(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}
