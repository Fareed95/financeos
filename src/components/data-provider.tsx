import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { getBootstrap } from "@/lib/server/bootstrap";
import { endOfMonthISO, isUnauthorized, startOfMonthISO, todayISO } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import type { Bootstrap } from "@/lib/types";
import { enqueueTxn, readQueue, removeQueued } from "@/lib/offline-queue";
import { upsertTransaction, type TxnInput } from "@/lib/server/transactions";
import { toast } from "sonner";

const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export function AppQueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const DataCtx = createContext<{
  data: Bootstrap | undefined;
  isPending: boolean;
  error: string | null;
  from: string;
  to: string;
  today: string;
  currency: string;
  refresh: () => Promise<void>;
  saveTxn: (input: TxnInput) => Promise<void>;
} | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const today = todayISO();
  const from = startOfMonthISO();
  const to = endOfMonthISO();

  const query = useQuery({
    queryKey: ["bootstrap", from, to, user?.id],
    enabled: Boolean(user),
    queryFn: async () =>
      getBootstrap({
        data: { from, to, displayName: user?.displayName ?? user?.primaryEmail ?? null },
      }),
  });

  const refresh = useCallback(async () => {
    await qc.invalidateQueries();
  }, [qc]);

  const saveTxn = useCallback(
    async (input: TxnInput) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        enqueueTxn(input);
        toast.message("Saved offline. It will sync when you're back.");
        return;
      }
      try {
        await upsertTransaction({ data: input });
        await refresh();
      } catch (err) {
        if (!navigator.onLine) {
          enqueueTxn(input);
          toast.message("Saved offline. It will sync when you're back.");
          return;
        }
        throw err;
      }
    },
    [refresh],
  );

  const value = useMemo(
    () => ({
      data: query.data,
      isPending: query.isPending,
      error: query.error
        ? isUnauthorized(query.error)
          ? "Unauthorized"
          : query.error instanceof Error
            ? query.error.message
            : "Couldn't load your finances"
        : null,
      from,
      to,
      today,
      currency: query.data?.profile.currency ?? "INR",
      refresh,
      saveTxn,
    }),
    [query.data, query.isPending, query.error, from, to, today, refresh, saveTxn],
  );

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useAppData() {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error("useAppData requires DataProvider");
  return ctx;
}

export async function flushOfflineQueue() {
  const items = readQueue();
  for (const item of items) {
    try {
      await upsertTransaction({ data: item.payload });
      removeQueued(item.localId);
    } catch {
      break;
    }
  }
}
