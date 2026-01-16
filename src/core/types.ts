export type InvoiceStatus = "PENDING" | "PAID" | "EXPIRED";

export type WebhookEvent = "invoice.paid" | "invoice.expired";
export type FulfillmentEventType = WebhookEvent;
export type FulfillmentEvent = {
  type: FulfillmentEventType;
  invoice: Invoice;
};

export type FulfillmentModuleId = "media" | "telegram";

export type ProductConfig = {
  id: string;
  name: string;
  amount: string;
  chainId: string;
  tokenId: string;
  active: boolean;
  fulfillments?: FulfillmentModuleId[];
};

export type TokenConfig = {
  id: string;
  symbol: string;
  decimals: number;
  contractAddress?: string;
  mint?: string;
};

export type ChainFinalityConfig = {
  confirmations?: number;
  bufferBlocks?: number;
  commitment?: "finalized";
};

export type ChainConfig = {
  id: string;
  type: "evm" | "solana";
  rpcUrl: string;
  receiveAddress?: string;
  receiveOwner?: string;
  finality: ChainFinalityConfig;
  tokens: TokenConfig[];
};

export type WebhookEndpointConfig = {
  id: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
};

export type MediaFulfillmentConfig = {
  enabled: boolean;
  mediaRoot?: string;
  publicBaseUrl?: string;
  tokenTtlMs?: number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
};

export type TelegramFulfillmentConfig = {
  enabled: boolean;
  botToken?: string;
  targetChatId?: string;
};

export type FulfillmentConfig = Record<string, unknown> & {
  media?: MediaFulfillmentConfig;
  telegram?: TelegramFulfillmentConfig;
};

export type AppConfig = {
  server: {
    port: number;
  };
  invoice: {
    ttlMinutes: number;
    verificationDigits: number;
  };
  scan: {
    intervalMs: number;
    evmMaxBlockRange: number;
    solanaSignatureBatchSize: number;
  };
  chains: ChainConfig[];
  products: ProductConfig[];
  webhooks: {
    endpoints: WebhookEndpointConfig[];
  };
  fulfillments?: FulfillmentConfig;
  admin: {
    bearerToken: string;
  };
};

export type InvoicePayment = {
  ref: string;
  txHashOrSig: string;
  amount: string;
  blockRef?: number;
  from?: string;
  to?: string;
  paymentTime?: number;
};

export type Invoice = {
  idempotencyId: string;
  productId: string;
  chainId: string;
  tokenId: string;
  expectedAmount: string;
  baseAmount?: string;
  verificationCode?: string;
  metadata?: Record<string, string>;
  receiveTo?: string;
  status: InvoiceStatus;
  createdAt: number;
  expiresAt: number;
  payment?: InvoicePayment;
  paidAt?: number;
};

export type PaymentIndexEntry = {
  seenAt: number;
  chainId: string;
  tokenId: string;
  ref: string;
  txHashOrSig: string;
  from?: string;
  to: string;
  amount: string;
  blockRef?: number;
  paymentTime?: number;
  idempotencyId?: string;
};

export type Checkpoint =
  | {
      type: "evm";
      lastScannedBlock: number;
      cursorTimeMs?: number;
    }
  | {
      type: "solana";
      lastSeenSignature: string | null;
      cursorTimeMs?: number;
    };

export type WebhookQueueItem = {
  id: string;
  event: WebhookEvent;
  idempotencyId: string;
  endpointId: string;
  attempt: number;
  nextAttemptAt: number;
  createdAt: number;
};

export type FulfillmentQueueItem = {
  id: string;
  moduleId: string;
  event: FulfillmentEventType;
  idempotencyId: string;
  attempt: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError?: string;
};

export type MediaEntitlement = {
  id: string;
  idempotencyId: string;
  assetId: string;
  createdAt: number;
};

export type MediaFulfillmentState = {
  entitlements: Record<string, MediaEntitlement>;
  idempotencyIndex: Record<string, string>;
};

export type FulfillmentsState = Record<string, unknown> & {
  media?: MediaFulfillmentState;
};

export type ChainTimeEntry = {
  chainTimeMs: number;
  updatedAt: number;
};

export type State = {
  chainTime: Record<string, ChainTimeEntry>;
  checkpoints: Record<string, Checkpoint>;
  invoices: Record<string, Invoice>;
  paymentsIndex: Record<string, PaymentIndexEntry>;
  webhookQueue: WebhookQueueItem[];
  webhookDeadLetter: WebhookQueueItem[];
  fulfillmentQueue: FulfillmentQueueItem[];
  fulfillmentDeadLetter: FulfillmentQueueItem[];
  fulfillments: FulfillmentsState;
};
