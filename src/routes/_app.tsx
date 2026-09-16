import { createFileRoute, Navigate } from "@tanstack/react-router";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { AppShell } from "@/components/app-shell";
import { DataProvider, useAppData } from "@/components/data-provider";
import { QuickAddProvider } from "@/components/finance/quick-add";
import { BrandLoader } from "@/components/brand-loader";
import type { ReactNode } from "react";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <ShellSkeleton />;
  if (!user) return <RedirectToSignIn />;
  return (
    <DataProvider>
      <QuickAddProvider>
        <OnboardingGuard>
          <AppShell />
        </OnboardingGuard>
      </QuickAddProvider>
    </DataProvider>
  );
}

function OnboardingGuard({ children }: { children: ReactNode }) {
  const { data, isPending, error } = useAppData();
  if (isPending) return <ShellSkeleton />;
  if (error === "Unauthorized") return <RedirectToSignIn />;
  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="font-display text-2xl">Couldn't load your finances</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </main>
    );
  }
  if (data && !data.profile.onboardingCompleted) {
    return <Navigate to="/onboarding" />;
  }
  return <>{children}</>;
}

function ShellSkeleton() {
  return <BrandLoader />;
}
