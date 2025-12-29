# Developer Guide

This guide covers setup, configuration, API, and webhook payloads.

Products are defined in `config.json`, and all runtime state is persisted to `state.json`.

## Quick Start

1. Edit `config.json` with your RPC URLs, receive address, products, and admin token.
2. Run:

```bash
npm install && npm run build && node dist/index.js
```

The server listens on the configured port (default `3000`). For development, run `npm run dev`.

## Minimal config

Create a `config.json` like this (single-chain example):

```json
{
  "server": { "port": 3000 },
  "invoice": { "ttlMinutes": 30, "verificationDigits": 3 },
  "scan": { "intervalMs": 10000, "evmMaxBlockRange": 10, "solanaSignatureBatchSize": 100 },
  "chains": [
    {
      "id": "eth-sepolia",
      "type": "evm",
      "rpcUrl": "https://<rpc-url>",
      "receiveAddress": "0x<recipient-address>",
      "finality": { "confirmations": 2, "bufferBlocks": 1 },
      "tokens": [
        {
          "id": "usdc",
          "symbol": "USDC",
          "decimals": 6,
          "contractAddress": "0x<token-contract>"
        }
      ]
    }
  ],
  "products": [
    {
      "id": "coffee",
      "name": "Coffee",
      "amount": "100000",
      "chainId": "eth-sepolia",
      "tokenId": "usdc",
      "active": true
    }
  ],
  "webhooks": { "endpoints": [] },
  "admin": { "bearerToken": "change-me" }
}
```

Amounts are base-unit integers. For Solana, use `type: "solana"`, set `receiveOwner`, and provide `tokens[].mint` plus a `finality` object (e.g., `{ "commitment": "finalized" }`).

## Config Overview

- `chains`: chain definitions (EVM or Solana) + tokens on each chain.
- `products`: static catalog, one product per `(chainId, tokenId, amount)`.
- `webhooks`: one or more endpoints (fulfillment modules or downstream systems) that receive `invoice.paid` and `invoice.expired` events.
- `invoice.ttlMinutes`: invoice expiration window.
- `invoice.verificationDigits`: number of tail digits used as per-invoice verification code.
- `scan`: polling interval and batch sizes.
- `admin.bearerToken`: protects `/admin/*` endpoints.

## State

`state.json` stores:

- `checkpoints`: scan cursors per `(chainId, tokenId)`
- `invoices`: invoice lifecycle data
- `paymentsIndex`: de-dup + unmatched deposits
- `webhookQueue`: pending webhook deliveries
- `webhookDeadLetter`: failed webhooks after retry

State is written atomically using `state.json.tmp` then `rename()`.

## API

- `GET /api/products`
- `POST /api/invoices` `{ "productId": "...", "metadata": { "assetId": "...", "buyerRef": "..." } }`
- `GET /api/invoices/:id` (id is `idempotencyId`)
- `GET /admin/deposits?match=unmatched&chainId=&tokenId=` (Bearer token)
- Webhook events: `invoice.paid` and `invoice.expired` are delivered to configured endpoints.

### Curl examples

Create an invoice:

```bash
curl -X POST http://localhost:3000/api/invoices \
  -H 'Content-Type: application/json' \
  -d '{"productId":"coffee","metadata":{"assetId":"img_123","buyerRef":"user_42"}}'
```

Check an invoice:

```bash
curl http://localhost:3000/api/invoices/<idempotency-id>
```

List products:

```bash
curl http://localhost:3000/api/products
```

List deposits (admin):

```bash
curl http://localhost:3000/admin/deposits?match=unmatched \
  -H 'Authorization: Bearer <admin-token>'
```

## Media fulfillment integration (webhook)

To connect miupay with `media-fulfillment` (or any compatible fulfillment service). You can list multiple modules here and swap them by updating the endpoint list.

1. Run `media-fulfillment` with a webhook secret:

```bash
cd fulfillments/media
WEBHOOK_SECRET=change-me \
TOKEN_SECRET=change-me \
MEDIA_ROOT=./media \
PUBLIC_BASE_URL=http://localhost:4001 \
npm run dev
```

2. Point miupay webhooks to the fulfillment service (add more endpoints for other modules):

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

3. Create invoices with `metadata.assetId` (required) and `metadata.buyerRef` (optional):

```bash
curl -X POST http://localhost:3000/api/invoices \
  -H 'Content-Type: application/json' \
  -d '{"productId":"coffee","metadata":{"assetId":"test-asset","buyerRef":"user-1"}}'
```

4. After the invoice is paid, your frontend can fetch the access URL from the
   fulfillment service (POST body avoids logging idempotencyId in URLs):

```bash
curl -X POST http://localhost:4001/access \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyId":"<idempotency-id>"}'
```

### Webhook payloads

Webhook requests are POSTed with `content-type: application/json` and an `x-signature` header (HMAC SHA-256 of the raw payload using the endpoint secret).

Example `invoice.paid`:

```json
{
  "event": "invoice.paid",
  "data": {
    "idempotencyId": "a8c0e8c7-3a1c-4a9f-9c23-6bbd9e2c2d5f",
    "productId": "coffee",
    "chainId": "eth-sepolia",
    "tokenId": "usdc",
    "expectedAmount": "100001",
    "baseAmount": "100000",
    "verificationCode": "001",
    "metadata": {
      "assetId": "img_123",
      "buyerRef": "user_42"
    },
    "status": "PAID",
    "createdAt": 1730000000000,
    "expiresAt": 1730001800000,
    "payment": {
      "ref": "evm:0xabc123...:0",
      "txHashOrSig": "0xabc123...",
      "amount": "100001",
      "blockRef": 12345678
    },
    "paidAt": 1730000005000
  }
}
```

Example `invoice.expired`:

```json
{
  "event": "invoice.expired",
  "data": {
    "idempotencyId": "a8c0e8c7-3a1c-4a9f-9c23-6bbd9e2c2d5f",
    "productId": "coffee",
    "chainId": "eth-sepolia",
    "tokenId": "usdc",
    "expectedAmount": "100001",
    "baseAmount": "100000",
    "verificationCode": "001",
    "metadata": {
      "assetId": "img_123",
      "buyerRef": "user_42"
    },
    "status": "EXPIRED",
    "createdAt": 1730000000000,
    "expiresAt": 1730001800000,
    "payment": null,
    "paidAt": null
  }
}
```

## Notes

- The service enforces only one active pending invoice per `(chainId, tokenId, expectedAmount)`.
- If `invoice.verificationDigits > 0`, the service allows multiple pending invoices by generating a per-invoice tail-digit verification code. Product amounts should be multiples of `10^verificationDigits` base units and at least `10 * 10^verificationDigits`.
- EVM scanning uses `eth_getLogs` with `Transfer` topics filtered by recipient.
- Solana scanning uses `getSignaturesForAddress` + `getTransaction`.
