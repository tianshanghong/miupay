# media-fulfillment (template)

Minimal fulfillment service for media unlocks. It exposes:

- gRPC `FulfillmentService` for typed module integration.
- HTTP `/webhooks/miupay` for current miupay webhook ingestion.
- HTTP `/media/:assetId?token=...` for controlled media access.

## Quick start

```bash
cd media-fulfillment
npm install
WEBHOOK_SECRET=change-me \
TOKEN_SECRET=change-me \
MEDIA_ROOT=./media \
PUBLIC_BASE_URL=http://localhost:4001 \
npm run dev
```

## Configuration

- `WEBHOOK_SECRET`: HMAC secret for miupay webhook verification (required).
- `TOKEN_SECRET`: HMAC secret for access token signing (required).
- `MEDIA_ROOT`: local directory holding media files (default: `./media`).
- `PUBLIC_BASE_URL`: used to build access URLs (default: `http://localhost:4001`).
- `PORT`: HTTP port (default: `4001`).
- `GRPC_HOST`: gRPC bind host (default: `0.0.0.0`).
- `GRPC_PORT`: gRPC port (default: `50051`).
- `STORE_PATH`: JSON file path for entitlements (default: `./store.json`).

## Webhook payload expectations

The webhook expects `invoice.paid` events with:

- `data.idempotencyId`
- `data.metadata.assetId`
- `data.metadata.buyerRef` (optional)

## gRPC

Proto: `proto/fulfillment/v1/fulfillment.proto`

The gRPC server listens on `GRPC_HOST:GRPC_PORT` and implements `FulfillmentService.Fulfill`.

## Access URL

On `invoice.paid`, the service returns:

- `access_url`: `PUBLIC_BASE_URL/media/:assetId?token=...`

The media endpoint validates the token and serves files from `MEDIA_ROOT`.
