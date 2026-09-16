import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearAssistantHistory,
  listAssistantMessages,
  sendAssistantMessage,
  type AssistantChatMessage,
} from "@/lib/server/assistant";
import { useAppData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SUGGESTIONS = [
  "Add ₹250 coffee on UPI",
  "Kitna spend hua this month?",
  "Bangalore trip ka remaining?",
  "Transfer ₹5,000 HDFC → UPI",
];

export function AssistantChat() {
  const { refresh } = useAppData();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["assistant"],
    queryFn: () => listAssistantMessages(),
  });
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const send = useMutation({
    mutationFn: (message: string) => sendAssistantMessage({ data: { message } }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["assistant"] });
      if (res.mutated) await refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't send that");
    },
  });

  const clear = useMutation({
    mutationFn: () => clearAssistantHistory(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assistant"] }),
  });

  const messages = list.data ?? [];
  const pendingUser = send.isPending ? draftPending(send.variables) : null;
  const empty = messages.length === 0 && !send.isPending;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, send.isPending]);

  function resizeField() {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }

  function submit(text: string) {
    const value = text.trim();
    if (!value || send.isPending) return;
    setDraft("");
    requestAnimationFrame(() => {
      if (field.current) {
        field.current.style.height = "auto";
      }
    });
    send.mutate(value);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:min-h-[calc(100dvh-3rem)]">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 md:px-0 md:pt-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl tracking-tight md:text-3xl">Ask</h1>
          <p className="truncate text-xs text-muted-foreground md:mt-1 md:text-sm">
            Speak to the ledger. It posts for real.
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear chat"
            onClick={() => clear.mutate()}
            disabled={clear.isPending}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-0">
        {empty ? (
          <Welcome />
        ) : (
          <div className="space-y-3 py-2 pb-4">
            {messages.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
            {pendingUser && (
              <>
                <Bubble message={pendingUser} />
                <Thinking />
              </>
            )}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <div
        className="fos-composer shrink-0 border-t border-border bg-background px-3 pt-3 md:border-0 md:px-0 md:pt-4"
        style={{
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          marginBottom: "var(--composer-tab, 3.75rem)",
        }}
      >
        {empty && (
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-full bg-card px-3.5 py-2 text-left text-xs leading-snug text-foreground shadow-[var(--elev-shadow)]"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <div className="flex items-end gap-2 rounded-[1.35rem] bg-card p-1.5 pl-1 shadow-[var(--elev-shadow)]">
            <textarea
              ref={field}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                resizeField();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(draft);
                }
              }}
              rows={1}
              placeholder="₹250 coffee, or ask anything…"
              className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3.5 py-2.5 text-sm leading-snug outline-none placeholder:text-muted-foreground"
              disabled={send.isPending}
            />
            <Button
              type="submit"
              size="icon"
              className="size-11 shrink-0 rounded-full"
              disabled={!draft.trim() || send.isPending}
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function draftPending(text?: string): AssistantChatMessage | null {
  if (!text?.trim()) return null;
  return {
    id: "pending-user",
    role: "user",
    content: text.trim(),
    actions: null,
    createdAt: new Date().toISOString(),
  };
}

function Welcome() {
  return (
    <div className="grid h-full min-h-[16rem] place-items-center px-2">
      <div className="max-w-[17rem] text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary">
          <Sparkles className="size-5 text-muted-foreground" />
        </div>
        <p className="mt-4 font-display text-2xl tracking-tight">Talk to your books</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Hindi ya English — add spend, check a trip, move money. It writes to the ledger.
        </p>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: AssistantChatMessage }) {
  const mine = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[min(36rem,88%)] px-4 py-3 text-sm leading-relaxed",
          mine
            ? "rounded-[1.15rem] rounded-br-md bg-primary text-primary-foreground"
            : "rounded-[1.15rem] rounded-bl-md bg-card text-foreground shadow-[var(--elev-shadow)]",
        )}
      >
        <p className="whitespace-pre-wrap">{formatReply(message.content)}</p>
      </div>
      {message.actions && message.actions.length > 0 && (
        <ul className="flex max-w-[min(36rem,88%)] flex-wrap gap-1.5">
          {message.actions.map((a, i) => (
            <li
              key={`${a.tool}-${i}`}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px]",
                a.ok ? "bg-secondary text-muted-foreground" : "bg-expense/15 text-expense",
              )}
            >
              {a.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatReply(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-medium">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function Thinking() {
  return (
    <div className="flex items-center gap-3 px-1 text-sm text-muted-foreground">
      <div className="fos-ledger-mark fos-ledger-mark-sm" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      Working on the ledger…
    </div>
  );
}
