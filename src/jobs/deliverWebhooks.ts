import type { ConfigIndex } from "../config.js";
import type { StateStore } from "../stateStore.js";
import type { WebhookQueueItem } from "../types.js";
import { buildWebhookPayload, computeNextAttempt, signPayload, shouldDeadLetter } from "../webhooks.js";

type DeliveryAttempt = {
  item: WebhookQueueItem;
  payload: string;
  url: string;
  secret: string;
};

type DeliveryResult = {
  item: WebhookQueueItem;
  success: boolean;
};

async function sendWebhook(attempt: DeliveryAttempt): Promise<DeliveryResult> {
  try {
    const signature = signPayload(attempt.payload, attempt.secret);
    const response = await fetch(attempt.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": signature,
      },
      body: attempt.payload,
    });
    if (!response.ok) {
      return { item: attempt.item, success: false };
    }
    return { item: attempt.item, success: true };
  } catch {
    return { item: attempt.item, success: false };
  }
}

export async function deliverWebhooks(store: StateStore, configIndex: ConfigIndex, now: number) {
  const dueAttempts = await store.read((state) => {
    const attempts: DeliveryAttempt[] = [];
    for (const item of state.webhookQueue) {
      if (item.nextAttemptAt > now) {
        continue;
      }
      const invoice = state.invoices[item.invoiceId];
      const endpoint = configIndex.webhookEndpointsById.get(item.endpointId);
      if (!invoice || !endpoint) {
        continue;
      }
      const payload = JSON.stringify(buildWebhookPayload(item.event, invoice));
      attempts.push({
        item,
        payload,
        url: endpoint.url,
        secret: endpoint.secret,
      });
    }
    return attempts;
  });

  if (dueAttempts.length === 0) {
    return;
  }

  const results: DeliveryResult[] = [];
  for (const attempt of dueAttempts) {
    results.push(await sendWebhook(attempt));
  }

  await store.withLock((state) => {
    for (const result of results) {
      const index = state.webhookQueue.findIndex((item) => item.id === result.item.id);
      if (index === -1) {
        continue;
      }
      if (result.success) {
        state.webhookQueue.splice(index, 1);
        continue;
      }
      const current = state.webhookQueue[index];
      current.attempt += 1;
      if (shouldDeadLetter(current.attempt)) {
        state.webhookDeadLetter.push(current);
        state.webhookQueue.splice(index, 1);
        continue;
      }
      current.nextAttemptAt = computeNextAttempt(current.attempt, now);
    }
  });
}
