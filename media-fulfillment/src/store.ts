import fs from "fs";
import path from "path";

export type Entitlement = {
  id: string;
  idempotencyId: string;
  assetId: string;
  buyerRef: string;
  createdAt: number;
};

export type Store = {
  entitlements: Record<string, Entitlement>;
  idempotencyIndex: Record<string, string>;
};

const STORE_PATH = process.env.STORE_PATH ?? "./store.json";

export function loadStore(): Store {
  if (!fs.existsSync(STORE_PATH)) {
    return { entitlements: {}, idempotencyIndex: {} };
  }
  const raw = fs.readFileSync(STORE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Store;
  return {
    entitlements: parsed.entitlements ?? {},
    idempotencyIndex: parsed.idempotencyIndex ?? {},
  };
}

export function saveStore(store: Store) {
  const dir = path.dirname(STORE_PATH);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, STORE_PATH);
}
