import { useEffect, useState } from "react";
import { flushOfflineQueue } from "@/components/data-provider";
import { readQueue } from "@/lib/offline-queue";
import { toast } from "sonner";

export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      setQueued(readQueue().length);
    };
    sync();
    const onOnline = () => {
      sync();
      void flushOfflineQueue()
        .then(() => {
          sync();
          if (readQueue().length === 0) toast.success("Offline drafts synced");
        })
        .catch(() => undefined);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (online && queued === 0) return null;
  return (
    <div className="bg-secondary px-4 py-2 text-center text-xs text-muted-foreground">
      {online
        ? `${queued} draft${queued === 1 ? "" : "s"} waiting to sync`
        : "You're offline. Drafts will sync when you're back."}
    </div>
  );
}
