export function BrandLoader({
  label = "Loading your ledger…",
}: {
  label?: string;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="flex flex-col items-center text-center">
        <div className="fos-ledger-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="mt-8 font-display text-3xl tracking-tight">FinanceOS</p>
        <p className="mt-2 text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
