const KEY = "kharcha-return";

export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return null;
  return raw;
}

export function rememberReturn(path: string | null | undefined) {
  if (typeof window === "undefined") return;
  const safe = safeReturnPath(path);
  if (!safe) return;
  sessionStorage.setItem(KEY, safe);
}

export function peekReturn(): string | null {
  if (typeof window === "undefined") return null;
  return safeReturnPath(sessionStorage.getItem(KEY));
}

export function consumeReturn(): string | null {
  const value = peekReturn();
  if (value && typeof window !== "undefined") sessionStorage.removeItem(KEY);
  return value;
}
