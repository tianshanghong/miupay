import type { ConfigIndex } from "../config.js";
import type { StateStore } from "../stateStore.js";
import type { Invoice } from "../types.js";
import { enqueueFulfillments } from "../fulfillments/queue.js";
import { enqueueWebhooks } from "../webhooks.js";
import { getBlockNumber } from "../chains/evmRpc.js";
import { getSignatureStatuses } from "../chains/solanaRpc.js";

export async function settleInvoices(store: StateStore, configIndex: ConfigIndex, now: number) {
  const snapshot = await store.snapshot();
  const candidates = Object.values(snapshot.invoices).filter(
    (invoice) => invoice.status === "PENDING" && invoice.payment,
  );

  if (candidates.length === 0) {
    return;
  }

  const byChain = new Map<string, Invoice[]>();
  for (const invoice of candidates) {
    const list = byChain.get(invoice.chainId) ?? [];
    list.push(invoice);
    byChain.set(invoice.chainId, list);
  }

  for (const [chainId, invoices] of byChain) {
    const chain = configIndex.chainsById.get(chainId);
    if (!chain) {
      continue;
    }
    if (chain.type === "evm") {
      const head = await getBlockNumber(chain.rpcUrl);
      const confirmations = chain.finality.confirmations ?? 0;
      const ready = invoices.filter((invoice) => {
        const blockRef = invoice.payment?.blockRef;
        if (!blockRef) {
          return false;
        }
        const count = head - blockRef + 1;
        return count >= confirmations;
      });
      if (ready.length === 0) {
        continue;
      }
      await store.withLock((state) => {
        for (const invoice of ready) {
          const target = state.invoices[invoice.idempotencyId];
          if (!target || target.status !== "PENDING") {
            continue;
          }
          target.status = "PAID";
          target.paidAt = now;
          enqueueWebhooks(state, "invoice.paid", target.idempotencyId, configIndex, now);
          enqueueFulfillments(state, "invoice.paid", target, configIndex, now);
        }
      });
    }
    if (chain.type === "solana") {
      const signatures = invoices
        .map((invoice) => invoice.payment?.txHashOrSig)
        .filter((sig): sig is string => Boolean(sig));
      if (signatures.length === 0) {
        continue;
      }
      const statuses = await getSignatureStatuses(chain.rpcUrl, signatures);
      const finalized = new Set<string>();
      statuses.value.forEach((status, idx) => {
        if (status?.confirmationStatus === "finalized") {
          finalized.add(signatures[idx]);
        }
      });
      if (finalized.size === 0) {
        continue;
      }
      await store.withLock((state) => {
        for (const invoice of invoices) {
          if (!invoice.payment) {
            continue;
          }
          if (!finalized.has(invoice.payment.txHashOrSig)) {
            continue;
          }
          const target = state.invoices[invoice.idempotencyId];
          if (!target || target.status !== "PENDING") {
            continue;
          }
          target.status = "PAID";
          target.paidAt = now;
          enqueueWebhooks(state, "invoice.paid", target.idempotencyId, configIndex, now);
          enqueueFulfillments(state, "invoice.paid", target, configIndex, now);
        }
      });
    }
  }
}
