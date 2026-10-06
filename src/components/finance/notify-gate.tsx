import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { allowCutReminders, showPhoneNotice } from "@/lib/bill-reminders";
import { listUnseenNotices, markNoticesSeen, savePushSubscription, vapidPublicKey } from "@/lib/server/notices";

const LATER = "kharcha-notify-later";

function keyBytes(value: string) {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribeDevice() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const reg = await navigator.serviceWorker.register("/bill-reminders-sw.js");
  const ready = await navigator.serviceWorker.ready;
  const keys = await vapidPublicKey();
  if (!keys?.publicKey) return;
  const existing = await ready.pushManager.getSubscription();
  const sub =
    existing ??
    (await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(keys.publicKey),
    }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
  await savePushSubscription({ data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth } });
  void reg;
}

export function NotifyGate() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | "unknown">("unknown");
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    setLater(sessionStorage.getItem(LATER) === "1");
  }, []);

  useEffect(() => {
    if (permission === "unknown" || permission === "unsupported") return;
    if (permission === "granted") void subscribeDevice().catch(() => undefined);
    let stop = false;
    async function pull() {
      if (stop || document.visibilityState === "hidden") return;
      const res = await listUnseenNotices().catch(() => null);
      const notices = res?.notices ?? [];
      if (notices.length === 0) return;
      for (const notice of notices) {
        toast(notice.title, { description: notice.body });
        await showPhoneNotice(notice).catch(() => undefined);
      }
      await markNoticesSeen({ data: { ids: notices.map((notice) => notice.id) } }).catch(() => undefined);
    }
    void pull();
    const timer = window.setInterval(() => void pull(), 15000);
    const onShow = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [permission]);

  if (permission !== "default" || later) return null;

  return (
    <section className="mb-4 rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]">
      <p className="text-sm font-medium">Allow notifications</p>
      <p className="mt-1 text-sm text-muted-foreground">
        First thing: so you hear when someone adds a transaction on a shared project.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          className="h-11 flex-1"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void allowCutReminders()
              .then(async (result) => {
                setPermission(result === "unsupported" ? "unsupported" : result);
                if (result === "granted") await subscribeDevice();
              })
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Asking…" : "Allow"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-11"
          onClick={() => {
            sessionStorage.setItem(LATER, "1");
            setLater(true);
          }}
        >
          Not now
        </Button>
      </div>
    </section>
  );
}
