import crypto from "crypto";

const FULFILLMENT_SECRET_ENV = "MIUPAY_FULFILLMENT_SECRET";

export function getFulfillmentSecret(): Buffer {
  const raw = process.env[FULFILLMENT_SECRET_ENV];
  if (!raw) {
    throw new Error(`${FULFILLMENT_SECRET_ENV} is required when fulfillments are enabled`);
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new Error(`${FULFILLMENT_SECRET_ENV} must be 32 bytes (base64-encoded)`);
  }
  return decoded;
}

export function deriveModuleSecret(secret: Buffer, moduleId: string): Buffer {
  return crypto.createHmac("sha256", secret).update(`fulfillment:${moduleId}`).digest();
}
