import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";

function isStandalone() {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia("(display-mode: standalone)").matches;
  const ios = "standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone);
  return media || ios;
}

export function PwaSplash() {
  const [phase, setPhase] = useState<"off" | "in" | "out">("off");

  useEffect(() => {
    if (!isStandalone()) return;
    try {
      if (window.sessionStorage.getItem("fos-splash") === "1") return;
    } catch {
      /* ignore */
    }
    setPhase("in");
    const hide = window.setTimeout(() => setPhase("out"), 1100);
    const done = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem("fos-splash", "1");
      } catch {
        /* ignore */
      }
      setPhase("off");
    }, 1380);
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(done);
    };
  }, []);

  if (phase === "off") return null;

  return (
    <div
      className={phase === "out" ? "fos-splash fos-splash-out" : "fos-splash"}
      aria-hidden="true"
    >
      <BrandLoader label="Your ledger" />
    </div>
  );
}
