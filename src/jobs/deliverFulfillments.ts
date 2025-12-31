import type { StateStore } from "../stateStore.js";
import type { FulfillmentQueueItem } from "../types.js";
import type { FulfillmentRegistry, FulfillmentContext } from "../fulfillments/registry.js";
import { computeNextAttempt, shouldDeadLetter } from "../fulfillments/queue.js";

type DeliveryAttempt = {
  item: FulfillmentQueueItem;
  moduleId: string;
  invoiceId: string;
};

type DeliveryResult = {
  item: FulfillmentQueueItem;
  success: boolean;
  error?: string;
};

type StaleItem = {
  item: FulfillmentQueueItem;
  reason: string;
};

async function sendFulfillment(
  attempt: DeliveryAttempt,
  ctx: FulfillmentContext,
  registry: FulfillmentRegistry,
): Promise<DeliveryResult> {
  const module = registry.byId.get(attempt.moduleId);
  if (!module?.handleEvent) {
    return { item: attempt.item, success: true };
  }
  const invoice = await ctx.store.read((state) => state.invoices[attempt.invoiceId]);
  if (!invoice) {
    return { item: attempt.item, success: true };
  }
  try {
    await module.handleEvent(attempt.item.event, invoice, ctx);
    return { item: attempt.item, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { item: attempt.item, success: false, error: message };
  }
}

export async function deliverFulfillments(
  store: StateStore,
  registry: FulfillmentRegistry,
  now: number,
) {
  const { attempts: dueAttempts, staleItems } = await store.read((state) => {
    const attempts: DeliveryAttempt[] = [];
    const staleItems: StaleItem[] = [];
    for (const item of state.fulfillmentQueue) {
      if (item.nextAttemptAt > now) {
        continue;
      }
      if (!registry.byId.has(item.moduleId)) {
        staleItems.push({ item, reason: `module missing: ${item.moduleId}` });
        continue;
      }
      const invoice = state.invoices[item.idempotencyId];
      if (!invoice) {
        staleItems.push({ item, reason: `invoice missing: ${item.idempotencyId}` });
        continue;
      }
      attempts.push({
        item,
        moduleId: item.moduleId,
        invoiceId: item.idempotencyId,
      });
    }
    return { attempts, staleItems };
  });

  if (dueAttempts.length === 0 && staleItems.length === 0) {
    return;
  }

  const results: DeliveryResult[] = [];
  for (const attempt of dueAttempts) {
    results.push(await sendFulfillment(attempt, registry.ctx, registry));
  }

  await store.withLock((state) => {
    for (const stale of staleItems) {
      const index = state.fulfillmentQueue.findIndex((item) => item.id === stale.item.id);
      if (index === -1) {
        continue;
      }
      const current = state.fulfillmentQueue[index];
      current.lastError = stale.reason;
      state.fulfillmentDeadLetter.push(current);
      state.fulfillmentQueue.splice(index, 1);
    }

    for (const result of results) {
      const index = state.fulfillmentQueue.findIndex((item) => item.id === result.item.id);
      if (index === -1) {
        continue;
      }
      if (result.success) {
        state.fulfillmentQueue.splice(index, 1);
        continue;
      }
      const current = state.fulfillmentQueue[index];
      current.attempt += 1;
      current.lastError = result.error;
      if (shouldDeadLetter(current.attempt)) {
        state.fulfillmentDeadLetter.push(current);
        state.fulfillmentQueue.splice(index, 1);
        continue;
      }
      current.nextAttemptAt = computeNextAttempt(current.attempt, now);
    }
  });
}
