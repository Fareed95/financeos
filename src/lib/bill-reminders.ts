export type CutReminder = {
  id: string;
  title: string;
  body: string;
};

const STORAGE = "kharcha-cut-reminders";

function supported() {
  return typeof window !== "undefined" && "Notification" in window;
}

function readSeen(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

async function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/bill-reminders-sw.js");
  } catch {
    return null;
  }
}

/** Ask once, from a tap. Granted means the phone can be reminded on the cut day. */
export async function allowCutReminders(): Promise<"granted" | "denied" | "default" | "unsupported"> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "granted") {
    await worker();
    return "granted";
  }
  if (Notification.permission === "denied") return "denied";
  const result = await Notification.requestPermission();
  if (result === "granted") await worker();
  return result;
}

/** One phone reminder per bill per day, only after the cut date and until they answer. */
export async function notifyCutReminders(items: CutReminder[], today: string) {
  if (!supported() || Notification.permission !== "granted" || items.length === 0) return;
  const seen = readSeen();
  const pending = items.filter((item) => seen[item.id] !== today);
  if (pending.length === 0) return;
  const reg = await worker();
  for (const item of pending) {
    const tag = `kharcha-cut-${item.id}-${today}`;
    if (reg) {
      await reg.showNotification(item.title, {
        body: item.body,
        tag,
        icon: "/icon-192.png",
        data: { url: "/" },
      });
    } else {
      const note = new Notification(item.title, { body: item.body, tag, icon: "/icon-192.png" });
      note.onclick = () => {
        window.focus();
        window.location.assign("/");
      };
    }
    seen[item.id] = today;
  }
  const fresh: Record<string, string> = {};
  for (const [id, day] of Object.entries(seen)) {
    if (day === today) fresh[id] = day;
  }
  localStorage.setItem(STORAGE, JSON.stringify(fresh));
}
