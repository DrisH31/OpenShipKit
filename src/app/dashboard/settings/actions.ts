"use server";

//
// Account settings. Every action starts with requireUser(); then either an app
// service (profile, delete account) or one of Better Auth's account functions
// (password, sessions, two-factor — src/adapters/auth/better-auth/actions.ts),
// whose AuthFormState is translated into the ActionState every dashboard form
// speaks, so one form component shows both kinds of errors the same way.
//

import { refresh } from "next/cache";
import { failure, success, type ActionState } from "@/lib/action-state";
import { attempt } from "@/server/attempt";
import { text } from "@/lib/form-data";
import { FRESH_SIGN_IN_MINUTES, signedInRecently } from "@/lib/reauth";
import type { AuthFormState } from "@/components/auth/form-state";
import {
  changePassword as authChangePassword,
  confirmTwoFactorSetup,
  getAccountSecurity,
  disableTwoFactor as authDisableTwoFactor,
  regenerateBackupCodes as authRegenerateBackupCodes,
  revokeOtherSessions as authRevokeOtherSessions,
  revokeSession as authRevokeSession,
  signOutAction,
  startTwoFactorSetup,
} from "@/adapters/auth/better-auth/actions";
import { DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import { isDemoUser } from "@/server/demo";
import { actorFor, requireUser } from "@/server/session";
import { deleteUser, updateOwnProfile } from "@/server/services/users";

const START: AuthFormState = { status: "idle" };

/** AuthFormState → ActionState: field errors become issues by input name; set-up data rides in `data`. */
function fromAuth(state: AuthFormState): ActionState {
  const issues = Object.entries(state.fieldErrors ?? {})
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")
    .map(([path, message]) => ({ path, message }));
  if (state.status === "error") return failure(state.message ?? issues[0]?.message ?? "That didn’t work. Check the form and try again.", issues);
  const data: NonNullable<ActionState["data"]> = {};
  if (state.twoFactorSetup) {
    data.totpURI = state.twoFactorSetup.totpURI;
    data.secret = state.twoFactorSetup.secret;
    data.backupCodes = state.twoFactorSetup.backupCodes;
  }
  if (state.backupCodes) data.backupCodes = state.backupCodes;
  if (state.status === "pending") data.pending = true;
  return success(state.message ?? "Saved.", Object.keys(data).length ? data : undefined);
}

/**
 * Run one of the auth engine's account actions. `refreshAfter` re-renders the
 * page in this same request — wrong for actions that ROTATE the session
 * (password change, two-factor on/off): this request still carries the old,
 * now-deleted cookie, so its render would look signed out. Those return
 * `data.refresh` instead and the form refreshes once the new cookie is set.
 */
async function viaAuth(fn: (s: AuthFormState, f: FormData) => Promise<AuthFormState>, form: FormData, refreshAfter = true): Promise<ActionState> {
  await requireUser("/dashboard/settings");
  const result = fromAuth(await fn(START, form));
  if (result.ok && refreshAfter) refresh();
  if (result.ok && !refreshAfter) result.data = { ...result.data, refresh: true };
  return result;
}

/** Display name. Email is the sign-in identity and is not edited here. */
export async function saveProfile(_state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser("/dashboard/settings");
  const name = text(form, "name");
  if (name.length > 80) return failure("Use 80 characters or fewer.", [{ path: "name", message: "Use 80 characters or fewer." }]);
  return attempt("dashboard.settings.profile", async () => {
    await updateOwnProfile(user, { name: name || null });
    refresh();
    return name ? "Your name is saved." : "Your name is cleared.";
  });
}

export async function changePassword(_state: ActionState, form: FormData): Promise<ActionState> {
  return viaAuth(authChangePassword, form, false);
}

export async function revokeSession(_state: ActionState, form: FormData): Promise<ActionState> {
  return viaAuth(authRevokeSession, form);
}

export async function revokeOtherSessions(_state: ActionState, form: FormData): Promise<ActionState> {
  return viaAuth(authRevokeOtherSessions, form);
}

/** Step 1: password → secret, otpauth URI and backup codes (returned once, in `data`). Nothing is on yet. */
export async function beginTwoFactor(_state: ActionState, form: FormData): Promise<ActionState> {
  return viaAuth(startTwoFactorSetup, form, false);
}

/** Step 2: the first code from the app turns two-factor on. */
export async function finishTwoFactor(_state: ActionState, form: FormData): Promise<ActionState> {
  return viaAuth(confirmTwoFactorSetup, form, false);
}

export async function turnOffTwoFactor(_state: ActionState, form: FormData): Promise<ActionState> {
  return viaAuth(authDisableTwoFactor, form, false);
}

export async function newBackupCodes(_state: ActionState, form: FormData): Promise<ActionState> {
  return viaAuth(authRegenerateBackupCodes, form, false);
}

/**
 * Delete the account: the app's row (and by cascade billing rows), the Better
 * Auth user with its sessions, then the cookies, then home. Two checks first:
 * this browser signed in within FRESH_SIGN_IN_MINUTES (src/lib/reauth.ts —
 * a live session alone isn't enough for something that can't be undone), and
 * the person types their email. The last admin can't delete themselves (the
 * service refuses), so a site is never left without one.
 */
export async function deleteAccount(_state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser("/dashboard/settings");
  // Said first, before the fresh-sign-in and confirm checks (deleteUser refuses it as well).
  if (isDemoUser(user)) return failure(DEMO_READ_ONLY_MESSAGE);
  const security = await getAccountSecurity();
  const session = security?.sessions.find((s) => s.current);
  if (!security || !session) return failure("You’re signed out. Sign in again to continue.");
  if (!signedInRecently(session.createdAt)) {
    return failure(`For your safety, deleting needs a fresh sign-in. Reload this page and choose “Sign in again to delete”, then delete within ${FRESH_SIGN_IN_MINUTES} minutes.`);
  }
  if (text(form, "confirm").toLowerCase() !== user.email.toLowerCase()) {
    return failure("Type your email exactly to confirm.", [{ path: "confirm", message: `Type ${user.email} to confirm.` }]);
  }
  const result = await attempt("dashboard.settings.delete", async () => {
    await deleteUser(user.id, actorFor(user));
    return "Your account is deleted.";
  });
  if (!result.ok) return result;
  await signOutAction(); // clears the session cookies and redirects home; never returns
  return result;
}

/** Where "Sign in again to delete" comes back to: the delete card (its email field takes focus there). */
const DELETE_ACCOUNT_RETURN = "/dashboard/settings#danger";

/**
 * The fresh sign-in that deleting needs: sign out, then the sign-in page,
 * which brings the person straight back to the delete card. signOutAction
 * takes the way back as its form's `redirectTo` and never returns.
 */
export async function signInAgainToDelete(): Promise<void> {
  await requireUser("/dashboard/settings");
  const form = new FormData();
  form.set("redirectTo", `/sign-in?redirect=${encodeURIComponent(DELETE_ACCOUNT_RETURN)}`);
  await signOutAction(form);
}
