"use client";

//
// Labelled fields for <ActionForm>: the label, the control, a hint, and the
// server's error for that field — wired together with ids, aria-describedby
// and aria-invalid so a screen reader hears the error with the field.
//
// Every control is a native element (input, textarea, select, checkbox) so the
// form posts with JavaScript off; they wear the design system's field styles.
// `issuePath` defaults to `name` — set it when the service validates under a
// different path ("prices.0.amountCents").
//
// An invalid control is marked by more than colour: a heavier danger border
// (keyed on aria-invalid: ui/Input and ui/Textarea draw it themselves; a
// native <select> wears INVALID_CONTROL, a boxed control INVALID_WRAPPER) and
// the error under it, with an icon. After a failed save <ActionForm> focuses
// the first one.
//

import { useId, type ComponentProps, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FieldIssues, useHasIssue } from "./action-form";

/**
 * The invalid state of a control, keyed on its own aria-invalid: a danger border drawn 2 px thick (no layout
 * shift). ui/Input and ui/Textarea already carry it; this is for other controls (the native <select>).
 */
export const INVALID_CONTROL = "aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--color-danger)]";

/** The same mark on a wrapper that draws a control's border (an input with a prefix inside one box). */
export const INVALID_WRAPPER = "has-[[aria-invalid=true]]:border-danger has-[[aria-invalid=true]]:shadow-[0_0_0_1px_var(--color-danger)]";

/** The class every native <select> wears, matching the design system's inputs. Pair with <NativeSelect>. */
export const nativeSelectClass =
  "h-10 w-full min-w-0 appearance-none rounded-[10px] border border-input bg-transparent pr-9 pl-3 text-small text-ink transition-[color,background-color,border-color] duration-(--dur-hover) hover:bg-tonal disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11 dark:bg-card " + INVALID_CONTROL;

/** A native <select> (posts without JavaScript) with the design system's look and chevron. */
export function NativeSelect({ className, wrapperClassName, children, ...props }: ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <select className={cn(nativeSelectClass, className)} {...props}>
        {children}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

interface Common {
  label: ReactNode;
  name: string;
  hint?: ReactNode;
  issuePath?: string;
  className?: string;
  /** Visually hide the label (it is still the accessible name). */
  hideLabel?: boolean;
}

function Frame({
  id,
  label,
  hint,
  hintId,
  errorId,
  issuePath,
  hideLabel,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  hintId: string;
  errorId: string;
  issuePath: string;
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className={cn("text-small font-semibold text-ink", hideLabel && "sr-only")}>
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
      <FieldIssues path={issuePath} id={errorId} />
    </div>
  );
}

function useIds(name: string, issuePath: string | undefined, hint: ReactNode) {
  const base = useId();
  const id = `${base}-${name}`;
  const path = issuePath ?? name;
  const invalid = useHasIssue(path);
  const describedBy = [hint ? `${id}-hint` : null, invalid ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return { id, path, invalid, describedBy, hintId: `${id}-hint`, errorId: `${id}-error` };
}

/** A text-like input (text, email, url, number, password, datetime-local …). */
export function TextField({ label, name, hint, issuePath, className, hideLabel, ...input }: Common & Omit<ComponentProps<"input">, "name">) {
  const ids = useIds(name, issuePath, hint);
  return (
    <Frame id={ids.id} label={label} hint={hint} hintId={ids.hintId} errorId={ids.errorId} issuePath={ids.path} hideLabel={hideLabel} className={className}>
      <Input id={ids.id} name={name} aria-invalid={ids.invalid || undefined} aria-describedby={ids.describedBy} {...input} />
    </Frame>
  );
}

export function TextAreaField({ label, name, hint, issuePath, className, hideLabel, ...area }: Common & Omit<ComponentProps<"textarea">, "name">) {
  const ids = useIds(name, issuePath, hint);
  return (
    <Frame id={ids.id} label={label} hint={hint} hintId={ids.hintId} errorId={ids.errorId} issuePath={ids.path} hideLabel={hideLabel} className={className}>
      <Textarea id={ids.id} name={name} aria-invalid={ids.invalid || undefined} aria-describedby={ids.describedBy} {...area} />
    </Frame>
  );
}

export function SelectField({
  label,
  name,
  hint,
  issuePath,
  className,
  hideLabel,
  options,
  ...select
}: Common & Omit<ComponentProps<"select">, "name"> & { options: readonly { value: string; label: string }[] }) {
  const ids = useIds(name, issuePath, hint);
  return (
    <Frame id={ids.id} label={label} hint={hint} hintId={ids.hintId} errorId={ids.errorId} issuePath={ids.path} hideLabel={hideLabel} className={className}>
      <NativeSelect id={ids.id} name={name} aria-invalid={ids.invalid || undefined} aria-describedby={ids.describedBy} {...select}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </Frame>
  );
}

/** A checkbox with its label beside it, and an optional hint under the label. */
export function CheckboxField({ label, name, hint, issuePath, className, ...input }: Omit<Common, "hideLabel"> & Omit<ComponentProps<"input">, "name" | "type">) {
  const ids = useIds(name, issuePath, hint);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={ids.id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
        <input
          id={ids.id}
          type="checkbox"
          name={name}
          value="on"
          aria-invalid={ids.invalid || undefined}
          aria-describedby={ids.describedBy}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-(--color-action)"
          {...input}
        />
        <span className="flex flex-col gap-1">
          <span className="text-small font-semibold text-ink">{label}</span>
          {hint ? (
            <span id={ids.hintId} className="text-caption text-ink-3">
              {hint}
            </span>
          ) : null}
        </span>
      </label>
      <FieldIssues path={ids.path} id={ids.errorId} />
    </div>
  );
}
