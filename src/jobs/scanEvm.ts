import type { ConfigIndex } from "../config.js";
import type { PaymentIndexEntry } from "../core/types.js";
import type { StateStore } from "../stateStore.js";
import { attachPaymentToInvoice, selectMatchingInvoice } from "../core/matching.js";
import {
  TRANSFER_TOPIC,
  getBlockNumber,
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
        const logs = await getLogs(chain.rpcUrl, {
          address: token.contractAddress ?? "",
          fromBlock,
          toBlock,
          topics: [TRANSFER_TOPIC, null, padAddressTopic(chain.receiveAddress ?? "")],
        });

        const payments: PaymentIndexEntry[] = logs.map((log) => {
          const amount = hexToBigInt(log.data).toString();
          const ref = `evm:${log.transactionHash}:${hexToNumber(log.logIndex)}`;
          const from = parseAddress(log.topics[1]);
          const to = parseAddress(log.topics[2]) ?? normalizeAddress(chain.receiveAddress ?? "");
          return {
            seenAt: now,
            chainId: chain.id,
            tokenId: token.id,
            ref,
            txHashOrSig: log.transactionHash,
            from,
            to,
            amount,
            blockRef: hexToNumber(log.blockNumber),
          };
        });

        await store.withLock((state) => {
          const matchNow = Date.now();
          for (const payment of payments) {
            if (state.paymentsIndex[payment.ref]) {
              continue;
            }
            state.paymentsIndex[payment.ref] = payment;
            const match = selectMatchingInvoice(state, payment, matchNow);
            if (match) {
              const idempotencyId = attachPaymentToInvoice(state, payment, matchNow);
              if (idempotencyId) {
                payment.idempotencyId = idempotencyId;
              }
            }
          }
          state.checkpoints[checkpointKey] = {
            type: "evm",
            lastScannedBlock: toBlock,
          };
        });

        fromBlock = toBlock + 1;
      }
    }
  }
}
