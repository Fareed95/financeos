import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, fromCents, parseMoney, toCents } from "@/lib/money";
import { allocateSplits, type SplitMethod } from "@/lib/split";
import { cn } from "@/lib/utils";

export type SplitSnapshot = {
  mode: "off" | "group" | "open";
  method: SplitMethod;
  visibility: "personal" | "shared" | "private";
  parts: { userId?: string; name: string; email: string; value: string }[];
  error: string;
};

type Guest = { id: string; name: string; email: string; value: string };

const METHODS: { id: SplitMethod; label: string }[] = [
  { id: "equal", label: "Equal" },
  { id: "exact", label: "Amount" },
  { id: "percentage", label: "%" },
];

export function SplitEditor({
  collaborative,
  people,
  meId,
  amount,
  currency,
  initial,
  onChange,
}: {
  collaborative: boolean;
  people: { userId: string; name: string }[];
  meId?: string;
  amount: string;
  currency: string;
  initial?: {
    mode: "off" | "group" | "open";
    method: SplitMethod;
    visibility: "personal" | "shared" | "private";
    parts: { userId: string | null; name: string; email: string; value: string }[];
  } | null;
  onChange: (snap: SplitSnapshot) => void;
}) {
  const [choice, setChoice] = useState<"personal" | "shared" | "private">(
    initial?.mode === "group" && initial.visibility === "private"
      ? "private"
      : initial?.mode === "off" || !initial
        ? "personal"
        : "shared",
  );
  const [method, setMethod] = useState<SplitMethod>(initial?.method ?? "equal");
  const [picked, setPicked] = useState<string[]>(() => {
    if (!initial || initial.mode === "off") return people.map((person) => person.userId);
    return initial.parts.map((part) => part.userId).filter((id): id is string => Boolean(id));
  });
  const [emails, setEmails] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const part of initial?.parts ?? []) {
      if (part.userId && part.email) next[part.userId] = part.email;
    }
    return next;
  });
  const [values, setValues] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const part of initial?.parts ?? []) {
      if (part.userId) next[part.userId] = part.value;
    }
    return next;
  });
  const [guests, setGuests] = useState<Guest[]>(() =>
    (initial?.parts ?? [])
      .filter((part) => !part.userId)
      .map((part, index) => ({
        id: `guest-${index}`,
        name: part.name,
        email: part.email,
        value: part.value,
      })),
  );

  useEffect(() => {
    if (choice === "personal" || !collaborative) return;
    if (picked.length === 0 && people.length > 0) setPicked(people.map((person) => person.userId));
  }, [choice, collaborative, people, picked.length]);

  const snap = useMemo<SplitSnapshot>(() => {
    const named = guests.filter((guest) => guest.name.trim());
    const touched = guests.filter((guest) => guest.name.trim() || guest.email.trim() || guest.value.trim());
    const members = people.filter((person) => picked.includes(person.userId));
    if (choice === "personal") {
      return { mode: "off", method, visibility: "personal", parts: [], error: "" };
    }
    const blankGuest = touched.some((guest) => !guest.name.trim());
    const useGroup = collaborative && named.length === 0 && !blankGuest && members.length >= 2;
    const parts = useGroup
      ? members.map((person) => ({
          userId: person.userId,
          name: person.userId === meId ? "You" : person.name,
          email: person.userId === meId ? "" : (emails[person.userId] ?? "").trim(),
          value: method === "equal" ? "1" : (values[person.userId] ?? "").trim(),
        }))
      : [
          ...(meId
            ? [{ userId: meId, name: "You", email: "", value: method === "equal" ? "1" : (values[meId] ?? "").trim() }]
            : []),
          ...(collaborative
            ? members
                .filter((person) => person.userId !== meId)
                .map((person) => ({
                  userId: person.userId,
                  name: person.name,
                  email: (emails[person.userId] ?? "").trim(),
                  value: method === "equal" ? "1" : (values[person.userId] ?? "").trim(),
                }))
            : []),
          ...named.map((guest) => ({
            name: guest.name.trim(),
            email: guest.email.trim(),
            value: method === "equal" ? "1" : guest.value.trim(),
          })),
        ];
    let error = "";
    if (!meId) error = "Still signing you in";
    else if (parts.length < 2) error = blankGuest ? "Name the person you're splitting with" : "Add at least one person";
    else {
      try {
        allocateSplits(
          parseMoney(amount || "0"),
          method === "shares" ? "equal" : method,
          parts.map((part, index) => ({
            userId: ("userId" in part && part.userId) || `guest-${index}`,
            value: method === "equal" ? "1" : part.value || "0",
          })),
        );
      } catch (err) {
        error = err instanceof Error ? err.message : "Check the split";
      }
    }
    return {
      mode: useGroup ? "group" : "open",
      method: method === "shares" ? "equal" : method,
      visibility: useGroup ? (choice === "private" ? "private" : "shared") : "personal",
      parts,
      error,
    };
  }, [choice, method, collaborative, guests, picked, people, meId, emails, values, amount]);

  useEffect(() => {
    onChange(snap);
  }, [snap, onChange]);

  const preview = useMemo(() => {
    if (choice === "personal" || snap.error || snap.parts.length < 2) return "";
    try {
      const allocations = allocateSplits(
        parseMoney(amount),
        method,
        snap.parts.map((part, index) => ({
          userId: part.userId || `guest-${index}`,
          value: method === "equal" ? "1" : part.value || "0",
        })),
      );
      return allocations
        .map((row, index) => `${snap.parts[index]?.name || "Someone"} ${formatMoney(row.allocated, currency)}`)
        .join(" · ");
    } catch {
      return "";
    }
  }, [choice, snap, amount, method, currency]);

  const remainder = useMemo(() => {
    if (choice === "personal" || method === "equal") return "";
    try {
      if (method === "percentage") {
        const used = snap.parts.reduce((sum, part) => sum + Number(part.value || 0), 0);
        const left = Math.round((100 - used) * 100) / 100;
        return left === 0 ? "100%" : `${left} left`;
      }
      const total = toCents(parseMoney(amount || "0"));
      const used = snap.parts.reduce((sum, part) => sum + toCents(parseMoney(part.value || "0")), 0n);
      const left = total - used;
      if (left === 0n) return "Adds up";
      return `${formatMoney(fromCents(left < 0n ? -left : left), currency)} ${left < 0n ? "over" : "left"}`;
    } catch {
      return "";
    }
  }, [choice, method, snap.parts, amount, currency]);

  function addGuest() {
    setGuests((list) => [...list, { id: `guest-${Date.now()}`, name: "", email: "", value: "" }]);
  }

  const rows = [
    ...(collaborative && choice !== "personal"
      ? people
          .filter((person) => picked.includes(person.userId) && person.userId !== meId)
          .map((person) => ({
            key: person.userId,
            userId: person.userId as string | undefined,
            name: person.name,
            email: emails[person.userId] ?? "",
            value: values[person.userId] ?? "",
            guest: false,
          }))
      : []),
    ...guests.map((guest) => ({
      key: guest.id,
      userId: undefined as string | undefined,
      name: guest.name,
      email: guest.email,
      value: guest.value,
      guest: true,
    })),
  ];

  const options = collaborative
    ? [
        { id: "personal" as const, label: "Just mine" },
        { id: "shared" as const, label: "With group" },
        { id: "private" as const, label: "Private" },
      ]
    : [
        { id: "personal" as const, label: "Just mine" },
        { id: "shared" as const, label: "Split" },
      ];

  return (
    <div className="space-y-2">
      <Label>Split</Label>
      <div className="flex gap-1 rounded-lg bg-secondary p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              setChoice(option.id);
              if (option.id !== "personal" && !collaborative && guests.length === 0) addGuest();
            }}
            className={cn(
              "h-9 flex-1 rounded-md px-1 text-xs font-medium",
              choice === option.id ? "bg-card text-foreground shadow-[var(--elev-shadow)]" : "text-muted-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {choice === "personal" ? (
        <p className="text-xs leading-relaxed text-muted-foreground">Only on your budget. Nobody else sees it.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1">
            {METHODS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMethod(item.id)}
                className={cn(
                  "h-9 rounded-md text-xs font-medium",
                  method === item.id ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          {collaborative && (
            <div className="flex flex-wrap gap-1.5">
              {people.map((person) => {
                const on = picked.includes(person.userId);
                return (
                  <button
                    key={person.userId}
                    type="button"
                    onClick={() =>
                      setPicked(on ? picked.filter((id) => id !== person.userId) : [...picked, person.userId])
                    }
                    className={cn(
                      "inline-flex h-9 items-center rounded-full px-3 text-xs font-medium",
                      on ? "bg-primary text-primary-foreground" : "bg-secondary",
                    )}
                  >
                    {person.userId === meId ? "You" : person.name}
                  </button>
                );
              })}
            </div>
          )}
          {rows
            .filter((row) => row.userId !== meId)
            .map((row) => (
              <div key={row.key} className="grid grid-cols-[1fr_1fr] gap-1.5">
                {row.guest ? (
                  <Input
                    value={guests.find((guest) => guest.id === row.key)?.name ?? ""}
                    placeholder="Name"
                    className="h-10"
                    onChange={(e) =>
                      setGuests((list) => list.map((guest) => (guest.id === row.key ? { ...guest, name: e.target.value } : guest)))
                    }
                  />
                ) : (
                  <p className="flex h-10 items-center truncate text-sm">{row.name}</p>
                )}
                <Input
                  type="email"
                  inputMode="email"
                  placeholder="Email, optional"
                  value={row.guest ? (guests.find((guest) => guest.id === row.key)?.email ?? "") : row.email}
                  className="h-10"
                  onChange={(e) => {
                    const next = e.target.value;
                    if (row.guest) {
                      setGuests((list) => list.map((guest) => (guest.id === row.key ? { ...guest, email: next } : guest)));
                    } else if (row.userId) {
                      setEmails({ ...emails, [row.userId]: next });
                    }
                  }}
                />
                {method !== "equal" && (
                  <Input
                    inputMode="decimal"
                    placeholder={method === "percentage" ? "%" : "Amount"}
                    className="col-span-2 h-10"
                    value={row.guest ? (guests.find((guest) => guest.id === row.key)?.value ?? "") : row.value}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d.]/g, "");
                      if (row.guest) {
                        setGuests((list) => list.map((guest) => (guest.id === row.key ? { ...guest, value: next } : guest)));
                      } else if (row.userId) {
                        setValues({ ...values, [row.userId]: next });
                      }
                    }}
                  />
                )}
              </div>
            ))}
          {method !== "equal" && meId && (
            <Input
              inputMode="decimal"
              placeholder={method === "percentage" ? "Your %" : "Your amount"}
              className="h-10"
              value={values[meId] ?? ""}
              onChange={(e) => setValues({ ...values, [meId]: e.target.value.replace(/[^\d.]/g, "") })}
            />
          )}
          <button type="button" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline" onClick={addGuest}>
            Add person
          </button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {preview ? `${preview}. You paid. ` : snap.error ? `${snap.error}. ` : ""}
            {remainder ? `${remainder}. ` : ""}
            {snap.mode === "group"
              ? "This updates who owes whom on the project. A link is ready for each person."
              : "A link is created for each person. Add an email and it opens in your mail. This stays on your budget."}
          </p>
        </>
      )}
    </div>
  );
}
