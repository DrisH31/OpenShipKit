"use client";

//
// Mint an MCP agent key: a name (which agent, on which machine) and a scope.
// The new key is shown ONCE, under the form, with configs for Claude Code,
// Cursor and any other MCP client — each with a copy button. The endpoint is
// built from the site's own URL (NEXT_PUBLIC_SITE_URL), passed in.
//
// An Admin key needs a fresh sign-in (the action refuses otherwise); the page
// passes `adminNote` to say so under that scope, and offers "Sign in again".
//
// The reveal takes focus when it appears: its heading ("Copy “name” now")
// is its name, so a screen reader hears that a one-time key is on the page
// and lands where it can be copied; there is no toast to miss.
//

import { useEffect, useRef, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { TextField } from "@/components/product/form-fields";
import { CopyButton } from "@/components/product/copy-button";
import { mcpSnippets } from "@/lib/mcp-snippets";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

const SCOPES = [
  { value: "read", label: "Read", body: "Read content, posts, plans and feedback. Changes nothing." },
  { value: "write", label: "Write", body: "Read, plus edit and publish content, posts and plans, and triage feedback." },
  { value: "admin", label: "Admin", body: "Write, plus users, roles, subscribers and agent keys. Only for agents you fully trust." },
] as const;

function Reveal({ state, siteUrl }: { state: ActionState; siteUrl: string }) {
  const key = typeof state.data?.key === "string" ? state.data.key : "";
  const snippets = mcpSnippets(siteUrl, key);
  const [tab, setTab] = useState<string>(snippets[0].id);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.focus();
  }, []);
  if (!key) return null;
  const current = snippets.find((s) => s.id === tab) ?? snippets[0];
  return (
    <section ref={section} tabIndex={-1} aria-labelledby="new-key-title" aria-describedby="new-key-note" className="mt-4 flex flex-col gap-4 rounded-xl border border-line-strong bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="flex flex-col gap-1">
          <h3 id="new-key-title" className="font-sans text-small font-semibold text-ink">
            Copy “{String(state.data?.name ?? "")}” now
          </h3>
          <p id="new-key-note" className="text-small text-ink-2">This is the only time the key is shown. Lose it, and you revoke it and mint another.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 font-mono text-caption break-all text-ink">{key}</code>
        <CopyButton value={key} label="Copy key" srLabel="Copy the agent key" />
      </div>
      <div className="flex flex-col gap-2">
        <div role="tablist" aria-label="Client" className="inline-flex w-fit gap-1 rounded-full bg-tonal p-1">
          {snippets.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`snippet-tab-${s.id}`}
              aria-selected={s.id === current.id}
              aria-controls="snippet-panel"
              tabIndex={s.id === current.id ? 0 : -1}
              onClick={() => setTab(s.id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                const i = snippets.findIndex((x) => x.id === current.id);
                const next = snippets[(i + (e.key === "ArrowRight" ? 1 : -1) + snippets.length) % snippets.length];
                setTab(next.id);
                document.getElementById(`snippet-tab-${next.id}`)?.focus();
              }}
              className={cn("inline-flex h-8 items-center rounded-full px-3 text-small font-semibold text-ink-2 hover:text-ink pointer-coarse:h-11", s.id === current.id && "bg-raised text-ink shadow-sm dark:bg-surface")}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div id="snippet-panel" role="tabpanel" aria-labelledby={`snippet-tab-${current.id}`} className="flex flex-col gap-2">
          <p className="text-small text-ink-2">{current.where}</p>
          {/* A focusable, named region, so a keyboard can scroll a long line in every browser (as CodePanel);
              the soft right edge (.scroll-shade, in the pre's own colour) says there is more. */}
          <pre
            tabIndex={0}
            role="region"
            aria-label={`${current.label} config`}
            className="scroll-shade overflow-x-auto rounded-md border border-line p-3 font-mono text-caption text-ink [--scroll-cover:var(--bg)] focus-visible:outline-offset-[-2px]"
          >
            <code>{current.code}</code>
          </pre>
          <div>
            <CopyButton value={current.code} label="Copy config" srLabel={`Copy the ${current.label} config`} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function MintKeyForm({
  action,
  siteUrl,
  adminNote,
}: {
  action: FormAction;
  siteUrl: string;
  /** Added under the Admin scope's description: why it can't be minted right now ("Needs a sign-in from the last 15 minutes."). */
  adminNote?: string;
}) {
  return (
    <ActionForm action={action} resetOnSuccess toast={false} className="flex flex-col gap-4" after={(state) => (state.ok ? <Reveal key={state.at} state={state} siteUrl={siteUrl} /> : null)}>
      <TextField label="Name" name="name" required maxLength={60} placeholder="Claude Code on my laptop" hint="Which agent, on which machine, so you know what to revoke later." className="max-w-md" />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-small font-semibold text-ink">What it may do</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {SCOPES.map((s) => (
            <label key={s.value} className="flex cursor-pointer gap-3 rounded-lg border border-line p-3 hover:bg-tonal has-[:checked]:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus">
              <input type="radio" name="scope" value={s.value} defaultChecked={s.value === "write"} className="mt-0.5 size-4 shrink-0 accent-(--color-action)" />
              <span className="flex flex-col gap-0.5">
                <span className="text-small font-semibold text-ink">{s.label}</span>
                <span className="text-caption text-ink-3">
                  {s.body}
                  {s.value === "admin" && adminNote ? <span className="mt-1 block font-semibold text-ink-2">{adminNote}</span> : null}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Mint key</SubmitButton>
        <FormMessage hideSuccess />
      </div>
    </ActionForm>
  );
}
