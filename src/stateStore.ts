import fs from "fs/promises";
import path from "path";
import type { State } from "./types.js";

const emptyState: State = {
  checkpoints: {},
  invoices: {},
  paymentsIndex: {},
  webhookQueue: [],
  webhookDeadLetter: [],
  fulfillmentQueue: [],
  fulfillmentDeadLetter: [],
  fulfillments: {},
};

async function loadStateFile(statePath: string): Promise<State> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as State;
    return {
      ...emptyState,
      ...parsed,
      checkpoints: parsed.checkpoints ?? {},
      invoices: parsed.invoices ?? {},
      paymentsIndex: parsed.paymentsIndex ?? {},
      webhookQueue: parsed.webhookQueue ?? [],
      webhookDeadLetter: parsed.webhookDeadLetter ?? [],
      fulfillmentQueue: parsed.fulfillmentQueue ?? [],
      fulfillmentDeadLetter: parsed.fulfillmentDeadLetter ?? [],
      fulfillments: parsed.fulfillments ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(emptyState);
    }
    throw error;
  }
}

async function atomicWrite(statePath: string, state: State) {
  const dir = path.dirname(statePath);
  const tmpPath = path.join(dir, `${path.basename(statePath)}.tmp`);
  const payload = JSON.stringify(state, null, 2);
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, statePath);
}

export class StateStore {
  private state: State;
  private statePath: string;
  private queue: Promise<void>;

  constructor(statePath: string, initialState: State) {
    this.statePath = statePath;
    this.state = initialState;
    this.queue = Promise.resolve();
  }

  async withLock<T>(
    fn: (state: State) => Promise<T> | T,
    options?: { persist?: boolean },
  ): Promise<T> {
    let resolveQueue!: () => void;
    const next = new Promise<void>((resolve) => {
      resolveQueue = resolve;
    });

    const current = this.queue;
    this.queue = current.then(() => next);

    await current;
    try {
      const result = await fn(this.state);
      if (options?.persist !== false) {
        await atomicWrite(this.statePath, this.state);
      }
      return result;
    } finally {
      resolveQueue();
    }
  }

  async snapshot(): Promise<State> {
    return this.withLock((state) => structuredClone(state), { persist: false });
  }

  async read<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
    return this.withLock(fn, { persist: false });
  }
}

export async function initStateStore(statePath?: string) {
  const resolvedPath = statePath ?? path.join(process.cwd(), "state.json");
  const initial = await loadStateFile(resolvedPath);
  return new StateStore(resolvedPath, initial);
}
