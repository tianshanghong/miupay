import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import type { ConfigIndex } from "./config.js";
import type { FulfillmentRegistry } from "./fulfillments/registry.js";
import type { StateStore } from "./stateStore.js";
import type { Invoice } from "./types.js";
import { deriveAta } from "./chains/solanaRpc.js";
import { registerFulfillmentRoutes } from "./fulfillments/registry.js";
import { resolveMediaAssetPath } from "./fulfillments/media/assets.js";
import { productHasFulfillment } from "./fulfillments/selection.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

type RateEntry = { count: number; resetAt: number };

function createRateLimiter() {
  const entries = new Map<string, RateEntry>();
  return function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return next();
    }
    if (entry.count >= RATE_LIMIT_MAX) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    entry.count += 1;
    next();
  };
}

function requireAdmin(configIndex: ConfigIndex) {
  return function adminGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token || token !== configIndex.config.admin.bearerToken) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

function buildPaymentInstructions(configIndex: ConfigIndex, invoice: Invoice) {
  const chain = configIndex.chainsById.get(invoice.chainId);
  if (!chain) {
    throw new Error(`missing chain ${invoice.chainId}`);
  }
  const token = configIndex.tokensByChain.get(invoice.chainId)?.get(invoice.tokenId);
  if (!token) {
    throw new Error(`missing token ${invoice.tokenId}`);
  }
  if (chain.type === "evm") {
    return {
      chainType: chain.type,
      chainId: chain.id,
      tokenId: token.id,
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals,
      receiveAddress: chain.receiveAddress,
      contractAddress: token.contractAddress,
      amount: invoice.expectedAmount,
      baseAmount: invoice.baseAmount ?? invoice.expectedAmount,
      verificationCode: invoice.verificationCode ?? null,
    };
  }
  const tokenProgramId = configIndex.solanaTokenProgramsByChain
    .get(chain.id)
    ?.get(token.id);
  if (!tokenProgramId) {
    throw new Error(`missing token program for ${chain.id}:${token.id}`);
  }
  const ata = deriveAta(chain.receiveOwner ?? "", token.mint ?? "", tokenProgramId);
  return {
    chainType: chain.type,
    chainId: chain.id,
    tokenId: token.id,
    tokenSymbol: token.symbol,
    tokenDecimals: token.decimals,
    receiveOwner: chain.receiveOwner,
    tokenAccount: ata,
    mint: token.mint,
    amount: invoice.expectedAmount,
    baseAmount: invoice.baseAmount ?? invoice.expectedAmount,
    verificationCode: invoice.verificationCode ?? null,
  };
}

function parseMetadata(input: unknown): Record<string, string> | undefined | null {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== "string") {
      return null;
    }
    metadata[key] = value;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function isActivePending(invoice: Invoice, now: number) {
  return invoice.status === "PENDING" && invoice.expiresAt > now;
}

export function createServer(
  configIndex: ConfigIndex,
  store: StateStore,
  registry: FulfillmentRegistry,
) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const rateLimit = createRateLimiter();

  app.get("/api/products", (_req, res) => {
    const products = configIndex.config.products.filter((product) => product.active);
    res.json({ products });
  });

  app.post("/api/invoices", rateLimit, async (req, res) => {
    const productId = typeof req.body?.productId === "string" ? req.body.productId : "";
    const metadata = parseMetadata(req.body?.metadata);
    if (metadata === null) {
      res.status(400).json({ error: "invalid_metadata" });
      return;
    }
    const product = configIndex.productsById.get(productId);
    if (!product || !product.active) {
      res.status(400).json({ error: "invalid_product" });
      return;
    }

    if (productHasFulfillment(product, "media", configIndex.config.fulfillments)) {
      const assetId = metadata?.assetId;
      if (!assetId || assetId.length === 0) {
        res.status(400).json({ error: "invalid_metadata" });
        return;
      }
      const mediaConfig = configIndex.config.fulfillments?.media;
      if (!mediaConfig?.enabled) {
        res.status(500).json({ error: "media_fulfillment_disabled" });
        return;
      }
      const mediaRoot = mediaConfig.mediaRoot ?? "./media";
      const assetPath = resolveMediaAssetPath(mediaRoot, assetId);
      if (!assetPath) {
        res.status(400).json({ error: "invalid_asset_path" });
        return;
      }
      try {
        const stat = await fs.stat(assetPath);
        if (!stat.isFile()) {
          res.status(400).json({ error: "asset_not_found" });
          return;
        }
      } catch {
        res.status(400).json({ error: "asset_not_found" });
        return;
      }
    }

    const token = configIndex.tokensByChain.get(product.chainId)?.get(product.tokenId);
    if (!token) {
      res.status(500).json({ error: "missing_token" });
      return;
    }

    const verificationDigits = configIndex.config.invoice.verificationDigits;
    if (verificationDigits > token.decimals) {
      res.status(400).json({ error: "verification_digits_too_large" });
      return;
    }

    const now = Date.now();
    const invoice = await store.withLock((state) => {
      const baseAmountValue = BigInt(product.amount);
      const codeMod = 10n ** BigInt(verificationDigits);
      if (verificationDigits > 0 && baseAmountValue % codeMod !== 0n) {
        return { error: "amount_not_aligned_for_verification" } as const;
      }
      if (verificationDigits > 0 && baseAmountValue < 10n * codeMod) {
        return { error: "amount_too_small_for_verification" } as const;
      }

      const reserved = new Set<string>();
      for (const existing of Object.values(state.invoices)) {
        if (!isActivePending(existing, now)) {
          continue;
        }
        if (existing.chainId !== product.chainId || existing.tokenId !== product.tokenId) {
          continue;
        }
        reserved.add(existing.expectedAmount);
      }

      let verificationCode: string | undefined;
      let expectedAmount = product.amount;

      if (verificationDigits === 0) {
        if (reserved.has(product.amount)) {
          return { error: "pending_invoice_exists" } as const;
        }
      } else {
        const maxCodes = Number(codeMod);
        if (reserved.size >= maxCodes) {
          return { error: "verification_code_exhausted" } as const;
        }
        let chosen: number | null = null;
        const maxAttempts = Math.min(32, maxCodes);
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const candidate = crypto.randomInt(0, maxCodes);
          const candidateAmount = (baseAmountValue + BigInt(candidate)).toString();
          if (!reserved.has(candidateAmount)) {
            chosen = candidate;
            expectedAmount = candidateAmount;
            break;
          }
        }
        if (chosen === null) {
          for (let candidate = 0; candidate < maxCodes; candidate += 1) {
            const candidateAmount = (baseAmountValue + BigInt(candidate)).toString();
            if (!reserved.has(candidateAmount)) {
              chosen = candidate;
              expectedAmount = candidateAmount;
              break;
            }
          }
        }
        if (chosen === null) {
          return { error: "verification_code_exhausted" } as const;
        }
        verificationCode = chosen.toString().padStart(verificationDigits, "0");
      }

      const idempotencyId = crypto.randomUUID();
      const ttlMs = configIndex.config.invoice.ttlMinutes * 60_000;
      const createdAt = now;
      const expiresAt = createdAt + ttlMs;
      const created: Invoice = {
        idempotencyId,
        productId: product.id,
        chainId: product.chainId,
        tokenId: product.tokenId,
        expectedAmount,
        baseAmount: product.amount,
        verificationCode,
        metadata,
        status: "PENDING",
        createdAt,
        expiresAt,
      };
      state.invoices[idempotencyId] = created;
      return created;
    });

    if ("error" in invoice) {
      const status = invoice.error === "pending_invoice_exists" ? 409 : 400;
      res.status(status).json({ error: invoice.error });
      return;
    }

    res.json({
      invoice: {
        idempotencyId: invoice.idempotencyId,
        status: invoice.status,
        expectedAmount: invoice.expectedAmount,
        baseAmount: invoice.baseAmount ?? invoice.expectedAmount,
        verificationCode: invoice.verificationCode ?? null,
        metadata: invoice.metadata ?? null,
        expiresAt: invoice.expiresAt,
      },
      payment: buildPaymentInstructions(configIndex, invoice),
    });
  });

  app.get("/api/invoices/:id", async (req, res) => {
    const idempotencyId = req.params.id;
    const invoice = await store.read((state) => state.invoices[idempotencyId]);
    if (!invoice) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      idempotencyId: invoice.idempotencyId,
      status: invoice.status,
      expectedAmount: invoice.expectedAmount,
      baseAmount: invoice.baseAmount ?? invoice.expectedAmount,
      verificationCode: invoice.verificationCode ?? null,
      metadata: invoice.metadata ?? null,
      expiresAt: invoice.expiresAt,
      paymentRef: invoice.payment?.ref ?? null,
      paidAt: invoice.paidAt ?? null,
    });
  });

  app.get("/admin/deposits", requireAdmin(configIndex), async (req, res) => {
    const match = req.query.match;
    const chainId = typeof req.query.chainId === "string" ? req.query.chainId : undefined;
    const tokenId = typeof req.query.tokenId === "string" ? req.query.tokenId : undefined;

    const entries = await store.read((state) => {
      let values = Object.values(state.paymentsIndex);
      if (match === "unmatched") {
        values = values.filter((entry) => !entry.idempotencyId);
      }
      if (chainId) {
        values = values.filter((entry) => entry.chainId === chainId);
      }
      if (tokenId) {
        values = values.filter((entry) => entry.tokenId === tokenId);
      }
      return values;
    });

    res.json({ deposits: entries });
  });

  registerFulfillmentRoutes(app, registry);

  return app;
}
