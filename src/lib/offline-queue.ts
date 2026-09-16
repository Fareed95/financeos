import type { TxnInput } from "@/lib/server/transactions";

const KEY = "financeos.unsent";

export type QueuedTxn = { localId: string; payload: TxnInput; createdAt: number };

export function readQueue(): QueuedTxn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedTxn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeQueue(items: QueuedTxn[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function enqueueTxn(payload: TxnInput): QueuedTxn {
  const item: QueuedTxn = {
    localId: crypto.randomUUID(),
    payload,
    createdAt: Date.now(),
  };
  writeQueue([...readQueue(), item]);
  return item;
}

export function removeQueued(localId: string) {
  writeQueue(readQueue().filter((i) => i.localId !== localId));
}
