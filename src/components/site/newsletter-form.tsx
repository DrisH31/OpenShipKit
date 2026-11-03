"use client";

//
// The footer's email signup. A plain <form method="post"> to /api/forms/newsletter,
// so it works with JavaScript off: the route answers with a 303 back to this page
// and ?newsletter=<status>, which is read here. With JavaScript, the same POST is
// sent with fetch and the answer is shown in place (UI-17), without a reload.
//
// The honeypot (HoneypotField) is off-screen and out of the tab order; a person
// never fills it, a naive bot does.
//
// Laid out as one card: a title and one line on what you'll get, then ONE joined
// control — the email field and Subscribe inside a single pill, so the field and
// its action read as one thing — then the status line. Subscribe is tonal, not
// the accent: the footer sits under the page's closing call to action, and a
// second solid accent there would compete with it. The field is 16 px on touch
// screens (no zoom on focus in iOS) and 14 px with a fine pointer.
//

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HoneypotField } from "./honeypot-field";

type Status = "ok" | "invalid" | "limited" | "error";

const MESSAGES: Record<Status, string> = {
  ok: "You’re on the list. One email when there’s something worth reading.",
  invalid: "That email address doesn’t look right. Check it and try again.",
  limited: "Too many tries from this network. Wait a few minutes and try again.",
  error: "Something went wrong on our side. Please try again.",
};

function isStatus(v: string | null): v is Status {
  return v === "ok" || v === "invalid" || v === "limited" || v === "error";
}

export function NewsletterForm({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const fromUrl = params?.get("newsletter") ?? null;
  const [status, setStatus] = useState<Status | null>(isStatus(fromUrl) ? fromUrl : null);
  const [sending, setSending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setSending(true);
    try {
      const res = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; status?: string } | null;
      const next: Status = res.ok && body?.ok ? "ok" : isStatus(body?.status ?? null) ? (body!.status as Status) : "error";
      setStatus(next);
      if (next === "ok") form.reset();
    } catch {
      setStatus("error");
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      id="newsletter"
      method="post"
      action="/api/forms/newsletter"
      onSubmit={onSubmit}
      className={cn("flex flex-col rounded-2xl border border-line-strong bg-surface p-5", className)}
    >
      <label htmlFor="newsletter-email" className="text-small font-semibold text-ink">
        Get the changelog by email
      </label>
      <p className="mt-1 text-small text-ink-2">One email when a release ships. Nothing else.</p>
      <div
        className={cn(
          "mt-4 flex items-center gap-1 rounded-full border border-field bg-bg p-1 transition-[border-color] duration-(--dur-hover)",
          "focus-within:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
          status === "invalid" && "border-danger",
        )}
      >
        <input
          id="newsletter-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          aria-invalid={status === "invalid" || undefined}
          // On the field, not the form: refocusing it after an error reads the reason with it.
          aria-describedby="newsletter-status"
          className="h-9 min-w-0 flex-1 bg-transparent pl-3 text-body text-ink outline-none placeholder:text-ink-3 pointer-coarse:h-10 pointer-fine:text-small"
        />
        <input type="hidden" name="redirect" value={pathname} />
        <HoneypotField />
        <Button type="submit" variant="secondary" size="sm" loading={sending} className="h-9 shrink-0 pointer-coarse:h-10">
          Subscribe
        </Button>
      </div>
      <p
        id="newsletter-status"
        role="status"
        aria-live="polite"
        className={cn("mt-3 min-h-5 text-small", status === "ok" ? "text-positive" : status ? "text-danger" : "text-ink-3")}
      >
        {status ? MESSAGES[status] : "No spam. Unsubscribe from any email."}
      </p>
    </form>
  );
}
