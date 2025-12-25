export type InvoiceStatus = "PENDING" | "PAID" | "EXPIRED";

export type WebhookEvent = "invoice.paid" | "invoice.expired";

export type ProductConfig = {
  id: string;
  name: string;
  amount: string;
  chainId: string;
  tokenId: string;
  active: boolean;
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
  admin: {
    bearerToken: string;
  };
};

export type InvoicePayment = {
  ref: string;
  txHashOrSig: string;
  amount: string;
  blockRef?: number;
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
  idempotencyId?: string;
};

export type Checkpoint =
  | {
      type: "evm";
      lastScannedBlock: number;
    }
  | {
      type: "solana";
      lastSeenSignature: string | null;
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

export type State = {
  checkpoints: Record<string, Checkpoint>;
  invoices: Record<string, Invoice>;
  paymentsIndex: Record<string, PaymentIndexEntry>;
  webhookQueue: WebhookQueueItem[];
  webhookDeadLetter: WebhookQueueItem[];
};
