"use server";

//
// MCP agent keys: mint and revoke. requireAdmin() first. A minted key comes
// back ONCE, in the action's result (data.key), for the page to show with
// ready-to-paste client configs; only its SHA-256 is stored.
//
// An ADMIN-scope key needs a fresh sign-in (FRESH_SIGN_IN_MINUTES,
// src/lib/reauth.ts), as deleting an account does: a live session alone isn't
// enough, or a copied admin cookie could mint itself a key that outlives the
// session. "Sign in again" (signInAgainForAgentKeys) comes back to this page.
//

import { refresh } from "next/cache";
import { failure, type ActionState } from "@/lib/action-state";
import { attempt } from "@/server/attempt";
import { text } from "@/lib/form-data";
import { FRESH_SIGN_IN_MINUTES } from "@/lib/reauth";
import { hasFreshSignIn, signInAgainTo } from "@/components/dashboard/fresh-sign-in";
import { actorFor, requireAdmin } from "@/server/session";
import { mintAgentKey, revokeAgentKey } from "@/server/services/agent-keys";

/** Where "Sign in again" returns: the mint form. */
const MINT_RETURN = "/admin/agents#mint";

export async function mintKeyAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const scope = text(form, "scope") || "write";
  if (scope === "admin" && !(await hasFreshSignIn())) {
    return failure(`An Admin key needs a fresh sign-in. Choose “Sign in again” below, then mint within ${FRESH_SIGN_IN_MINUTES} minutes.`);
  }
  return attempt("admin.agents.mint", async () => {
    const { key, agentKey } = await mintAgentKey(text(form, "name"), scope, actorFor(admin));
    refresh();
    return { message: `“${agentKey.name}” is ready. Copy the key now: it won’t be shown again.`, data: { key, name: agentKey.name, scope: agentKey.scope } };
  });
}

export async function revokeKeyAction(id: string): Promise<ActionState> {
  const admin = await requireAdmin();
  return attempt("admin.agents.revoke", async () => {
    const key = await revokeAgentKey(id, actorFor(admin));
    refresh();
    return `“${key.name}” is revoked. Agents using it are refused from now on.`;
  });
}

/** The fresh sign-in an Admin key needs: sign out, sign in, back to the mint form. */
export async function signInAgainForAgentKeys(): Promise<void> {
  await requireAdmin();
  await signInAgainTo(MINT_RETURN);
}
