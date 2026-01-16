import express from "express";
import type { ConfigIndex } from "../../config.js";
import type { StateStore } from "../../stateStore.js";
import type { FulfillmentEventType, Invoice } from "../types.js";
import { buildMediaModule } from "./media/module.js";
import { deriveModuleSecret, getFulfillmentSecret } from "./secrets.js";

export type FulfillmentContext = {
  configIndex: ConfigIndex;
  store: StateStore;
};

export type FulfillmentModule = {
  id: string;
  events: FulfillmentEventType[];
  routes?: (router: express.Router) => void;
  handleEvent?: (
    event: FulfillmentEventType,
    invoice: Invoice,
    ctx: FulfillmentContext,
  ) => Promise<void>;
};

export type FulfillmentRegistry = {
  modules: FulfillmentModule[];
  byId: Map<string, FulfillmentModule>;
  ctx: FulfillmentContext;
};

export function buildFulfillmentRegistry(
  configIndex: ConfigIndex,
  store: StateStore,
): FulfillmentRegistry {
  const modules: FulfillmentModule[] = [];
  const fulfillments = configIndex.config.fulfillments;

  const ctx: FulfillmentContext = { configIndex, store };

  if (fulfillments?.media?.enabled) {
    const baseSecret = getFulfillmentSecret();
    const mediaSecret = deriveModuleSecret(baseSecret, "media");
    modules.push(buildMediaModule({
      config: fulfillments.media,
      store,
      secret: mediaSecret,
      defaultBaseUrl: `http://localhost:${configIndex.config.server.port}`,
    }));
  }

  return {
    modules,
    byId: new Map(modules.map((module) => [module.id, module])),
    ctx,
  };
}

export function registerFulfillmentRoutes(app: express.Express, registry: FulfillmentRegistry) {
  for (const module of registry.modules) {
    if (!module.routes) {
      continue;
    }
    const router = express.Router();
    module.routes(router);
    app.use(`/fulfillments/${module.id}`, router);
  }
}
