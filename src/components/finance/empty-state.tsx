import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-lg bg-secondary text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>
      </div>
      {action && onAction && (
        <Button onClick={onAction} size="sm">
          {action}
        </Button>
      )}
    </div>
  );
}
