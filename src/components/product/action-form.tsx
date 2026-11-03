"use client";

//
// <ActionForm> — the one way a dashboard or admin form talks to its server
// action. Server pages compose it with ordinary inputs; it supplies:
//
//   - progressive enhancement: the <form action> is the server action, so the
//     form posts and re-renders with its result even before JavaScript loads;
//   - with JavaScript, submit is intercepted and the server action is called
//     directly in a transition: React does NOT reset the fields afterwards (a
//     failed save keeps what was typed), and the result is handled the moment
//     it arrives — the toast and onResult fire even when the refresh that
//     follows removes this very form (a revoked session's row, a triaged item);
//   - the result in context: <FormMessage> says it inline, <FieldIssues path>
//     shows a field's own errors, <SubmitButton> shows pending;
//   - a success toast (and the failure inline, where the eye is);
//   - focus that lands somewhere: a failure with field issues focuses the
//     first invalid field; a success whose refresh removes the control that
//     had focus moves it on (src/lib/focus.ts) — to `focusNext` (the same
//     control in the next row), then `focusAfter` selectors, then the
//     nearest heading — instead of dropping it to <body>.
//
// `resetOnSuccess` clears the form after a good result (a "send feedback" box).
// `after` renders a follow-up (itself a form) from the result. A result with
// `data.refresh` re-renders the page from the browser after it lands.
//

import { createContext, useActionState, useContext, useEffect, useRef, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast as notify } from "sonner";
import { Button } from "@/components/ui/button";
import { IDLE, failure, issuesAt, type ActionState } from "@/lib/action-state";
import { focusFirstInvalid, keepFocus, type FocusNext } from "@/lib/focus";
import { cn } from "@/lib/utils";

/** A server action as an ActionForm receives it (bind any ids first). */
export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

interface FormCtx {
  state: ActionState;
  pending: boolean;
}

const Ctx = createContext<FormCtx>({ state: IDLE, pending: false });

/** The current form's last result and pending flag. */
export function useActionForm(): FormCtx {
  return useContext(Ctx);
}

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  toast = true,
  onResult,
  after,
  focusNext,
  focusAfter,
  ...rest
}: Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  action: FormAction;
  children: ReactNode;
  resetOnSuccess?: boolean;
  /** Toast successes (default). Off for forms whose result replaces the form itself. */
  toast?: boolean;
  /** Called once per new result. */
  onResult?: (state: ActionState) => void;
  /**
   * Rendered after the <form>, inside the same context, from the result —
   * for a next step that is itself a form (forms can't nest). Server-rendered
   * too, so it works without JavaScript.
   */
  after?: (state: ActionState) => ReactNode;
  /** After a success that removes this form's row: focus `target` in the next row (else the previous). */
  focusNext?: FocusNext;
  /** After a success that removes the focused control: selectors to try, in order, before the nearest heading. */
  focusAfter?: string | readonly string[];
}) {
  // `served`: the result of a no-JavaScript post, rendered by the server. `live`: results with JavaScript.
  const [served, formAction] = useActionState(action, IDLE);
  const [live, setLive] = useState<ActionState | null>(null);
  const [pending, startPending] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const state = live && live.at >= served.at ? live : served;
  // Set when a failure with field issues arrives; the effect below focuses the first invalid field once it renders.
  const showInvalid = useRef(false);

  useEffect(() => {
    if (!showInvalid.current) return;
    showInvalid.current = false;
    focusFirstInvalid(form.current);
  }, [state]);

  const submit = (data: FormData) => {
    const hadFocus = Boolean(form.current?.contains(document.activeElement));
    startPending(async () => {
      let result: ActionState | undefined;
      try {
        result = await action(state, data);
      } catch (error) {
        // Next's own navigations (a redirect from the action) are handled by the router.
        if (typeof (error as { digest?: unknown })?.digest === "string" && String((error as { digest: string }).digest).startsWith("NEXT_")) throw error;
        // eslint-disable-next-line no-console -- a client component: this is the browser console
        console.error(error);
        result = failure("We couldn’t reach the server, so nothing was saved. Check your connection and try again.");
      }
      if (!result) return; // the action redirected
      if (result.ok && (hadFocus || form.current?.contains(document.activeElement))) {
        keepFocus(form.current, { next: focusNext, targets: typeof focusAfter === "string" ? [focusAfter] : focusAfter });
      }
      if (!result.ok && result.issues?.some((i) => i.path !== "")) showInvalid.current = true;
      setLive(result);
      if (result.ok && toast && result.message) notify.success(result.message);
      if (result.ok && resetOnSuccess) form.current?.reset();
      // The action asked for a fresh render once its cookies are in place (a rotated session).
      if (result.ok && result.data?.refresh === true) router.refresh();
      onResult?.(result);
    });
  };

  return (
    <Ctx.Provider value={{ state, pending }}>
      <form
        ref={form}
        action={formAction}
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter));
        }}
        aria-busy={pending || undefined}
        className={className}
        {...rest}
      >
        {children}
      </form>
      {after ? after(state) : null}
    </Ctx.Provider>
  );
}

/** The form's result as one sentence: a status on success, an alert on failure. */
export function FormMessage({ className, hideSuccess = false }: { className?: string; hideSuccess?: boolean }) {
  const { state } = useActionForm();
  if (!state.at || !state.message || (state.ok && hideSuccess)) {
    // Keep the live region mounted so the next result is announced.
    return <p role="status" aria-live="polite" className="sr-only" />;
  }
  const Icon = state.ok ? CircleCheckIcon : TriangleAlertIcon;
  return (
    // Keyed on the attempt: the same sentence twice (a second wrong password)
    // is a new node, so a screen reader announces it again.
    <p
      key={state.at}
      role={state.ok ? "status" : "alert"}
      aria-live={state.ok ? "polite" : "assertive"}
      className={cn("flex items-start gap-2 text-small", state.ok ? "text-positive" : "text-danger", className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{state.message}</span>
    </p>
  );
}

/**
 * For a form that ends in a `sticky bottom-0` save bar (marked `data-sticky-save`):
 * every control outside the bar scrolls into view with room for the bar below
 * it, so the bar never covers the field that has focus (WCAG 2.4.11).
 */
export const CLEAR_OF_STICKY_BAR = "[&_:is(input,textarea,select,button,a,[tabindex]):not([data-sticky-save]_*)]:scroll-mb-28";

/** The errors the server returned for one field path ("title", "prices.0.amountCents"). */
export function FieldIssues({ path, id, className }: { path: string; id?: string; className?: string }) {
  const { state } = useActionForm();
  const messages = state.ok ? [] : issuesAt(state.issues, path);
  if (!messages.length) return null;
  return (
    <p id={id} className={cn("flex items-start gap-1.5 text-small text-danger", className)}>
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{messages.join(" ")}</span>
    </p>
  );
}

/** True when the last result has an issue at `path` — for aria-invalid. */
export function useHasIssue(path: string): boolean {
  const { state } = useActionForm();
  return !state.ok && issuesAt(state.issues, path).length > 0;
}

/** A design-system submit button that shows the form's pending state. */
export function SubmitButton({ children, ...props }: ComponentProps<typeof Button>) {
  const { pending } = useActionForm();
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}
