import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "group bg-card text-foreground shadow-[var(--elev-shadow)] border-0",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}
