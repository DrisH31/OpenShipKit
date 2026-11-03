"use client";

//
// The pieces every auth form shares: a labelled text field, a password field
// with a show/hide toggle, the submit button (loading while the action runs)
// and the message area.
//
// Errors are tied to their inputs with aria-describedby + aria-invalid; the
// form-level message is a live region so screen readers hear the result.
//
// This is the AUTH kit: plain useActionState forms whose action returns
// AuthFormState (src/core/auth-forms.ts), with errors passed in as props.
// Dashboard and admin forms use the PRODUCT kit instead —
// src/components/product/action-form.tsx (<ActionForm>, SubmitButton,
// FormMessage) and form-fields.tsx (TextField, CheckboxField …), which read
// an ActionState from context. The two don't mix, so the colliding names
// here carry an Auth prefix (AuthTextField, AuthCheckboxField,
// AuthSubmitButton, AuthFormMessage). Folding this kit into the product kit
// is planned; until then, a fix to field accessibility belongs in both.
//

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AuthFormState } from "@/core/auth-forms";

export function AuthTextField({
  name,
  label,
  error,
  defaultValue,
  type = "text",
  autoComplete,
  required,
  autoFocus,
  hint,
}: {
  name: string;
  label: string;
  error?: string;
  defaultValue?: string;
  type?: "text" | "email";
  autoComplete?: string;
  required?: boolean;
  autoFocus?: boolean;
  hint?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        // React resets a form after its action runs and the value comes back
        // as a new defaultValue; Base UI only reads it on mount, so remount.
        key={defaultValue ?? ""}
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        autoComplete={autoComplete}
        required={required}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        spellCheck={type === "email" ? false : undefined}
        autoCapitalize={type === "email" ? "none" : undefined}
      />
      {hint ? (
        <p id={hintId} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}

export function PasswordField({
  name = "password",
  label = "Password",
  error,
  autoComplete,
  hint,
  labelAside,
}: {
  name?: string;
  label?: string;
  error?: string;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  /** Rendered at the end of the label row — the "Forgot password?" link. */
  labelAside?: React.ReactNode;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {labelAside}
      </div>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={autoComplete === "new-password" ? 8 : undefined}
          maxLength={128}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="pr-12"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // A toggle keeps one label; aria-pressed says whether it is on
          // ("Show password, pressed" while the password is visible).
          aria-pressed={visible}
          aria-label="Show password"
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-ink-3 transition-colors duration-(--dur-hover) hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}

/**
 * A one-time code: six digits from an authenticator app, or a backup code.
 * Numeric keyboard and OS code autofill for the app code; plain text for backup codes.
 */
export function CodeField({
  name = "code",
  label,
  error,
  kind,
  autoFocus,
  hint,
}: {
  name?: string;
  label: string;
  error?: string;
  kind: "totp" | "backup";
  autoFocus?: boolean;
  hint?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        type="text"
        required
        autoFocus={autoFocus}
        autoComplete={kind === "totp" ? "one-time-code" : "off"}
        inputMode={kind === "totp" ? "numeric" : "text"}
        maxLength={kind === "totp" ? 9 : 64}
        spellCheck={false}
        autoCapitalize="none"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn("font-mono tracking-widest", kind === "totp" && "text-center text-lead")}
      />
      {hint ? (
        <p id={hintId} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}

/** A native checkbox (so it works before hydration and without JavaScript), with a 44px row as its target. */
export function AuthCheckboxField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-small text-ink">
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="size-5 shrink-0 cursor-pointer rounded-sm accent-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      {label}
    </label>
  );
}

/** The form's one primary action. Shows a spinner (and stays focusable) while the action runs. */
export function AuthSubmitButton({ children, className, variant = "default" }: { children: React.ReactNode; className?: string; variant?: "default" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" data-rank="2" size="lg" variant={variant} loading={pending} className={cn("w-full", className)}>
      {children}
    </Button>
  );
}

/**
 * A number per state object. Every submit's action returns a NEW state object, even when it
 * says exactly what the last one said, so the message node can be keyed on it: the same
 * failure twice in a row ("Wrong email or password") replaces the node, and a screen reader
 * hears it again instead of a live region whose text never changed. Idempotent per object,
 * so a re-render of the same state keeps the same node.
 */
const submitTokens = new WeakMap<object, number>();
let lastSubmitToken = 0;
function submitToken(state: object): number {
  let token = submitTokens.get(state);
  if (token === undefined) {
    token = ++lastSubmitToken;
    submitTokens.set(state, token);
  }
  return token;
}

/**
 * The result of the last submit: an error, or a confirmation ("check your inbox"). Pass the
 * state object useActionState returned (or one memoised on it): its identity is what tells
 * one submit from the next.
 */
export function AuthFormMessage({ state, className }: { state: Pick<AuthFormState, "status" | "message">; className?: string }) {
  // Always rendered, so the live region exists before the message arrives.
  const tone = state.status === "error" ? "error" : state.status === "idle" ? null : "ok";
  return (
    <div aria-live="polite" role="status" className={cn(!state.message && "sr-only", className)}>
      {state.message && tone ? (
        <p
          key={submitToken(state)}
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2.5 text-small",
            tone === "error" ? "border-danger-line bg-danger-soft text-badge-danger" : "border-line bg-positive-soft text-badge-positive",
          )}
        >
          {tone === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>{state.message}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Hidden input carrying the validated return path through a form post. */
export function RedirectInput({ value }: { value: string }) {
  return <input type="hidden" name="redirectTo" value={value} />;
}
