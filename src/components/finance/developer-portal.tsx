import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_ROUTES } from "@/lib/api-routes";
import { SCOPES, createBusinessApiKey, getBusiness, listBusinessApiLogs, revokeBusinessApiKey, rotateBusinessApiKey } from "@/lib/server/business";
import { disableWebhook, rotateWebhookSecret, saveWebhookEndpoint, sendTestWebhook, webhookDesk } from "@/lib/server/ops";
import { todayISO } from "@/lib/utils";

const GROUPS: { label: string; scopes: string[] }[] = [
  { label: "Customers", scopes: ["customers:read", "customers:create", "customers:update"] },
  { label: "Invoices", scopes: ["invoices:read", "invoices:create", "invoices:update"] },
  { label: "Payments", scopes: ["payments:read", "payments:create"] },
  { label: "Expenses", scopes: ["expenses:read", "expenses:create"] },
  { label: "Reports", scopes: ["reports:read", "accounting:read"] },
  { label: "Journals", scopes: ["transactions:read", "transactions:create"] },
  { label: "Vendors", scopes: ["vendors:read", "vendors:create", "vendors:update"] },
  { label: "Bills", scopes: ["bills:read", "bills:create", "bills:update"] },
  { label: "Planning", scopes: ["budgets:read", "budgets:write", "assets:read", "loans:read"] },
];

const TABS = ["Overview", "API Keys", "Documentation", "Webhooks", "API Logs"] as const;

export function DeveloperPortal({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [token, setToken] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {TABS.map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} className={`h-11 shrink-0 rounded-full px-4 text-sm ${tab === item ? "bg-foreground text-background" : "bg-card text-muted-foreground"}`}>
            {item}
          </button>
        ))}
      </div>
      {tab === "Overview" && <Overview origin={origin} onDocs={() => setTab("Documentation")} onKeys={() => setTab("API Keys")} />}
      {tab === "API Keys" && <Keys projectId={projectId} token={token} onToken={setToken} onDocs={() => setTab("Documentation")} />}
      {tab === "Documentation" && <Docs origin={origin} token={token} />}
      {tab === "Webhooks" && <WebhookPanel projectId={projectId} />}
      {tab === "API Logs" && <Logs projectId={projectId} />}
    </div>
  );
}

function Overview({ origin, onDocs, onKeys }: { origin: string; onDocs: () => void; onKeys: () => void }) {
  return (
    <section className="rounded-xl bg-card p-4">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">API base URL</p>
      <p className="mt-1 break-all font-mono text-sm">{origin}/api/v1</p>
      <p className="mt-3 text-sm text-muted-foreground">A test key writes to a separate test ledger. It does not change the live invoices or the P&L in this app. A live key writes to the live books.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" className="h-11" onClick={onKeys}>Create API key</Button>
        <Button type="button" variant="secondary" className="h-11" onClick={onDocs}>Learn how to connect</Button>
      </div>
    </section>
  );
}

function Keys({ projectId, token, onToken, onDocs }: { projectId: string; token: string | null; onToken: (value: string | null) => void; onDocs: () => void }) {
  const today = todayISO();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["business", projectId, today], queryFn: () => getBusiness({ data: { projectId, today } }) });
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [days, setDays] = useState<number | null>(null);
  const [scopes, setScopes] = useState<string[]>(["invoices:read", "invoices:create", "payments:create", "customers:read", "customers:create"]);
  return (
    <div className="space-y-3">
      <form
        className="grid gap-3 rounded-xl bg-card p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const saved = await createBusinessApiKey({ data: { projectId, name, environment, scopes, expiresInDays: days } });
            onToken(saved?.token ?? null);
            setName("");
            toast.success("Copy the key now. Only its hash is stored.");
            await qc.invalidateQueries({ queryKey: ["business", projectId] });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't create the key");
          }
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">New key</p>
          <button type="button" className="text-sm text-muted-foreground underline" onClick={onDocs}>Learn how to connect</button>
        </div>
        <Input value={name} placeholder="Crodlin Integration" onChange={(event) => setName(event.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select className="h-11 rounded-md bg-secondary px-3" value={environment} onChange={(event) => setEnvironment(event.target.value as "test" | "live")}>
            <option value="test">Test ledger</option>
            <option value="live">Live books</option>
          </select>
          <select className="h-11 rounded-md bg-secondary px-3" value={days ?? ""} onChange={(event) => setDays(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Never expires</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-xs tracking-wide text-muted-foreground uppercase">{group.label}</p>
            {group.scopes.filter((scope) => (SCOPES as readonly string[]).includes(scope)).map((scope) => (
              <label key={scope} className="mt-1 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={(event) => setScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))}
                />
                {scope}
              </label>
            ))}
          </div>
        ))}
        <Button type="submit">Create key</Button>
        {token && <p className="break-all rounded-md bg-secondary p-3 text-xs">{token}</p>}
      </form>
      {(q.data?.keys ?? []).map((key) => (
        <div key={key.id} className="flex items-center justify-between gap-3 rounded-xl bg-card p-4">
          <div>
            <p className="text-sm font-medium">{key.name}</p>
            <p className="text-xs text-muted-foreground">{key.prefix}… · {key.environment}{key.revoked ? " · revoked" : ""}</p>
          </div>
          {!key.revoked && (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="h-11" onClick={async () => {
                const saved = await rotateBusinessApiKey({ data: { projectId, keyId: key.id } });
                onToken(saved?.token ?? null);
                toast.success("Old key revoked. Copy the new one.");
                await qc.invalidateQueries({ queryKey: ["business", projectId] });
              }}>Rotate</Button>
              <Button type="button" variant="ghost" className="h-11 text-expense" onClick={async () => {
                await revokeBusinessApiKey({ data: { projectId, keyId: key.id } });
                await qc.invalidateQueries({ queryKey: ["business", projectId] });
              }}>Revoke</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Docs({ origin, token }: { origin: string; token: string | null }) {
  const [lang, setLang] = useState<"curl" | "javascript" | "node" | "python" | "php">("curl");
  const base = `${origin}/api/v1`;
  const key = token ?? "YOUR_API_KEY";
  const samples = {
    curl: `curl -X GET "${base}/invoices" \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json"`,
    javascript: `// Call this from your backend. Never put a live key in browser JavaScript.\nconst response = await fetch("${base}/invoices", {\n  headers: {\n    Authorization: "Bearer ${key}",\n    "Content-Type": "application/json"\n  }\n});\nconst data = await response.json();`,
    node: `const response = await fetch(process.env.KHARCHA_API_URL + "/invoices", {\n  headers: {\n    Authorization: "Bearer " + process.env.KHARCHA_API_KEY,\n    "Content-Type": "application/json"\n  }\n});\nconsole.log(await response.json());`,
    python: `import os\nimport requests\n\nresponse = requests.get(\n    os.environ["KHARCHA_API_URL"] + "/invoices",\n    headers={"Authorization": "Bearer " + os.environ["KHARCHA_API_KEY"]},\n)\nprint(response.json())`,
    php: `<?php\n$ch = curl_init(getenv("KHARCHA_API_URL") . "/invoices");\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer " . getenv("KHARCHA_API_KEY")]);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\necho curl_exec($ch);`,
  };
  const envFile = `KHARCHA_API_URL=${base}\nKHARCHA_API_KEY=${token ? key : "YOUR_API_KEY"}`;
  return (
    <div className="space-y-4" id="quickstart">
      <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Connect Kharcha to your application</h2>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Create a test key. It uses a separate ledger.</li>
          <li>2. Pick the scopes that call needs.</li>
          <li>3. Send the request below. Same Idempotency-Key plus same body returns the original result. A different body returns 409.</li>
        </ol>
        <p className="mt-3 text-sm">Base URL <span className="font-mono">{base}</span></p>
        <p className="mt-2 text-sm text-muted-foreground">Authorization: Bearer kh_test_… or kh_live_…. The key is the business and the permissions. Do not send a business id to switch companies.</p>
        {token && <p className="mt-2 text-sm">The sample below includes the key you just created. It disappears when you leave this screen.</p>}
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {(["curl", "javascript", "node", "python", "php"] as const).map((item) => (
            <button key={item} type="button" className={`h-9 rounded-full px-3 text-xs ${lang === item ? "bg-foreground text-background" : "bg-secondary"}`} onClick={() => setLang(item)}>{item}</button>
          ))}
        </div>
        <pre className="mt-3 overflow-x-auto rounded-md bg-secondary p-3 text-xs">{samples[lang]}</pre>
        <Button type="button" variant="secondary" className="mt-3 h-11" onClick={() => navigator.clipboard.writeText(samples[lang])}>Copy</Button>
        <pre className="mt-3 overflow-x-auto rounded-md bg-secondary p-3 text-xs">{envFile}</pre>
        <Button type="button" variant="secondary" className="mt-3 h-11" onClick={() => navigator.clipboard.writeText(envFile)}>Copy env</Button>
        <p className="mt-3 text-xs text-muted-foreground">Never commit a live key. Use it only on your server. Errors look like {`{ "error": { "code": "insufficient_scope", "message": "…" } }`}.</p>
      </section>
      {API_ROUTES.map((route) => (
        <article key={route.id} className="rounded-xl bg-card p-4">
          <p className="text-xs text-muted-foreground">{route.scope}{route.idempotent ? " · Idempotency-Key" : ""}</p>
          <h3 className="mt-1 font-mono text-sm">{route.method} /api/v1/{route.pattern}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{route.summary}</p>
          {route.body && <pre className="mt-2 overflow-x-auto rounded-md bg-secondary p-3 text-xs">{route.body}</pre>}
          <p className="mt-2 text-xs text-muted-foreground">Response</p>
          <pre className="mt-1 overflow-x-auto text-xs">{route.response}</pre>
        </article>
      ))}
    </div>
  );
}

function Logs({ projectId }: { projectId: string }) {
  const q = useQuery({ queryKey: ["api-logs", projectId], queryFn: () => listBusinessApiLogs({ data: { projectId } }) });
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading logs…</p>;
  const logs = q.data?.logs ?? [];
  if (logs.length === 0) return <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground">No API calls yet. Request bodies and keys are not stored here.</p>;
  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <article key={log.request_id} className="rounded-xl bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-sm">{log.method} {log.path}</p>
            <p className="text-xs tabular">{log.status} · {log.duration_ms}ms</p>
          </div>
          <p className="text-xs text-muted-foreground">{log.name || "Key"} · {log.environment} · {log.error_code || "ok"} · {log.request_id.slice(0, 8)}</p>
        </article>
      ))}
    </div>
  );
}

function WebhookPanel({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [verify, setVerify] = useState<"node" | "python" | "php">("node");
  const [result, setResult] = useState("");
  const desk = useQuery({ queryKey: ["webhooks", projectId], queryFn: () => webhookDesk({ data: { projectId } }) });
  const samples = {
    node: `import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, header, timestamp) {
  const expected = "sha256=" + createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Use the raw request bytes. Do not JSON.parse and stringify again.`,
    python: `import hashlib, hmac

def verify(secret: str, raw_body: bytes, header: str, timestamp: str) -> bool:
    signed = timestamp.encode() + b"." + raw_body
    expected = "sha256=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)

# raw_body is the exact HTTP body. Do not re-serialize parsed JSON.`,
    php: `function verify(string $secret, string $rawBody, string $header, string $timestamp): bool {
  $expected = "sha256=" . hash_hmac("sha256", $timestamp . "." . $rawBody, $secret);
  return hash_equals($expected, $header);
}

// $rawBody is php://input, not json_encode(json_decode($rawBody)).`,
  };
  return (
    <div className="space-y-3">
      <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Learn how to verify</h2>
        <p className="mt-2 text-sm text-muted-foreground">The signed payload is the timestamp, a dot, then the raw HTTP body. The signature is HMAC-SHA256 of that string. The header is X-Kharcha-Signature: sha256= plus the hex. Also sent: X-Kharcha-Event, X-Kharcha-Delivery, and X-Kharcha-Timestamp. The body has an event id and a type. Reject timestamps older than five minutes, and deduplicate by event id. The event id stays the same on every retry. The delivery id is the same row for those retries; the attempt count goes up. The API key is never in the body.</p>
        <div className="mt-3 flex gap-2">
          {(["node", "python", "php"] as const).map((item) => (
            <button key={item} type="button" className={`h-9 rounded-full px-3 text-xs ${verify === item ? "bg-foreground text-background" : "bg-secondary"}`} onClick={() => setVerify(item)}>{item === "node" ? "Node.js" : item === "python" ? "Python" : "PHP"}</button>
          ))}
        </div>
        <pre className="mt-3 overflow-x-auto rounded-md bg-secondary p-3 text-xs">{samples[verify]}</pre>
      </section>
      <section className="rounded-xl bg-card p-4">
        <h2 className="text-sm font-medium">Webhooks</h2>
        <p className="mt-2 text-sm text-muted-foreground">Kharcha tries delivery when the event is created. If that fails, the server retries after about 1, 5, 30, and 120 minutes. Those retries run from the scheduled job, not because someone opened this page. The job only runs where the host cron secret is configured. The secret is shown once and is not written to the audit log.</p>
        <form className="mt-3 grid gap-2" onSubmit={async (event) => {
          event.preventDefault();
          const saved = await saveWebhookEndpoint({ data: { projectId, url, events: ["invoice.issued", "invoice.paid", "bill.created", "bill.paid", "payment.created"] } });
          setSecret(saved?.secret || "");
          setUrl("");
          await desk.refetch();
        }}>
          <Input className="h-11" placeholder="https://example.com/hooks" value={url} onChange={(event) => setUrl(event.target.value)} required />
          <Button type="submit" className="h-11">Add endpoint</Button>
        </form>
        {secret && <p className="mt-2 break-all font-mono text-xs">Signing secret, shown once: {secret}</p>}
      </section>
      {(desk.data?.endpoints ?? []).map((endpoint) => (
        <article key={endpoint.id} className="rounded-xl bg-card p-4 text-sm">
          <p className="break-all">{endpoint.url}</p>
          <p className="text-muted-foreground">{endpoint.status} · {endpoint.events}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" className="h-11" onClick={async () => {
              const sent = await sendTestWebhook({ data: { projectId, endpointId: endpoint.id } });
              setResult(sent ? `${sent.status} · HTTP ${sent.http} · ${sent.durationMs} ms · attempt ${sent.attempts}` : "No result");
              await desk.refetch();
            }}>Send test event</Button>
            <Button type="button" variant="secondary" className="h-11" onClick={async () => { const next = await rotateWebhookSecret({ data: { projectId, id: endpoint.id } }); setSecret(next?.secret || ""); await desk.refetch(); }}>Rotate secret</Button>
            <Button type="button" variant="ghost" className="h-11" onClick={async () => { await disableWebhook({ data: { projectId, id: endpoint.id } }); await desk.refetch(); }}>Disable</Button>
          </div>
        </article>
      ))}
      {result && <p className="text-sm">{result}</p>}
      {(desk.data?.deliveries ?? []).map((delivery) => (
        <article key={delivery.id} className="rounded-xl bg-card p-4 text-sm">
          <p>{delivery.event} · {delivery.status === "retry" ? "Retrying" : delivery.status === "delivered" ? "Delivered" : delivery.status === "failed" ? "Failed" : delivery.status}</p>
          <p className="text-muted-foreground">HTTP {delivery.http_status ?? "—"} · {delivery.duration_ms ?? "—"} ms · attempt {delivery.attempts}</p>
        </article>
      ))}
    </div>
  );
}
