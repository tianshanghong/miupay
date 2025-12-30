# miupay (µpay)

Miu Pay is a lightweight, self-custody payment tool focused on micropayments. A self-hosted checkout for stablecoins that keeps privacy and control in your hands.

## Why "Miu"?

"Miu" is a nod to the micro prefix (µ). µ means micro, signaling a focus on micropayments.

## Highlights

- Open source with no vendor lock-in.
- No KYC; privacy-first by design.
- Fully self-custody: only one recipient address is needed.
- Webhook support: an out-of-the-box working payment gateway.
- Multi-chain support: Ethereum, Solana, and other EVM chains.
- Minimal runtime: minimal state, no database required.
- In-process fulfillments (e.g., media delivery) with a single deploy.

## Fulfillments

Miupay ships with optional, in-process fulfillment modules. Enable them in `config.json` under `fulfillments`, and routes are exposed under `/fulfillments/<id>/*` on the same server. External webhooks remain supported for third-party integrations.

If you enable fulfillments, set `MIUPAY_FULFILLMENT_SECRET` (base64-encoded 32-byte secret) for module token signing.

## Get started

```bash
npm install && npm run build && node dist/index.js
```

## Run locally (with env)

`config.json` must be valid JSON in the project root (use `config.sample.jsonc` as a reference and remove comments).

```bash
export MIUPAY_FULFILLMENT_SECRET="$(openssl rand -base64 32)"
npm install
npm run build
node dist/index.js
```

`MIUPAY_FULFILLMENT_SECRET` is required when any fulfillment module is enabled (e.g., `fulfillments.media.enabled: true`).

Developer guide: `docs/DEVELOPERS.md`.

## Docker image

```bash
docker build -t miupay:latest .
```
