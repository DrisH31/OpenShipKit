import "server-only";

//
// The read-only demo admin's account, and "Try the demo" (POST /api/demo).
// The rules are src/core/demo.ts and src/server/demo.ts; Better Auth's half
// is src/adapters/auth/better-auth/demo.ts. docs/auth.md → "The read-only demo admin".
//
// ensureDemoAccount() — idempotent; safe to call on every press:
//   1. The auth identity: a verified email + password user at
//      DEMO_ADMIN_EMAIL with DEMO_ADMIN_PASSWORD (Better Auth's own hash;
//      rotated when the variable changes; two-factor switched off).
//   2. Which identity is the demo's is written once to the audit log (entity
//      "demo_admin", the identity's id as entityId). An identity at that
//      address that the log doesn't name belongs to someone who signed up
//      with it: it is never touched or promoted, and the refusal is logged
//      loudly ("taken"): pick another DEMO_ADMIN_EMAIL, or delete that account.
//   3. The app's row: created or re-bound, and an admin (re-promoted if an
//      admin demoted it: to switch the demo off, unset the variables, or ban
//      the account — a ban is kept). Audited as actor "DEMO_ADMIN_EMAIL".
//
// When it runs: at boot on the embedded development database
// (src/instrumentation.ts), and before every "Try the demo" sign-in on any
// database — so a Postgres server needs no seed step, and an account deleted
// or demoted in /admin is back on the next press. Concurrent presses share
// one run.
//

import { DEMO_ACCOUNT_NAME, DEMO_SESSION_SECONDS } from "@/core/demo";
import type { Actor } from "@/core/types";
import { getAuth } from "../auth";
import { getData } from "../data";
import { demoAdminLogin } from "../env";

/** The audit entity that records which auth identity is the demo admin's. */
export const DEMO_ACCOUNT_ENTITY = "demo_admin";

const DEMO_ACTOR: Actor = { type: "system", id: null, label: "DEMO_ADMIN_EMAIL" };

/** off: not configured · ready: signed-in-able admin · taken: the address belongs to someone else · unsupported: the auth adapter can't. */
export type DemoAccountState = "off" | "ready" | "taken" | "unsupported";

async function ensure(): Promise<DemoAccountState> {
  const login = demoAdminLogin();
  if (!login) return "off";
  const auth = await getAuth();
  if (!auth.ensurePasswordIdentity) {
    console.warn("[demo] the auth adapter can't create password accounts; the read-only demo admin is off.");
    return "unsupported";
  }
  const data = await getData();
  const marker = (await data.audit.list({ entity: DEMO_ACCOUNT_ENTITY, limit: 1 })).items[0];
  const ownerId = marker?.entityId ?? null;

  const result = await auth.ensurePasswordIdentity({ email: login.email, password: login.password, name: DEMO_ACCOUNT_NAME, ownerId });
  if (result.status === "taken") {
    console.error(
      `[demo] REFUSED: ${login.email} (DEMO_ADMIN_EMAIL) already belongs to an account the demo didn't create (auth id ${result.providerUserId}). ` +
        "It was left untouched and not made an admin. Choose another DEMO_ADMIN_EMAIL, or delete that account in /admin/users.",
    );
    return "taken";
  }
  const { identity } = result;

  if (identity.providerUserId !== ownerId) {
    try {
      await data.audit.record({ actor: DEMO_ACTOR, action: "demo.account", entity: DEMO_ACCOUNT_ENTITY, entityId: identity.providerUserId, before: null, after: { email: identity.email } });
    } catch (error) {
      // Unrecorded, the next run would call it someone else's: take back what was just made.
      if (result.status === "created") await auth.deleteIdentity?.(identity.providerUserId).catch(() => {});
      throw error;
    }
  }

  const before = await data.users.getByEmail(identity.email);
  if (!before || before.role !== "admin" || before.authProviderUserId !== identity.providerUserId) {
    const user = await data.users.upsertFromIdentity(identity, { makeAdmin: true });
    if (!before) await data.audit.record({ actor: DEMO_ACTOR, action: "user.create", entity: "user", entityId: user.id, before: null, after: { email: user.email, role: user.role } });
    else if (before.role !== "admin") await data.audit.record({ actor: DEMO_ACTOR, action: "user.promote", entity: "user", entityId: user.id, before: { role: before.role }, after: { role: user.role } });
  }
  if (result.status !== "unchanged" || !before) console.info(`[demo] read-only demo admin ${identity.email} is ready (${result.status}).`);
  return "ready";
}

const g = globalThis as unknown as { __openshipkitDemoEnsure?: Promise<DemoAccountState> };

/** Make sure the demo admin exists, is an admin and signs in with DEMO_ADMIN_PASSWORD. Concurrent calls share one run. */
export function ensureDemoAccount(): Promise<DemoAccountState> {
  g.__openshipkitDemoEnsure ??= ensure().finally(() => {
    g.__openshipkitDemoEnsure = undefined;
  });
  return g.__openshipkitDemoEnsure;
}

/** ensureDemoAccount() without waiting, its failure logged (boot). */
export function ensureDemoAccountInBackground(reason: string): void {
  if (!demoAdminLogin()) return;
  ensureDemoAccount().catch((error) => console.error(`[demo] could not ready the read-only demo admin (${reason}); the next "Try the demo" retries.`, error));
}

export type DemoStart = { ok: true } | { ok: false; reason: "off" | "unavailable" };

/**
 * Sign this request's browser in as the demo admin (POST /api/demo): ensure
 * the account, then the auth adapter's password sign-in for a
 * DEMO_SESSION_SECONDS browser session. A refused sign-in (the account was
 * just deleted, the password rotated) ensures once more and retries once.
 */
export async function startDemoSession(): Promise<DemoStart> {
  const login = demoAdminLogin();
  if (!login) return { ok: false, reason: "off" };
  const auth = await getAuth();
  if (!auth.signInWithPassword) return { ok: false, reason: "unavailable" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await ensureDemoAccount();
    if (state !== "ready") return { ok: false, reason: state === "off" ? "off" : "unavailable" };
    try {
      await auth.signInWithPassword({ email: login.email, password: login.password, sessionSeconds: DEMO_SESSION_SECONDS });
      return { ok: true };
    } catch (error) {
      if (attempt === 1) {
        console.error("[demo] the demo sign-in was refused", error);
        return { ok: false, reason: "unavailable" };
      }
    }
  }
  return { ok: false, reason: "unavailable" };
}
