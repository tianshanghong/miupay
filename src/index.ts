import { loadConfig } from "./config.js";
import { buildFulfillmentRegistry } from "./fulfillments/registry.js";
import { initStateStore } from "./stateStore.js";
import { createServer } from "./server.js";
import { expireInvoices } from "./jobs/expireInvoices.js";
import { scanEvm } from "./jobs/scanEvm.js";
import { scanSolana } from "./jobs/scanSolana.js";
import { settleInvoices } from "./jobs/settleInvoices.js";
import { deliverFulfillments } from "./jobs/deliverFulfillments.js";
import { deliverWebhooks } from "./jobs/deliverWebhooks.js";

async function main() {
  const configIndex = await loadConfig();
  const store = await initStateStore();
  const registry = buildFulfillmentRegistry(configIndex, store);
  const app = createServer(configIndex, store, registry);

  const port = configIndex.config.server.port;
  app.listen(port, () => {
    console.log(`miupay listening on :${port}`);
  });

  let running = false;
  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    const now = Date.now();
    try {
      await scanEvm(store, configIndex, now);
      await scanSolana(store, configIndex, now);
      await settleInvoices(store, configIndex, now);
      await expireInvoices(store, configIndex, now);
      await deliverWebhooks(store, configIndex, now);
      await deliverFulfillments(store, registry, now);
    } catch (error) {
      console.error("job loop error", error);
    } finally {
      running = false;
    }
  };

  setInterval(tick, configIndex.config.scan.intervalMs);
  await tick();
}

main().catch((error) => {
  console.error("fatal", error);
  process.exit(1);
});
