import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { acceptSplit, previewSplit } from "@/lib/server/split-links";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/brand-loader";
import { formatMoney } from "@/lib/money";
import { APP_NAME } from "@/lib/constants";
import { toast } from "sonner";

export const Route = createFileRoute("/split/$token")({ component: SplitPage });

function SplitPage() {
  const { token } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["split-link", token],
    queryFn: () => previewSplit({ data: { token } }),
  });

  if (isPending || q.isPending) return <BrandLoader label="Opening split…" />;
  if (q.error || !q.data) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <p className="text-sm text-expense">{q.error instanceof Error ? q.error.message : "This split link is not valid"}</p>
      </main>
    );
  }
  const split = q.data;

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <p className="text-sm text-muted-foreground">{APP_NAME}</p>
        <h1 className="font-display text-3xl">{split.description || "Split bill"}</h1>
        <p className="text-sm text-muted-foreground">{split.payerName} paid {formatMoney(split.total)}</p>
        <p className="font-display text-4xl tabular">{formatMoney(split.yourShare)}</p>
        <p className="text-sm text-muted-foreground">
          {split.yourName === "You" ? "Your share" : `${split.yourName}'s share`}
        </p>
        {split.status === "expired" && <p className="text-sm text-expense">This link has expired. Ask for a new one.</p>}
        {split.status === "settled" && <p className="text-sm text-muted-foreground">This one is already marked paid.</p>}
        {split.status !== "expired" && split.status !== "settled" && !user && (
          <Button className="h-11 w-full" onClick={() => { window.location.href = `/login?next=/split/${token}`; }}>
            Sign in to accept
          </Button>
        )}
        {split.status !== "expired" && split.status !== "settled" && user && (
          <Button
            className="h-11 w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await acceptSplit({ data: { token } });
                toast.success("Added to your splits");
                void navigate({ to: "/" });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't accept");
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : split.status === "accepted" ? "Open in Kharcha" : "Accept my share"}
          </Button>
        )}
      </div>
    </main>
  );
}
