import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import type {
  AppConfig,
  ChainConfig,
  FulfillmentConfig,
  FulfillmentModuleId,
  MediaFulfillmentConfig,
  ProductConfig,
  TelegramFulfillmentConfig,
  TokenConfig,
  WebhookEndpointConfig,
  WebhookEvent,
} from "./types.js";
import { getAccountOwner } from "./chains/solanaRpc.js";

const amountSchema = z
  .string()
  .regex(/^[0-9]+$/, "amount must be a base-unit integer string");

const webhookEventSchema = z.union([
  z.literal("invoice.paid"),
  z.literal("invoice.expired"),
]);

const webhookEndpointSchema: z.ZodType<WebhookEndpointConfig> = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  secret: z.string().min(1),
  events: z.array(webhookEventSchema).min(1),
});

const fulfillmentModuleSchema = z.enum(["media", "telegram"]);

const mediaFulfillmentSchema: z.ZodType<MediaFulfillmentConfig> = z.object({
  enabled: z.boolean(),
  mediaRoot: z.string().min(1).optional(),
  publicBaseUrl: z.string().url().optional(),
  tokenTtlMs: z.number().int().min(1).optional(),
  rateLimitMax: z.number().int().min(1).optional(),
  rateLimitWindowMs: z.number().int().min(1).optional(),
});

const telegramFulfillmentSchema: z.ZodType<TelegramFulfillmentConfig> = z.object({
  enabled: z.boolean(),
  botToken: z.string().min(1).optional(),
  targetChatId: z.string().min(1).optional(),
});

const fulfillmentSchema: z.ZodType<FulfillmentConfig> = z
  .object({
    media: mediaFulfillmentSchema.optional(),
    telegram: telegramFulfillmentSchema.optional(),
  })
  .passthrough();

const tokenSchema: z.ZodType<TokenConfig> = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().min(0),
  contractAddress: z.string().optional(),
  mint: z.string().optional(),
});

const chainSchema: z.ZodType<ChainConfig> = z.object({
  id: z.string().min(1),
  type: z.union([z.literal("evm"), z.literal("solana")]),
  rpcUrl: z.string().url(),
  receiveAddress: z.string().optional(),
  receiveOwner: z.string().optional(),
  finality: z.object({
    confirmations: z.number().int().min(0).optional(),
    bufferBlocks: z.number().int().min(0).optional(),
    commitment: z.literal("finalized").optional(),
  }),
  tokens: z.array(tokenSchema).min(1),
});

const productSchema: z.ZodType<ProductConfig> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  amount: amountSchema,
  chainId: z.string().min(1),
  tokenId: z.string().min(1),
  active: z.boolean(),
  fulfillments: z.array(fulfillmentModuleSchema).optional(),
});

const configSchema: z.ZodType<AppConfig> = z.object({
  server: z.object({
    port: z.number().int().min(1),
  }),
  invoice: z.object({
    ttlMinutes: z.number().int().min(1),
    verificationDigits: z.number().int().min(0).max(6),
  }),
  scan: z.object({
    intervalMs: z.number().int().min(1000),
    evmMaxBlockRange: z.number().int().min(1),
    solanaSignatureBatchSize: z.number().int().min(1),
  }),
  chains: z.array(chainSchema).min(1),
  products: z.array(productSchema),
  webhooks: z.object({
    endpoints: z.array(webhookEndpointSchema),
  }),
  fulfillments: fulfillmentSchema.optional(),
  admin: z.object({
    bearerToken: z.string().min(1),
  }),
});

export type ConfigIndex = {
  config: AppConfig;
  productsById: Map<string, ProductConfig>;
  chainsById: Map<string, ChainConfig>;
  tokensByChain: Map<string, Map<string, TokenConfig>>;
  solanaTokenProgramsByChain: Map<string, Map<string, string>>;
  webhookEndpointsById: Map<string, WebhookEndpointConfig>;
  webhookEventsByEndpoint: Map<string, Set<WebhookEvent>>;
};

function assertUnique(name: string, values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`duplicate ${name}: ${value}`);
    }
    seen.add(value);
  }
}

function validateChains(chains: ChainConfig[]) {
  for (const chain of chains) {
    if (chain.type === "evm") {
      if (!chain.receiveAddress) {
        throw new Error(`chain ${chain.id} missing receiveAddress`);
      }
      for (const token of chain.tokens) {
        if (!token.contractAddress) {
          throw new Error(`token ${token.id} on ${chain.id} missing contractAddress`);
        }
      }
      if (chain.finality.confirmations === undefined) {
        throw new Error(`chain ${chain.id} missing finality.confirmations`);
      }
      if (chain.finality.bufferBlocks === undefined) {
        throw new Error(`chain ${chain.id} missing finality.bufferBlocks`);
      }
    }
    if (chain.type === "solana") {
      if (!chain.receiveOwner) {
        throw new Error(`chain ${chain.id} missing receiveOwner`);
      }
      for (const token of chain.tokens) {
        if (!token.mint) {
          throw new Error(`token ${token.id} on ${chain.id} missing mint`);
        }
      }
    }
  }
}

function validateProductFulfillments(config: AppConfig) {
  const enabled = new Set<FulfillmentModuleId>();
  if (config.fulfillments?.media?.enabled) {
    enabled.add("media");
  }
  if (config.fulfillments?.telegram?.enabled) {
    enabled.add("telegram");
  }

  for (const product of config.products) {
    if (!product.fulfillments || product.fulfillments.length === 0) {
      continue;
    }
    for (const moduleId of product.fulfillments) {
      if (!enabled.has(moduleId)) {
        throw new Error(`product ${product.id} references disabled fulfillment ${moduleId}`);
      }
    }
  }
}

function buildIndexes(config: AppConfig): Omit<ConfigIndex, "solanaTokenProgramsByChain"> {
  assertUnique(
    "chain id",
    config.chains.map((chain) => chain.id),
  );
  assertUnique(
    "product id",
    config.products.map((product) => product.id),
  );
  assertUnique(
    "webhook endpoint id",
    config.webhooks.endpoints.map((endpoint) => endpoint.id),
  );

  validateChains(config.chains);
  validateProductFulfillments(config);

  const productsById = new Map<string, ProductConfig>();
  for (const product of config.products) {
    productsById.set(product.id, product);
  }

  const chainsById = new Map<string, ChainConfig>();
  const tokensByChain = new Map<string, Map<string, TokenConfig>>();
  for (const chain of config.chains) {
    chainsById.set(chain.id, chain);
    assertUnique(
      `token id for chain ${chain.id}`,
      chain.tokens.map((token) => token.id),
    );
    const tokensById = new Map<string, TokenConfig>();
    for (const token of chain.tokens) {
      tokensById.set(token.id, token);
    }
    tokensByChain.set(chain.id, tokensById);
  }

  for (const product of config.products) {
    const chain = chainsById.get(product.chainId);
    if (!chain) {
      throw new Error(`product ${product.id} references missing chain ${product.chainId}`);
    }
    const token = tokensByChain.get(product.chainId)?.get(product.tokenId);
    if (!token) {
      throw new Error(
        `product ${product.id} references missing token ${product.tokenId} on chain ${product.chainId}`,
      );
    }
  }

  const webhookEndpointsById = new Map<string, WebhookEndpointConfig>();
  const webhookEventsByEndpoint = new Map<string, Set<WebhookEvent>>();
  for (const endpoint of config.webhooks.endpoints) {
    webhookEndpointsById.set(endpoint.id, endpoint);
    webhookEventsByEndpoint.set(endpoint.id, new Set(endpoint.events));
  }

  return {
    config,
    productsById,
    chainsById,
    tokensByChain,
    webhookEndpointsById,
    webhookEventsByEndpoint,
  };
}

export function validateConfig(config: unknown): AppConfig {
  const parsed = configSchema.parse(config);
  buildIndexes(parsed);
  return parsed;
}

export async function loadConfig(configPath?: string): Promise<ConfigIndex> {
  const resolvedPath = configPath ?? path.join(process.cwd(), "config.json");
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  const config = validateConfig(parsed);
  const index = buildIndexes(config);
  const solanaTokenProgramsByChain = await resolveSolanaTokenPrograms(config);
  return {
    ...index,
    solanaTokenProgramsByChain,
  };
}

async function resolveSolanaTokenPrograms(
  config: AppConfig,
): Promise<Map<string, Map<string, string>>> {
  const byChain = new Map<string, Map<string, string>>();
  const mintOwners = new Map<string, string>();

  for (const chain of config.chains) {
    if (chain.type !== "solana") {
      continue;
    }
    const byToken = new Map<string, string>();
    for (const token of chain.tokens) {
      if (!token.mint) {
        throw new Error(`token ${token.id} on ${chain.id} missing mint`);
      }
      let owner = mintOwners.get(token.mint);
      if (!owner) {
        owner = await getAccountOwner(chain.rpcUrl, token.mint);
        mintOwners.set(token.mint, owner);
      }
      byToken.set(token.id, owner);
    }
    byChain.set(chain.id, byToken);
  }

  return byChain;
}
