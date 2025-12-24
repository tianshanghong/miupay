import { randomUUID } from "crypto";

export type EvmLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
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
    const details = await response.text();
    throw new Error(`rpc ${method} failed with status ${response.status}: ${details}`);
  }
  const json = (await response.json()) as RpcResponse<T>;
  if (json.error) {
    throw new Error(`rpc ${method} error: ${json.error.message}`);
  }
  return json.result;
}

export async function getBlockNumber(rpcUrl: string): Promise<number> {
  const hex = await rpcCall<string>(rpcUrl, "eth_blockNumber", []);
  return Number.parseInt(hex, 16);
}

export async function getLogs(
  rpcUrl: string,
  filter: {
    address: string;
    fromBlock: number;
    toBlock: number;
    topics?: (string | null)[];
  },
): Promise<EvmLog[]> {
  const params = [
    {
      address: filter.address,
      fromBlock: `0x${filter.fromBlock.toString(16)}`,
      toBlock: `0x${filter.toBlock.toString(16)}`,
      topics: filter.topics,
    },
  ];
  return rpcCall<EvmLog[]>(rpcUrl, "eth_getLogs", params);
}

export function hexToBigInt(value: string): bigint {
  if (value === "0x" || value === "0x0") {
    return 0n;
  }
  return BigInt(value);
}

export function hexToNumber(value: string): number {
  return Number.parseInt(value, 16);
}

export function padAddressTopic(address: string): string {
  const trimmed = address.toLowerCase().replace(/^0x/, "");
  return `0x${trimmed.padStart(64, "0")}`;
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
