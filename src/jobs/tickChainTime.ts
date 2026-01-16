import type { ConfigIndex } from "../config.js";
import type { StateStore } from "../stateStore.js";
import { getBlockNumber, getBlockTimestampMs } from "../chains/evmRpc.js";
import { getBlockTime, getSlot } from "../chains/solanaRpc.js";

export async function tickChainTime(store: StateStore, configIndex: ConfigIndex, now: number) {
  const updates: Array<{ chainId: string; chainTimeMs: number }> = [];

  for (const chain of configIndex.config.chains) {
    if (chain.type === "evm") {
      const head = await getBlockNumber(chain.rpcUrl);
      const confirmations = chain.finality.confirmations ?? 0;
      const safeHead = head - confirmations;
      if (safeHead <= 0) {
        continue;
      }
      const chainTimeMs = await getBlockTimestampMs(chain.rpcUrl, safeHead);
      updates.push({ chainId: chain.id, chainTimeMs });
      continue;
    }

    const commitment = chain.finality.commitment ?? "finalized";
    const slot = await getSlot(chain.rpcUrl, commitment);
    const blockTime = await getBlockTime(chain.rpcUrl, slot);
    if (blockTime === null) {
      continue;
    }
    updates.push({ chainId: chain.id, chainTimeMs: blockTime * 1000 });
  }

  if (updates.length === 0) {
    return;
  }

  await store.withLock((state) => {
    for (const update of updates) {
      state.chainTime[update.chainId] = {
        chainTimeMs: update.chainTimeMs,
        updatedAt: now,
      };
    }
  });
}
