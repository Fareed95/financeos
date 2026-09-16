import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallPlatform = "ios" | "android" | "desktop";

type InstallCtx = {
  installed: boolean;
  canNativeInstall: boolean;
  platform: InstallPlatform;
  install: () => Promise<"accepted" | "dismissed" | "guide">;
};

const Ctx = createContext<InstallCtx | null>(null);

function detectPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  const touch = navigator.maxTouchPoints || 0;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touch > 1);
  if (ios) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia("(display-mode: standalone)").matches;
  const ios = "standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone);
  return media || ios;
}

export function InstallProvider({ children }: { children: ReactNode }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("desktop");

  useEffect(() => {
    setInstalled(isStandalone());
    setPlatform(detectPlatform());

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const value = useMemo<InstallCtx>(
    () => ({
      installed,
      canNativeInstall: Boolean(promptEvent),
      platform,
      install: async () => {
        if (promptEvent) {
          await promptEvent.prompt();
          const { outcome } = await promptEvent.userChoice;
          if (outcome === "accepted") {
            setInstalled(true);
            setPromptEvent(null);
          }
          return outcome;
        }
        return "guide";
      },
    }),
    [installed, promptEvent, platform],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInstallApp() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      installed: false,
      canNativeInstall: false,
      platform: "desktop" as const,
      install: async () => "guide" as const,
    };
  }
  return ctx;
}

export function openInstallGuide() {
  window.location.href = "/?install=1";
}
