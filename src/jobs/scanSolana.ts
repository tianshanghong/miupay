import type { ConfigIndex } from "../config.js";
import type { PaymentIndexEntry } from "../types.js";
import type { StateStore } from "../stateStore.js";
import { attachPaymentToInvoice, selectMatchingInvoice } from "../matching.js";
import {
  deriveAta,
  getSignaturesForAddress,
  getTransaction,
} from "../chains/solanaRpc.js";

async function fetchNewSignatures(
  rpcUrl: string,
  address: string,
  lastSeen: string | null,
  limit: number,
  commitment: "finalized",
) {
  const collected: string[] = [];
  let before: string | undefined;
  let found = false;

  while (!found) {
    const batch = await getSignaturesForAddress(rpcUrl, address, {
      limit,
      before,
      commitment,
    });
    if (batch.length === 0) {
      break;
    }
    for (const info of batch) {
      if (info.signature === lastSeen) {
        found = true;
        break;
      }
      collected.push(info.signature);
    }
    if (found) {
      break;
    }
    if (batch.length < limit) {
      break;
    }
    before = batch[batch.length - 1]?.signature;
    if (!before) {
      break;
    }
  }

  return collected;
}

function getAccountKeys(message: { accountKeys: Array<{ pubkey: string }> | string[] }): string[] {
  return message.accountKeys.map((key) => (typeof key === "string" ? key : key.pubkey));
}

export async function scanSolana(store: StateStore, configIndex: ConfigIndex, now: number) {
  const solanaChains = configIndex.config.chains.filter((chain) => chain.type === "solana");

  for (const chain of solanaChains) {
    const commitment = chain.finality.commitment ?? "finalized";
    for (const token of chain.tokens) {
      const checkpointKey = `${chain.id}:${token.id}`;
      const tokenProgramId = configIndex.solanaTokenProgramsByChain
        .get(chain.id)
        ?.get(token.id);
      if (!tokenProgramId) {
        throw new Error(`missing token program for ${chain.id}:${token.id}`);
      }
      const ata = deriveAta(chain.receiveOwner ?? "", token.mint ?? "", tokenProgramId);
      let lastSeen: string | null = null;

      await store.withLock((state) => {
        const checkpoint = state.checkpoints[checkpointKey];
        if (checkpoint?.type === "solana") {
          lastSeen = checkpoint.lastSeenSignature;
        } else {
          state.checkpoints[checkpointKey] = {
            type: "solana",
            lastSeenSignature: null,
          };
        }
      });

      const batchSize = configIndex.config.scan.solanaSignatureBatchSize;
      let signatures: string[] = [];
      if (!lastSeen) {
        const latest = await getSignaturesForAddress(chain.rpcUrl, ata, {
          limit: batchSize,
          commitment,
        });
        signatures = latest.map((entry) => entry.signature);
      } else {
        signatures = await fetchNewSignatures(
          chain.rpcUrl,
          ata,
          lastSeen,
          batchSize,
          commitment,
        );
      }

      if (signatures.length === 0) {
        continue;
      }

      const newestSignature = signatures[0];
      const ordered = [...signatures].reverse();
      const payments: PaymentIndexEntry[] = [];

      for (const signature of ordered) {
        const transaction = await getTransaction(chain.rpcUrl, signature, commitment);
        if (!transaction || !transaction.meta || transaction.meta.err) {
          continue;
        }
        const accountKeys = getAccountKeys(transaction.transaction.message);
        const ataIndex = accountKeys.findIndex((key) => key === ata);
        if (ataIndex === -1) {
          continue;
        }
        const preBalances = transaction.meta.preTokenBalances ?? [];
        const postBalances = transaction.meta.postTokenBalances ?? [];
        const pre = preBalances.filter((balance) => balance.accountIndex === ataIndex);
        const post = postBalances.filter((balance) => balance.accountIndex === ataIndex);

        const preAmount = pre
          .filter((entry) => entry.mint === token.mint)
          .reduce((acc, entry) => acc + BigInt(entry.uiTokenAmount.amount), 0n);
        const postAmount = post
          .filter((entry) => entry.mint === token.mint)
          .reduce((acc, entry) => acc + BigInt(entry.uiTokenAmount.amount), 0n);

        const delta = postAmount - preAmount;
        if (delta <= 0n) {
          continue;
        }

        const ref = `sol:${signature}:0`;
        payments.push({
          seenAt: now,
          chainId: chain.id,
          tokenId: token.id,
          ref,
          txHashOrSig: signature,
          to: ata,
          amount: delta.toString(),
          blockRef: transaction.slot,
        });
      }

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
          type: "solana",
          lastSeenSignature: newestSignature,
        };
      });
    }
  }
}
