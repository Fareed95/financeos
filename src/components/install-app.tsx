import { useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { openInstallGuide, useInstallApp } from "@/hooks/use-install-app";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function InstallAppCard({
  className,
  dismissible = false,
}: {
  className?: string;
  dismissible?: boolean;
}) {
  const { installed, canNativeInstall, platform, install } = useInstallApp();
  const [hidden, setHidden] = useState(() => {
    if (typeof window === "undefined" || !dismissible) return false;
    return window.localStorage.getItem("fos-install-dismissed") === "1";
  });
  const [guide, setGuide] = useState(false);

  if (installed || hidden) return null;

  async function onDownload() {
    const result = await install();
    if (result === "guide") setGuide(true);
  }

  function dismiss() {
    window.localStorage.setItem("fos-install-dismissed", "1");
    setHidden(true);
  }

  return (
    <>
      <div className={cn("rounded-xl bg-card p-4 shadow-[var(--elev-shadow)]", className)}>
        <div className="flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-secondary">
            <Smartphone className="size-5 text-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Download as app</p>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              Add Kharcha to your home screen. Opens like a real app, no browser tab.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button type="button" className="h-11 flex-1" onClick={() => void onDownload()}>
            {canNativeInstall ? "Install Kharcha" : "Download as app"}
          </Button>
          {dismissible && (
            <Button type="button" variant="secondary" className="h-11" onClick={dismiss}>
              Later
            </Button>
          )}
        </div>
      </div>
      <InstallGuideSheet open={guide} onOpenChange={setGuide} platform={platform} />
    </>
  );
}

function InstallGuideSheet({
  open,
  onOpenChange,
  platform,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: "ios" | "android" | "desktop";
}) {
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="overflow-y-auto pb-8">
        <SheetHeader>
          <SheetTitle>Download as app</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-5 pb-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Put Kharcha on your home screen. It opens from the icon — not as a Chrome or Safari tab.
          </p>

          {platform === "ios" && (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Tap the Share button in Safari (square with an arrow).</li>
              <li>
                Choose <span className="font-medium text-foreground">Add to Home Screen</span>.
              </li>
              <li>Tap Add. Kharcha appears with your other apps.</li>
            </ol>
          )}

          {platform === "android" && (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Open this page in Chrome, not the Grok browser.</li>
              <li>
                Tap menu <span className="font-medium text-foreground">⋮</span> →{" "}
                <span className="font-medium text-foreground">Install app</span> or Add to Home screen.
              </li>
              <li>Install. Kharcha sits with your other apps.</li>
            </ol>
          )}

          {platform === "desktop" && (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>In Chrome or Edge, tap the install icon on the right of the address bar.</li>
              <li>
                Or open the menu → <span className="font-medium text-foreground">Install Kharcha</span>.
              </li>
              <li>On a phone, open this link in Chrome and install from there.</li>
            </ol>
          )}

          <div className="flex flex-col gap-2 pt-1">
            {platform === "ios" ? (
              <Button type="button" className="h-11 w-full" onClick={() => openInstallGuide()}>
                Show step-by-step
              </Button>
            ) : (
              <Button type="button" className="h-11 w-full" onClick={() => void copyLink()}>
                Copy app link
              </Button>
            )}
            {platform !== "ios" && (
              <Button type="button" variant="secondary" className="h-11 w-full" onClick={() => openInstallGuide()}>
                Open install guide
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
