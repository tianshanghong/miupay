import crypto from "crypto";
import { config } from "./config.js";
import { loadStore, saveStore, type Entitlement } from "./store.js";
import { signToken } from "./tokens.js";

export const STATUS_COMPLETED = 0;
export const STATUS_RETRYABLE = 1;
export const STATUS_FAILED = 2;

export type FulfillResult = {
  status: number;
  entitlement_id?: string;
  access_token?: string;
  access_url?: string;
  error?: string;
};

export function fulfillMediaUnlock(params: {
  idempotencyId: string;
  assetId: string;
  buyerRef: string;
}): FulfillResult {
  if (!params.idempotencyId || !params.assetId) {
    return { status: STATUS_FAILED, error: "missing_id_or_asset" };
  }

  const store = loadStore();
  let entitlement: Entitlement | undefined;

  const existingId = store.idempotencyIndex[params.idempotencyId];
  if (existingId) {
    entitlement = store.entitlements[existingId];
    if (entitlement && entitlement.assetId !== params.assetId) {
      return { status: STATUS_FAILED, error: "idempotency_asset_mismatch" };
    }
  }

  if (!entitlement) {
    const entitlementId = crypto.randomUUID();
    entitlement = {
      id: entitlementId,
      idempotencyId: params.idempotencyId,
      assetId: params.assetId,
      buyerRef: params.buyerRef,
      createdAt: Date.now(),
    };
    store.entitlements[entitlementId] = entitlement;
    store.idempotencyIndex[params.idempotencyId] = entitlementId;
    saveStore(store);
  }

  const accessToken = signToken({
    entitlementId: entitlement.id,
    assetId: entitlement.assetId,
    exp: Date.now() + config.tokenTtlMs,
  });
  const accessUrl = `${config.publicBaseUrl}/media/${entitlement.assetId}?token=${accessToken}`;

  return {
    status: STATUS_COMPLETED,
    entitlement_id: entitlement.id,
    access_token: accessToken,
    access_url: accessUrl,
  };
}
