//
// /admin/agents — keys for the built-in MCP server (/api/mcp): mint one for an
// agent (shown once, with copy-paste configs), see when each was last used,
// revoke. Everything an agent does is audited under the key's name. While the
// local demo honours MCP_DEV_KEY (an admin key from .env.local), it is listed
// too, read-only, so the page never says no agent can reach the site when one can.
//
// Each key says who minted it (its createdBy, as that admin's email): demoting,
// banning or deleting that admin revokes it. A key with no recorded creator
// (the CLI, an older key, a deleted admin) says so, for review by hand.
// An Admin-scope key needs a fresh sign-in (./actions.ts); without one, the
// form says so and "Sign in again" comes back here.
//

import type { Metadata } from "next";
import { BotIcon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { StatusBadge } from "@/components/product/status-badge";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { MintKeyForm } from "@/components/admin/mint-key-form";
import { CopyValue } from "@/components/product/copy-value";
import { hasFreshSignIn } from "@/components/dashboard/fresh-sign-in";
import { Button } from "@/components/ui/button";
import { docUrl } from "@/lib/docs";
import { formatDateTime, relativeTime } from "@/lib/format";
import { mcpEndpoint } from "@/lib/mcp-snippets";
import { FRESH_SIGN_IN_MINUTES } from "@/lib/reauth";
import { optionalEnv, siteUrl } from "@/server/env";
import { devKeyAllowed } from "@/server/mcp/auth";
import { requireAdmin } from "@/server/session";
import { listAgentKeys } from "@/server/services/agent-keys";
import { maskEmailMap } from "@/shared/privacy-mask";
import { privacyLens } from "@/server/demo";
import { emailsByUserId } from "@/server/services/users";
import { mintKeyAction, revokeKeyAction, signInAgainForAgentKeys } from "./actions";
import { requireFeature } from "@/server/profile";

export const metadata: Metadata = { title: "Agent keys" };

const SCOPE_WORD = { read: "Read", write: "Write", admin: "Admin" } as const;

/** Is MCP_DEV_KEY live right now? Mirrors src/server/mcp/auth.ts: set, at least 24 characters, local demo only. */
function devKeyActive(): boolean {
  return devKeyAllowed() && (optionalEnv("MCP_DEV_KEY")?.length ?? 0) >= 24;
}

export default async function AgentsPage() {
  const admin = await requireAdmin();
  requireFeature("mcp"); // OPENSHIPKIT_WITHOUT=mcp: no agent keys to manage
  const lens = privacyLens(admin);
  const [keys, fresh] = await Promise.all([listAgentKeys(), hasFreshSignIn()]);
  // Masked for the read-only demo admin (src/shared/privacy-mask.ts).
  const creators = maskEmailMap(lens, await emailsByUserId(keys.flatMap((k) => (k.createdBy ? [k.createdBy] : []))));
  /** Who minted it: " by ada@example.com", or " · creator not recorded" (the CLI, an older key, a deleted admin). */
  const mintedBy = (createdBy: string | null) => {
    const email = createdBy ? creators[createdBy] : undefined;
    return email ? ` by ${email}` : " · creator not recorded";
  };
  const base = siteUrl();
  const now = new Date();
  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);
  const devKey = devKeyActive();

  return (
    <>
      <PageHeader
        title="Agent keys"
        answer={
          <>
            Let an AI agent run this site through its MCP server, at this address:
            <CopyValue value={mcpEndpoint(base)} srLabel="Copy the MCP server address" className="my-1 flex w-fit" />
            It works through the same validated, audited services as this panel.{" "}
            <a href={docUrl("mcp")} className="underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
              MCP guide
            </a>
          </>
        }
      />

      <section id="mint" aria-labelledby="mint-title" className="flex scroll-mt-20 flex-col gap-4 rounded-xl border border-line bg-card p-5 sm:p-6">
        <h2 id="mint-title" className="font-sans flex items-center gap-2 text-body font-semibold text-ink">
          <KeyRoundIcon aria-hidden className="size-4 text-ink-3" /> Mint a key
        </h2>
        <MintKeyForm action={mintKeyAction} siteUrl={base} adminNote={fresh ? undefined : `Needs a sign-in from the last ${FRESH_SIGN_IN_MINUTES} minutes.`} />
        {fresh ? null : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
            <p className="min-w-0 flex-1 text-small text-ink-2">
              To mint an Admin key, sign in again first. You’ll come straight back here, with {FRESH_SIGN_IN_MINUTES} minutes to mint it.
            </p>
            <form action={signInAgainForAgentKeys}>
              <Button type="submit" variant="outline" size="sm">
                Sign in again
              </Button>
            </form>
          </div>
        )}
      </section>

      <section aria-labelledby="keys-title" className="flex flex-col gap-3">
        <h2 id="keys-title" className="font-sans text-body font-semibold text-ink">
          Active keys
        </h2>
        {devKey ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card px-4 py-3">
            <TriangleAlertIcon aria-hidden className="size-5 shrink-0 text-warning" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink">
                MCP_DEV_KEY
                <StatusBadge label="Admin" tone="warning" />
              </p>
              <p className="text-caption text-ink-2">
                From <code className="font-mono">.env.local</code> · for the local demo only, ignored in production. Remove it from <code className="font-mono">.env.local</code> to
                turn it off.
              </p>
            </div>
          </div>
        ) : null}
        {active.length === 0 ? (
          <EmptyState title="No minted keys" body="Mint one above, then paste the config into your agent. Keys are stored only as a hash." />
        ) : (
          <ul className="flex flex-col rounded-xl border border-line bg-card">
            {active.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                <BotIcon aria-hidden className="size-5 shrink-0 text-ink-3" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink">
                    {k.name}
                    <StatusBadge label={SCOPE_WORD[k.scope]} tone={k.scope === "admin" ? "warning" : k.scope === "write" ? "info" : "neutral"} />
                  </p>
                  <p className="text-caption text-ink-3">
                    <span className="font-mono">…{k.hint}</span> · minted {formatDateTime(k.createdAt)}
                    {mintedBy(k.createdBy)} ·{" "}
                    {k.lastUsedAt ? <span title={formatDateTime(k.lastUsedAt)}>used {relativeTime(k.lastUsedAt, now)}</span> : "never used"}
                  </p>
                </div>
                <ConfirmAction
                  action={revokeKeyAction.bind(null, k.id)}
                  trigger="Revoke"
                  triggerVariant="outline"
                  triggerLabel={`Revoke ${k.name}`}
                  title={`Revoke “${k.name}”?`}
                  description="Any agent using this key is refused from its next request. This can’t be undone; mint a new key if you need one."
                  confirmLabel="Revoke key"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {revoked.length ? (
        <section aria-labelledby="revoked-title" className="flex flex-col gap-3">
          <h2 id="revoked-title" className="font-sans text-small font-semibold text-ink-2">
            Revoked
          </h2>
          <ul className="flex flex-col gap-1 text-small text-ink-3">
            {revoked.map((k) => (
              <li key={k.id}>
                {k.name} <span className="font-mono">…{k.hint}</span> · revoked {formatDateTime(k.revokedAt)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
