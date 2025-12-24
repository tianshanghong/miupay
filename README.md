# miupay (µpay)

Self-hosted stablecoin checkout with a minimal monolith TypeScript service. Products are defined in `config.json`, and all runtime state is persisted to `state.json`.

## Quick Start

1. Edit `config.json` with your RPC URLs, receive address, products, and admin token.
2. Install dependencies and run:

```bash
npm install
npm run dev
```

The server listens on the configured port (default `3000`).

## Config Overview

- `chains`: chain definitions (EVM or Solana) + tokens on each chain.
- `products`: static catalog, one product per `(chainId, tokenId, amount)`.
- `webhooks`: endpoints that receive `invoice.paid` and `invoice.expired` events.
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
- `POST /api/invoices` `{ "productId": "..." }`
- `GET /api/invoices/:id`
- `GET /admin/deposits?match=unmatched&chainId=&tokenId=` (Bearer token)

## Notes

- The service enforces only one active pending invoice per `(chainId, tokenId, expectedAmount)`.
- If `invoice.verificationDigits > 0`, the service allows multiple pending invoices by generating a per-invoice tail-digit verification code. Product amounts should be multiples of `10^verificationDigits` base units and at least `10 * 10^verificationDigits`.
- EVM scanning uses `eth_getLogs` with `Transfer` topics filtered by recipient.
- Solana scanning uses `getSignaturesForAddress` + `getTransaction`.
