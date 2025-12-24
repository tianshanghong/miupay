import { randomUUID } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export type SolanaSignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime?: number;
};

export type SolanaTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmountString?: string;
  };
};

export type SolanaTransaction = {
  slot: number;
  meta: {
    err: unknown;
    preTokenBalances?: SolanaTokenBalance[];
    postTokenBalances?: SolanaTokenBalance[];
  } | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string }> | string[];
    };
  };
};

type RpcResponse<T> = {
  result: T;
  error?: { message: string };
};

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const body = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method,
    params,
  };
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`rpc ${method} failed with status ${response.status}`);
  }
  const json = (await response.json()) as RpcResponse<T>;
  if (json.error) {
    throw new Error(`rpc ${method} error: ${json.error.message}`);
  }
  return json.result;
}

export function deriveAta(owner: string, mint: string): string {
  const ownerKey = new PublicKey(owner);
  const mintKey = new PublicKey(mint);
  const ata = getAssociatedTokenAddressSync(mintKey, ownerKey, false);
  return ata.toBase58();
}

export async function getSignaturesForAddress(
  rpcUrl: string,
  address: string,
  options: { limit: number; before?: string; commitment?: "finalized" },
): Promise<SolanaSignatureInfo[]> {
  const params = [address, { limit: options.limit, before: options.before, commitment: options.commitment }];
  return rpcCall<SolanaSignatureInfo[]>(rpcUrl, "getSignaturesForAddress", params);
}

export async function getTransaction(
  rpcUrl: string,
  signature: string,
  commitment: "finalized" = "finalized",
): Promise<SolanaTransaction | null> {
  const params = [signature, { encoding: "jsonParsed", commitment }];
  return rpcCall<SolanaTransaction | null>(rpcUrl, "getTransaction", params);
}

export async function getSignatureStatuses(
  rpcUrl: string,
  signatures: string[],
): Promise<{ value: Array<{ confirmationStatus?: string } | null> }>
{
  const params = [signatures, { searchTransactionHistory: true }];
  return rpcCall<{ value: Array<{ confirmationStatus?: string } | null> }>(
    rpcUrl,
    "getSignatureStatuses",
    params,
  );
}
