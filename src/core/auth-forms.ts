//
// The auth form contract: the state every auth form's server action returns
// (React's useActionState). Plain data with no imports — safe in client
// components, server actions and adapters alike.
//
// Shared by three layers, which is why it lives in src/core:
//   src/adapters/auth/better-auth/actions.ts   returns it
//   src/components/auth/*                      renders it
//   src/app/dashboard/settings/actions.ts      returns it for account forms
//
// The account-settings actions (change password, sessions, two-factor) return
// this shape too, so the dashboard's forms work the same way: post without
// JavaScript, inline errors with it.
//

export type AuthFormStatus =
  /** Nothing submitted yet. */
  | "idle"
  | "error"
  /** An email went out ("check your inbox"). */
  | "sent"
  /** The change is made. */
  | "done"
  /** A step is half-way: two-factor setup is waiting for the first code. */
  | "pending";

/** Every field name an auth or account form uses. */
export type AuthFieldName = "name" | "email" | "password" | "confirm" | "code" | "currentPassword" | "newPassword";

/** What the authenticator-app setup step hands back (shown once, never stored by the page). */
export interface TwoFactorSetup {
  /** otpauth:// URI — render it as a QR code, or link it for phone browsers. */
  totpURI: string;
  /** The base32 secret inside the URI, for typing into an app by hand. */
  secret: string;
  /** One-time recovery codes. Shown once; the person must save them. */
  backupCodes: string[];
}

export interface AuthFormState {
  status: AuthFormStatus;
  /** One sentence for the form's message area (errors and confirmations). */
  message?: string;
  /** Per-field messages, keyed by the input's name. */
  fieldErrors?: Partial<Record<AuthFieldName, string>>;
  /** What the person typed (never a password or code), so a no-JS round-trip keeps it. */
  values?: { name?: string; email?: string };
  /** Set by startTwoFactorSetup (status "pending"). */
  twoFactorSetup?: TwoFactorSetup;
  /** Fresh backup codes, from confirmTwoFactorSetup or regenerateBackupCodes. */
  backupCodes?: string[];
}

export const IDLE: AuthFormState = { status: "idle" };

/** A server action as an auth form receives it. */
export type AuthFormAction = (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
