import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { BrandLoader } from "@/components/brand-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { InstallAppCard } from "@/components/install-app";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isPending) return <BrandLoader label="Opening the door…" />;
  if (user) return <Navigate to="/" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "up") {
        const { error: err } = await authClient.signUp.email({
          email: email.trim(),
          password,
          name: name.trim() || email.split("@")[0] || "There",
        });
        if (err) throw new Error(err.message ?? "Could not create account");
      } else {
        const { error: err } = await authClient.signIn.email({
          email: email.trim(),
          password,
        });
        if (err) throw new Error(err.message ?? "Could not sign in");
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
      <section className="fos-login-pane relative hidden flex-col justify-between overflow-hidden px-12 py-10 lg:flex">
        <p className="relative font-display text-2xl tracking-tight">FinanceOS</p>
        <div className="relative max-w-lg space-y-5">
          <h1 className="font-display text-[3.25rem] leading-[1.08] tracking-tight">
            Your money,
            <br />
            in one quiet place.
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Accounts, trips, and the month — plus an assistant that can actually post the expense.
          </p>
          <ul className="grid gap-3 pt-2 text-sm">
            <Feature title="Talk to the ledger" body="“Add ₹250 coffee on UPI” lands as a real transaction." />
            <Feature title="Trips stay honest" body="Prepaid vs during, remaining, daily pace." />
            <Feature title="INR, first" body="Numeric money. No floating-point surprises." />
          </ul>
        </div>
        <p className="relative text-xs text-muted-foreground">Personal finance + projects.</p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-[22.5rem]">
          <div className="mb-8 lg:hidden">
            <p className="font-display text-2xl tracking-tight">FinanceOS</p>
            <p className="mt-3 font-display text-3xl leading-tight tracking-tight">
              Your money, in one quiet place.
            </p>
          </div>

          <div className="rounded-2xl bg-card p-6 shadow-[var(--elev-shadow)]">
            <h2 className="font-display text-2xl tracking-tight">
              {mode === "in" ? "Welcome back" : "Create account"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "in" ? "Sign in to continue to your books." : "A few details and you're in."}
            </p>

            {authEnabled ? (
              <div className="mt-6 space-y-5">
                <div className="grid gap-2">
                  {GROK_PROVIDERS.map((p) => (
                    <Button
                      key={p.providerId}
                      type="button"
                      variant="outline"
                      className="h-11 w-full justify-center rounded-lg"
                      onClick={() => signIn(p.providerId, { callbackURL: "/" })}
                    >
                      {p.idp === "google" ? <GoogleMark /> : <XMark />}
                      Continue with {p.label}
                    </Button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or email</span>
                  <Separator className="flex-1" />
                </div>

                <form onSubmit={onSubmit} className="space-y-3">
                  {mode === "up" && (
                    <Field label="Name" htmlFor="name">
                      <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                        placeholder="Your name"
                      />
                    </Field>
                  )}
                  <Field label="Email" htmlFor="email">
                    <Input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      placeholder="you@email.com"
                    />
                  </Field>
                  <Field label="Password" htmlFor="password">
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete={mode === "up" ? "new-password" : "current-password"}
                        placeholder={mode === "up" ? "At least 8 characters" : "Your password"}
                        className="pr-11"
                      />
                      <button
                        type="button"
                        className="absolute top-0 right-0 grid size-11 place-items-center text-muted-foreground"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </Field>
                  {error && <p className="text-sm text-expense">{error}</p>}
                  <Button type="submit" className="h-11 w-full rounded-lg" disabled={busy}>
                    {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
                  </Button>
                </form>
              </div>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">Sign-in is disabled.</p>
            )}
          </div>

          {authEnabled && (
            <div className="mt-5 space-y-2 px-1 text-sm text-muted-foreground">
              <p>
                {mode === "in" ? "New here?" : "Already have an account?"}{" "}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode(mode === "in" ? "up" : "in");
                    setError(null);
                  }}
                >
                  {mode === "in" ? "Create an account" : "Sign in"}
                </button>
              </p>
              <p className="text-xs">Password reset lives in Settings after you sign in.</p>
            </div>
          )}

          <div className="mt-6">
            <InstallAppCard />
          </div>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <li className="rounded-xl bg-card/70 px-4 py-3 shadow-[var(--elev-shadow)]">
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-muted-foreground">{body}</p>
    </li>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.4H12v4.5h6.5c-.3 1.5-1.2 2.8-2.5 3.6v3h4c2.4-2.2 3.5-5.4 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1 7.9-2.8l-4-3c-1.1.7-2.5 1.2-3.9 1.2-3 0-5.6-2-6.5-4.8H1.4v3.1C3.4 21.4 7.4 24 12 24z" />
      <path fill="#FBBC05" d="M5.5 14.6c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V7.1H1.4C.5 8.8 0 10.4 0 12.4c0 2 .5 3.6 1.4 5.3l4.1-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.7l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l4.1 3.1C6.4 6.8 9 4.8 12 4.8z" />
    </svg>
  );
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.2 2H21l-6.5 7.4L22 22h-6.8l-5.3-7-6 7H2.1l7-8L2 2h7l4.8 6.4L18.2 2zm-1.2 18h1.9L7.1 3.9H5.1L17 20z"
      />
    </svg>
  );
}
