import { randomUUID } from "crypto";
import { PublicKey } from "@solana/web3.js";

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

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
  blockTime?: number | null;
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

export function deriveAta(owner: string, mint: string, tokenProgramId: string): string {
  const ownerKey = new PublicKey(owner);
  const mintKey = new PublicKey(mint);
  const programKey = new PublicKey(tokenProgramId);
  const [ata] = PublicKey.findProgramAddressSync(
    [ownerKey.toBuffer(), programKey.toBuffer(), mintKey.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata.toBase58();
}

export async function getAccountOwner(rpcUrl: string, address: string): Promise<string> {
  const params = [address, { encoding: "base64" }];
  const result = await rpcCall<{ value: { owner: string } | null }>(
    rpcUrl,
    "getAccountInfo",
    params,
  );
  if (!result.value) {
    throw new Error(`account ${address} not found`);
  }
  return result.value.owner;
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

export async function getSlot(
  rpcUrl: string,
  commitment: "finalized" = "finalized",
): Promise<number> {
  const params = [{ commitment }];
  return rpcCall<number>(rpcUrl, "getSlot", params);
}

export async function getBlockTime(rpcUrl: string, slot: number): Promise<number | null> {
  const params = [slot];
  return rpcCall<number | null>(rpcUrl, "getBlockTime", params);
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
