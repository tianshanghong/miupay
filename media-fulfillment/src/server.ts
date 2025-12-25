import crypto from "crypto";
import path from "path";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config, validateConfig } from "./config.js";
import { fulfillMediaUnlock, STATUS_COMPLETED, STATUS_RETRYABLE } from "./fulfillment.js";
import { loadStore } from "./store.js";
import { verifyToken } from "./tokens.js";

const metadataSchema = z
  .object({
    assetId: z.string().min(1),
    buyerRef: z.string().min(1).optional(),
  })
  .passthrough();

const webhookSchema = z
  .object({
    event: z.enum(["invoice.paid", "invoice.expired"]),
    data: z
      .object({
        idempotencyId: z.string().min(1),
        metadata: z.unknown().optional(),
      })
      .passthrough(),
  })
  .strict();

function verifyWebhook(rawBody: string, signature: string | undefined): boolean {
  if (!signature) {
    return false;
  }
  const expected = crypto.createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

function startHttpServer() {
  const app = express();
  const webhookLimiter = rateLimit({
    windowMs: config.webhookRateLimitWindowMs,
    max: config.webhookRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const mediaLimiter = rateLimit({
    windowMs: config.mediaRateLimitWindowMs,
    max: config.mediaRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post("/webhooks/miupay", webhookLimiter, express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
    const rawBody = req.body.toString("utf8");
    const signature = req.header("x-signature");
    if (!verifyWebhook(rawBody, signature)) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    const parsed = webhookSchema.safeParse(event);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    if (parsed.data.event !== "invoice.paid") {
      res.status(200).json({ ignored: true });
      return;
    }

    const metadataResult = metadataSchema.safeParse(parsed.data.data.metadata ?? null);
    if (!metadataResult.success) {
      res.status(422).json({ error: "invalid_metadata" });
      return;
    }

    const result = fulfillMediaUnlock({
      idempotencyId: parsed.data.data.idempotencyId,
      assetId: metadataResult.data.assetId,
      buyerRef: metadataResult.data.buyerRef ?? "anonymous",
    });
    if (result.status === STATUS_COMPLETED) {
      res.status(200).json(result);
      return;
    }
    if (result.status === STATUS_RETRYABLE) {
      res.status(503).json(result);
      return;
    }
    res.status(422).json(result);
  });

  app.get("/media/:assetId", mediaLimiter, (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = verifyToken(token);
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
    const store = loadStore();
    const entitlement = store.entitlements[payload.entitlementId];
    if (!entitlement || entitlement.assetId !== req.params.assetId) {
      res.status(403).json({ error: "entitlement_not_found" });
      return;
    }

    const root = path.resolve(config.mediaRoot);
    const filePath = path.resolve(root, req.params.assetId);
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      res.status(400).json({ error: "invalid_asset_path" });
      return;
    }

    res.sendFile(filePath, (err) => {
      if (err) {
        res.status(404).json({ error: "not_found" });
      }
    });
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.listen(config.port, () => {
    console.log(`HTTP listening on ${config.port}`);
  });
}

validateConfig();
startHttpServer();
