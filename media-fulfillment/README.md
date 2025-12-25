# media-fulfillment (template)

Minimal fulfillment service for media unlocks. It exposes:

- HTTP `/webhooks/miupay` for miupay webhook ingestion with strict schema validation.
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
- `STORE_PATH`: JSON file path for entitlements (default: `./store.json`).
- `WEBHOOK_RATE_LIMIT_MAX`: max webhook requests per window (default: `60`).
- `WEBHOOK_RATE_LIMIT_WINDOW_MS`: webhook rate limit window in ms (default: `60000`).
- `MEDIA_RATE_LIMIT_MAX`: max media requests per window (default: `120`).
- `MEDIA_RATE_LIMIT_WINDOW_MS`: media rate limit window in ms (default: `60000`).

## Hook up miupay

Add a webhook endpoint in `config.json` (you can list multiple modules here):

```json
{
  "webhooks": {
    "endpoints": [
      {
        "id": "media-fulfillment",
        "url": "http://localhost:4001/webhooks/miupay",
        "secret": "change-me",
        "events": ["invoice.paid"]
      }
    ]
  }
}
```

Create invoices with `metadata.assetId`:

```bash
curl -X POST http://localhost:3000/api/invoices \
  -H 'Content-Type: application/json' \
  -d '{"productId":"coffee","metadata":{"assetId":"test-asset","buyerRef":"user-1"}}'
```

## Webhook payload expectations

The webhook expects `invoice.paid` events with:

- `data.idempotencyId`
- `data.metadata.assetId`
- `data.metadata.buyerRef` (optional)

## Access URL

On `invoice.paid`, the service returns:

- `access_url`: `PUBLIC_BASE_URL/media/:assetId?token=...`

The media endpoint validates the token and serves files from `MEDIA_ROOT`.

## Get access URL (async)

If the buyer polls after payment, request the access URL using a POST body
to avoid putting `idempotencyId` in the URL:

```bash
curl -X POST http://localhost:4001/access \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyId":"<idempotency-id>"}'
```
