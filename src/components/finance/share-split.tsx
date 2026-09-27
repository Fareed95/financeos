import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import type { ShareLink } from "@/lib/server/split-links";
import { toast } from "sonner";

function mailHref(email: string, link: ShareLink, currency: string) {
  const share = formatMoney(link.allocated, currency);
  const subject = encodeURIComponent("Split bill");
  const body = encodeURIComponent(`${link.name}, your share is ${share}.\n${link.url}\n`);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export function ShareSplitList({
  links,
  currency,
  onDone,
}: {
  links: ShareLink[];
  currency: string;
  onDone: () => void;
}) {
  const [emails, setEmails] = useState<Record<number, string>>({});

  useEffect(() => {
    const first = links.find((link) => link.email && !link.mailed && link.url.startsWith("http"));
    if (!first?.email) return;
    window.location.href = mailHref(first.email, first, currency);
  }, [links, currency]);

  async function copy(url: string) {
    const text = url.startsWith("http") ? url : `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  async function share(link: ShareLink) {
    const url = link.url.startsWith("http") ? link.url : `${window.location.origin}${link.url}`;
    const shareText = `${link.name}, your share is ${formatMoney(link.allocated, currency)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Split bill", text: shareText, url });
        return;
      } catch {
        /* dismissed */
      }
    }
    await copy(url);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Send each person their link. If you added an email, it opens in your mail — hit send there.
      </p>
      {links.map((link, index) => {
        const email = emails[index] ?? link.email ?? "";
        return (
          <div key={`${link.name}-${index}`} className="space-y-2 rounded-xl bg-secondary/60 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">{link.name}</p>
              <p className="tabular text-sm">{formatMoney(link.allocated, currency)}</p>
            </div>
            {link.mailed && <p className="text-xs text-muted-foreground">Email sent.</p>}
            <p className="truncate text-xs text-muted-foreground">{link.url}</p>
            <Input
              type="email"
              inputMode="email"
              placeholder="Their email"
              value={email}
              onChange={(e) => setEmails({ ...emails, [index]: e.target.value })}
              className="h-10"
            />
            <div className="grid grid-cols-3 gap-1.5">
              <Button type="button" variant="secondary" className="h-10" onClick={() => void copy(link.url)}>
                Copy
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-10"
                disabled={!email.includes("@")}
                onClick={() => {
                  const url = link.url.startsWith("http") ? link.url : `${window.location.origin}${link.url}`;
                  window.location.href = mailHref(email, { ...link, url }, currency);
                }}
              >
                Email
              </Button>
              <Button type="button" className="h-10" onClick={() => void share(link)}>
                Share
              </Button>
            </div>
          </div>
        );
      })}
      <Button type="button" className="h-11 w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
