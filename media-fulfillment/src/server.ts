import crypto from "crypto";
import path from "path";
import express from "express";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { config, validateConfig } from "./config.js";
import { fulfillMediaUnlock, STATUS_COMPLETED, STATUS_FAILED, STATUS_RETRYABLE } from "./fulfillment.js";
import { loadStore } from "./store.js";
import { verifyToken } from "./tokens.js";

const PROTO_PATH = new URL("../proto/fulfillment/v1/fulfillment.proto", import.meta.url).pathname;

type FulfillRequest = {
  idempotency_id?: string;
  media_unlock?: { asset_id?: string; buyer_ref?: string };
};

type FulfillResult = {
  status: number;
  entitlement_id?: string;
  access_token?: string;
  access_url?: string;
  error?: string;
};

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

function handleFulfill(request: FulfillRequest): FulfillResult {
  const idempotencyId = request.idempotency_id ?? "";
  const media = request.media_unlock;
  const assetId = media?.asset_id ?? "";
  const buyerRef = media?.buyer_ref ?? "anonymous";
  return fulfillMediaUnlock({ idempotencyId, assetId, buyerRef });
}

function startGrpcServer() {
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDef) as grpc.GrpcObject;
  const service = (proto.fulfillment as grpc.GrpcObject).v1 as grpc.GrpcObject;
  const fulfillmentService = service.FulfillmentService as grpc.ServiceClientConstructor & {
    service: grpc.ServiceDefinition;
  };

  const server = new grpc.Server();
  server.addService(fulfillmentService.service, {
    Fulfill: (
      call: grpc.ServerUnaryCall<FulfillRequest, FulfillResult>,
      callback: grpc.sendUnaryData<FulfillResult>,
    ) => {
      try {
        const result = handleFulfill(call.request);
        callback(null, result);
      } catch (error) {
        callback({
          code: grpc.status.INTERNAL,
          message: error instanceof Error ? error.message : "internal_error",
        });
      }
    },
  });

  const address = `${config.grpcHost}:${config.grpcPort}`;
  server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) {
      throw err;
    }
    server.start();
    console.log(`gRPC listening on ${address}`);
  });
}

function startHttpServer() {
  const app = express();

  app.post("/webhooks/miupay", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
    const rawBody = req.body.toString("utf8");
    const signature = req.header("x-signature");
    if (!verifyWebhook(rawBody, signature)) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    if (event?.event !== "invoice.paid") {
      res.status(200).json({ ignored: true });
      return;
    }

    const idempotencyId = event?.data?.idempotencyId ?? "";
    const metadata = event?.data?.metadata ?? {};
    const request: FulfillRequest = {
      idempotency_id: idempotencyId,
      media_unlock: {
        asset_id: typeof metadata.assetId === "string" ? metadata.assetId : "",
        buyer_ref: typeof metadata.buyerRef === "string" ? metadata.buyerRef : "anonymous",
      },
    };

    const result = handleFulfill(request);
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

  app.get("/media/:assetId", (req, res) => {
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
startGrpcServer();
startHttpServer();
