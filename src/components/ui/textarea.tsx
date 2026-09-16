import { type TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-md bg-secondary px-3 py-2 text-sm text-foreground shadow-[inset_0_0_0_1px_var(--input)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
