import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { acceptInvite, previewInvite } from "@/lib/server/collab";
import { getBootstrap } from "@/lib/server/bootstrap";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/brand-loader";
import { APP_NAME } from "@/lib/constants";
import { rememberReturn } from "@/lib/return-to";
import { endOfMonthISO, startOfMonthISO } from "@/lib/utils";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/invite/$token")({ component: InvitePage });

function InvitePage() {
  const { token } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["invite", token, user?.id],
    enabled: Boolean(user),
    queryFn: () => previewInvite({ data: { token } }),
  });
  const from = startOfMonthISO();
  const to = endOfMonthISO();
  const ready = useQuery({
    queryKey: ["bootstrap", from, to, user?.id],
    enabled: Boolean(user),
    queryFn: () =>
      getBootstrap({ data: { from, to, displayName: user?.displayName ?? user?.primaryEmail ?? null } }),
  });
  const returnPath = `/invite/${token}`;

  if (isPending) return <BrandLoader />;
  if (!user) {
    rememberReturn(returnPath);
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="max-w-sm space-y-4">
          <p className="font-display text-3xl">{APP_NAME}</p>
          <p className="text-sm text-muted-foreground">Sign in or create an account to see this project invite.</p>
          <Button className="h-11 w-full" onClick={() => { window.location.href = `/login?next=${encodeURIComponent(returnPath)}`; }}>
            Continue
          </Button>
        </div>
      </main>
    );
  }
  if (ready.isPending || q.isPending) return <BrandLoader label="Opening invite…" />;
  if (ready.data && (!ready.data.profile.onboardingCompleted || ready.data.accounts.length === 0)) {
    rememberReturn(returnPath);
    return <Navigate to="/onboarding" />;
  }
  if (q.error || !q.data) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <p className="text-sm text-expense">{q.error instanceof Error ? q.error.message : "Invite unavailable"}</p>
      </main>
    );
  }
  const invite = q.data;

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Invited to this project</p>
        <p className="text-sm text-muted-foreground">{invite.invitedBy} invited you</p>
        <h1 className="font-display text-3xl">{invite.projectName}</h1>
        {invite.state === "open" && (
          <div className="flex gap-2">
            <Button
              className="h-11 flex-1"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await acceptInvite({ data: { token } });
                  toast.success("Joined");
                  void navigate({ to: "/projects/$id", params: { id: res?.projectId ?? invite.projectId } });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Couldn't join");
                  setBusy(false);
                }
              }}
            >
              Accept
            </Button>
            <Button variant="secondary" className="h-11 flex-1" onClick={() => void navigate({ to: "/" })}>
              Decline
            </Button>
          </div>
        )}
        {invite.state === "member" && (
          <Button className="h-11 w-full" onClick={() => void navigate({ to: "/projects/$id", params: { id: invite.projectId } })}>
            Open project
          </Button>
        )}
        {invite.state !== "open" && invite.state !== "member" && (
          <p className="text-sm text-muted-foreground">
            {invite.state === "expired" ? "This invite has expired." : invite.state === "revoked" ? "This invite was revoked." : "This invite was already used."}
          </p>
        )}
      </div>
    </main>
  );
}
