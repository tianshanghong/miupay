import type { ConfigIndex } from "../config.js";
import type { StateStore } from "../stateStore.js";
import { enqueueFulfillments } from "../core/fulfillments/queue.js";
import { enqueueWebhooks } from "../core/webhooks.js";

const WINDOW_MS = 2 * 60 * 1000;

export async function expireInvoices(store: StateStore, configIndex: ConfigIndex, now: number) {
  await store.withLock((state) => {
    for (const invoice of Object.values(state.invoices)) {
      if (invoice.status !== "PENDING") {
        continue;
      }
      if (invoice.payment) {
        continue;
      }
      const checkpointKey = `${invoice.chainId}:${invoice.tokenId}`;
      const scanCoverageTime = state.checkpoints[checkpointKey]?.cursorTimeMs;
      if (scanCoverageTime === undefined) {
        continue;
      }
      if (scanCoverageTime <= invoice.expiresAt + WINDOW_MS) {
        continue;
      }
      invoice.status = "EXPIRED";
      enqueueWebhooks(state, "invoice.expired", invoice.idempotencyId, configIndex, now);
      enqueueFulfillments(state, "invoice.expired", invoice, configIndex, now);
    }
  });
}
