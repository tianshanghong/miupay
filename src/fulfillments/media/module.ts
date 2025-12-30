import crypto from "crypto";
import type express from "express";
import { z } from "zod";
import type {
  MediaFulfillmentConfig,
  MediaEntitlement,
  FulfillmentEventType,
  Invoice,
} from "../../types.js";
import type { StateStore } from "../../stateStore.js";
import type { FulfillmentContext, FulfillmentModule } from "../registry.js";
import { ensureMediaState, getMediaEntitlement } from "./state.js";
import { signToken, verifyToken } from "./tokens.js";
import { resolveMediaAssetPath } from "./assets.js";

const metadataSchema = z
  .object({
    assetId: z.string().min(1),
    buyerRef: z.string().min(1).optional(),
  })
  .passthrough();

const accessSchema = z
  .object({
    idempotencyId: z.string().min(1),
  })
  .strict();

type MediaModuleOptions = {
  config: MediaFulfillmentConfig;
  store: StateStore;
  secret: Buffer;
  defaultBaseUrl: string;
};

function createRateLimiter(windowMs: number, max: number) {
  const entries = new Map<string, { count: number; resetAt: number }>();
  return function rateLimit(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    entry.count += 1;
    next();
  };
}

function resolveConfig(options: MediaModuleOptions) {
  const baseUrl = options.config.publicBaseUrl ?? options.defaultBaseUrl;
  if (!baseUrl) {
    throw new Error("media.publicBaseUrl is required");
  }
  const tokenTtlMs = options.config.tokenTtlMs ?? 900_000;
  const rateLimitMax = options.config.rateLimitMax ?? 120;
  const rateLimitWindowMs = options.config.rateLimitWindowMs ?? 60_000;
  return {
    mediaRoot: options.config.mediaRoot ?? "./media",
    publicBaseUrl: baseUrl,
    tokenTtlMs,
    rateLimitMax,
    rateLimitWindowMs,
  };
}

function buildAccessUrl(baseUrl: string, assetId: string, token: string): string {
  return `${baseUrl}/fulfillments/media/assets/${assetId}?token=${token}`;
}

async function ensureEntitlement(
  store: StateStore,
  params: { idempotencyId: string; assetId: string; buyerRef: string },
): Promise<MediaEntitlement> {
  return store.withLock((state) => {
    const mediaState = ensureMediaState(state);
    const existingId = mediaState.idempotencyIndex[params.idempotencyId];
    if (existingId) {
      const existing = mediaState.entitlements[existingId];
      if (existing && existing.assetId !== params.assetId) {
        throw new Error("idempotency_asset_mismatch");
      }
      if (existing) {
        return existing;
      }
    }
    const entitlementId = crypto.randomUUID();
    const entitlement: MediaEntitlement = {
      id: entitlementId,
      idempotencyId: params.idempotencyId,
      assetId: params.assetId,
      buyerRef: params.buyerRef,
      createdAt: Date.now(),
    };
    mediaState.entitlements[entitlementId] = entitlement;
    mediaState.idempotencyIndex[params.idempotencyId] = entitlementId;
    return entitlement;
  });
}

function parseMetadata(invoice: Invoice) {
  const parsed = metadataSchema.safeParse(invoice.metadata ?? null);
  if (!parsed.success) {
    throw new Error("invalid_metadata");
  }
  return {
    assetId: parsed.data.assetId,
    buyerRef: parsed.data.buyerRef ?? "anonymous",
  };
}

export function buildMediaModule(options: MediaModuleOptions): FulfillmentModule {
  const resolved = resolveConfig(options);
  const limiter = createRateLimiter(resolved.rateLimitWindowMs, resolved.rateLimitMax);

  return {
    id: "media",
    events: ["invoice.paid"],
    routes: (router) => {
      router.post("/access", limiter, async (req, res) => {
        const parsed = accessSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "invalid_request" });
          return;
        }
        const entitlement = await options.store.read((state) =>
          getMediaEntitlement(state, parsed.data.idempotencyId),
        );
        if (!entitlement) {
          res.status(404).json({ error: "entitlement_not_found" });
          return;
        }
        const accessToken = signToken(options.secret, {
          entitlementId: entitlement.id,
          assetId: entitlement.assetId,
          exp: Date.now() + resolved.tokenTtlMs,
        });
        const accessUrl = buildAccessUrl(resolved.publicBaseUrl, entitlement.assetId, accessToken);
        res.json({ access_token: accessToken, access_url: accessUrl });
      });

      router.get("/assets/:assetId", limiter, async (req, res) => {
        const token = typeof req.query.token === "string" ? req.query.token : "";
        const payload = verifyToken(options.secret, token);
        if (!payload) {
          res.status(401).json({ error: "invalid_token" });
          return;
        }
        if (payload.exp <= Date.now()) {
          res.status(401).json({ error: "token_expired" });
          return;
        }
        if (payload.assetId !== req.params.assetId) {
          res.status(403).json({ error: "asset_mismatch" });
          return;
        }
        const entitlement = await options.store.read((state) => {
          const mediaState = state.fulfillments.media;
          if (!mediaState) {
            return undefined;
          }
          return mediaState.entitlements[payload.entitlementId];
        });
        if (!entitlement || entitlement.assetId !== req.params.assetId) {
          res.status(403).json({ error: "entitlement_not_found" });
          return;
        }

        const filePath = resolveMediaAssetPath(resolved.mediaRoot, req.params.assetId);
        if (!filePath) {
          res.status(400).json({ error: "invalid_asset_path" });
          return;
        }
        res.sendFile(filePath, (err) => {
          if (err) {
            res.status(404).json({ error: "not_found" });
          }
        });
      });
    },
    handleEvent: async (
      event: FulfillmentEventType,
      invoice: Invoice,
      _ctx: FulfillmentContext,
    ) => {
      if (event !== "invoice.paid") {
        return;
      }
      const metadata = parseMetadata(invoice);
      await ensureEntitlement(options.store, {
        idempotencyId: invoice.idempotencyId,
        assetId: metadata.assetId,
        buyerRef: metadata.buyerRef,
      });
    },
  };
}
