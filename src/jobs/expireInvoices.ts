import type { ConfigIndex } from "../config.js";
import type { StateStore } from "../stateStore.js";
import { enqueueFulfillments } from "../fulfillments/queue.js";
import { enqueueWebhooks } from "../webhooks.js";

export async function expireInvoices(store: StateStore, configIndex: ConfigIndex, now: number) {
  await store.withLock((state) => {
    for (const invoice of Object.values(state.invoices)) {
      if (invoice.status !== "PENDING") {
        continue;
      }
      if (invoice.payment) {
        continue;
      }
      if (invoice.expiresAt > now) {
        continue;
      }
      invoice.status = "EXPIRED";
      enqueueWebhooks(state, "invoice.expired", invoice.idempotencyId, configIndex, now);
      enqueueFulfillments(state, "invoice.expired", invoice, configIndex, now);
    }
  });
}
