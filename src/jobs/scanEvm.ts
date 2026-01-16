import type { ConfigIndex } from "../config.js";
import type { PaymentIndexEntry } from "../core/types.js";
import type { StateStore } from "../stateStore.js";
import { attachPaymentToInvoice, selectMatchingInvoice } from "../core/matching.js";
import { enqueueFulfillments } from "../core/fulfillments/queue.js";
import { enqueueWebhooks } from "../core/webhooks.js";
import {
  TRANSFER_TOPIC,
  getBlockNumber,
  getBlockTimestampMs,
  getLogs,
  hexToBigInt,
  hexToNumber,
  normalizeAddress,
  padAddressTopic,
} from "../chains/evmRpc.js";

function parseAddress(topic: string | undefined): string | undefined {
  if (!topic) {
    return undefined;
  }
  return `0x${topic.slice(-40)}`.toLowerCase();
}

export async function scanEvm(store: StateStore, configIndex: ConfigIndex, now: number) {
  const evmChains = configIndex.config.chains.filter((chain) => chain.type === "evm");

  for (const chain of evmChains) {
    const head = await getBlockNumber(chain.rpcUrl);
    const confirmations = chain.finality.confirmations ?? 0;
    const scanHead = head - confirmations;
    if (scanHead <= 0) {
      continue;
    }

    const blockTimes = new Map<number, number>();
    const resolveBlockTime = async (blockNumber: number) => {
      const cached = blockTimes.get(blockNumber);
      if (cached !== undefined) {
        return cached;
      }
      const timeMs = await getBlockTimestampMs(chain.rpcUrl, blockNumber);
      blockTimes.set(blockNumber, timeMs);
      return timeMs;
    };

    for (const token of chain.tokens) {
      const checkpointKey = `${chain.id}:${token.id}`;
      let lastScanned = scanHead - 1;

      await store.withLock((state) => {
        const checkpoint = state.checkpoints[checkpointKey];
        if (checkpoint?.type === "evm") {
          lastScanned = checkpoint.lastScannedBlock;
        } else {
          state.checkpoints[checkpointKey] = {
            type: "evm",
            lastScannedBlock: lastScanned,
          };
        }
      });

      if (lastScanned >= scanHead) {
        continue;
      }

      let fromBlock = lastScanned + 1;
      const maxRange = configIndex.config.scan.evmMaxBlockRange;
      while (fromBlock <= scanHead) {
        const toBlock = Math.min(fromBlock + maxRange - 1, scanHead);
        const scanCoverageTime = await resolveBlockTime(toBlock);
        const logs = await getLogs(chain.rpcUrl, {
          address: token.contractAddress ?? "",
          fromBlock,
          toBlock,
          topics: [TRANSFER_TOPIC, null, padAddressTopic(chain.receiveAddress ?? "")],
        });

        const payments: PaymentIndexEntry[] = [];
        for (const log of logs) {
          const blockRef = hexToNumber(log.blockNumber);
          const paymentTime = await resolveBlockTime(blockRef);
          payments.push({
            seenAt: now,
            chainId: chain.id,
            tokenId: token.id,
            ref: `evm:${log.transactionHash}:${hexToNumber(log.logIndex)}`,
            txHashOrSig: log.transactionHash,
            from: parseAddress(log.topics[1]),
            to: parseAddress(log.topics[2]) ?? normalizeAddress(chain.receiveAddress ?? ""),
            amount: hexToBigInt(log.data).toString(),
            blockRef,
            paymentTime,
          });
        }

        await store.withLock((state) => {
          for (const payment of payments) {
            if (state.paymentsIndex[payment.ref]) {
              continue;
            }
            state.paymentsIndex[payment.ref] = payment;
            const match = selectMatchingInvoice(state, payment, scanCoverageTime);
            if (match) {
              const idempotencyId = attachPaymentToInvoice(state, payment, scanCoverageTime);
              if (idempotencyId) {
                payment.idempotencyId = idempotencyId;
                const invoice = state.invoices[idempotencyId];
                if (invoice && invoice.status === "PENDING") {
                  invoice.status = "PAID";
                  invoice.paidAt = payment.paymentTime ?? now;
                  enqueueWebhooks(state, "invoice.paid", idempotencyId, configIndex, now);
                  enqueueFulfillments(state, "invoice.paid", invoice, configIndex, now);
                }
              }
            }
          }
          state.checkpoints[checkpointKey] = {
            type: "evm",
            lastScannedBlock: toBlock,
            cursorTimeMs: scanCoverageTime,
          };
        });

        fromBlock = toBlock + 1;
      }
    }
  }
}
