import type { MediaEntitlement, MediaFulfillmentState, State } from "../../types.js";

export function ensureMediaState(state: State): MediaFulfillmentState {
  if (!state.fulfillments.media) {
    state.fulfillments.media = {
      entitlements: {},
      idempotencyIndex: {},
    };
  }
  return state.fulfillments.media;
}

export function getMediaEntitlement(
  state: State,
  idempotencyId: string,
): MediaEntitlement | undefined {
  const mediaState = state.fulfillments.media;
  if (!mediaState) {
    return undefined;
  }
  const entitlementId = mediaState.idempotencyIndex[idempotencyId];
  if (!entitlementId) {
    return undefined;
  }
  return mediaState.entitlements[entitlementId];
}
