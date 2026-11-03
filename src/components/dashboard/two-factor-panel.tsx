"use client";

//
// Two-factor sign-in (TOTP + backup codes), on Better Auth's two-factor plugin.
//
//   Off → password → setup: the key to add to an authenticator app (typed in,
//         or opened straight in the app from a phone), the backup codes to
//         save, then the first 6-digit code. Two-factor is on only after that
//         code is accepted.
//   On  → new backup codes (password), or turn it off (password).
//
// Secrets and codes arrive in the action's result and live only in this
// render; nothing here stores them. There is no QR code yet (no encoder in the
// dependencies): the key is grouped for typing, and the otpauth:// link opens
// the authenticator app on a phone.
//
// Turning it on or off swaps the whole panel: focus moves to the new panel's
// status line (#two-factor-status), which says what is now true.
//
// Each password + button pair is one row of the same width as the other
// settings forms (max-w-md), so the cards' right edges line up.
//

import { useMemo } from "react";
import { DownloadIcon, KeyRoundIcon } from "lucide-react";
import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { TextField } from "@/components/product/form-fields";
import { CopyButton } from "@/components/product/copy-button";
import { StatusBadge } from "@/components/product/status-badge";
import { buttonVariants } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";

export interface TwoFactorActions {
  begin: FormAction;
  finish: FormAction;
  off: FormAction;
  codes: FormAction;
}

const group = (secret: string) => secret.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") ?? secret;

function codesOf(state: ActionState): string[] {
  const v = state.data?.backupCodes;
  return Array.isArray(v) ? v : [];
}

function BackupCodes({ codes, product }: { codes: string[]; product: string }) {
  const file = useMemo(() => {
    const body = `${product} backup codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
    return `data:text/plain;charset=utf-8,${encodeURIComponent(body)}`;
  }, [codes, product]);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line-strong bg-surface p-4">
      <p className="text-small font-semibold text-ink">Save your backup codes</p>
      <p className="text-small text-ink-2">If you lose your phone, each of these signs you in once. They won’t be shown again.</p>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-small text-ink sm:grid-cols-3" aria-label="Backup codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={codes.join("\n")} label="Copy codes" srLabel="Copy all backup codes" />
        <a
          href={file}
          download={`${product.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-backup-codes.txt`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <DownloadIcon aria-hidden className="size-3.5" />
          Download
        </a>
      </div>
    </div>
  );
}

function Setup({ state, finish, product }: { state: ActionState; finish: FormAction; product: string }) {
  const secret = typeof state.data?.secret === "string" ? state.data.secret : "";
  const uri = typeof state.data?.totpURI === "string" ? state.data.totpURI : "";
  const codes = codesOf(state);
  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
      <ol className="flex flex-col gap-4 text-small text-ink-2">
        <li className="flex flex-col gap-2">
          <p>
            <strong className="font-semibold text-ink">1. Add this key to your authenticator app</strong> (1Password, Google Authenticator, Authy, or any TOTP app).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-surface px-3 py-2 font-mono text-small tracking-wider break-all text-ink">{group(secret)}</code>
            <CopyButton value={secret} label="Copy key" srLabel="Copy the setup key" />
          </div>
          {uri ? (
            <a href={uri} className="inline-flex min-h-8 w-fit items-center gap-1.5 font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
              <KeyRoundIcon aria-hidden className="size-3.5" />
              On this phone? Open it in your authenticator app
            </a>
          ) : null}
        </li>
        <li className="flex flex-col gap-2">
          <p>
            <strong className="font-semibold text-ink">2. Save the backup codes.</strong>
          </p>
          {codes.length ? <BackupCodes codes={codes} product={product} /> : null}
        </li>
        <li className="flex flex-col gap-2">
          <p>
            <strong className="font-semibold text-ink">3. Enter the 6-digit code the app shows.</strong>
          </p>
          <ActionForm action={finish} focusAfter="#two-factor-status" className="flex flex-wrap items-end gap-3">
            <TextField
              label="Code from the app"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
              className="w-44"
            />
            <SubmitButton>Turn on two-factor</SubmitButton>
            <FormMessage className="basis-full" />
          </ActionForm>
        </li>
      </ol>
    </div>
  );
}

export function TwoFactorPanel({ enabled, actions, product }: { enabled: boolean; actions: TwoFactorActions; product: string }) {
  if (enabled) {
    return (
      <div className="flex flex-col gap-5">
        <p id="two-factor-status" tabIndex={-1} className="flex items-center gap-2 text-small text-ink-2">
          <StatusBadge label="On" tone="positive" />
          Signing in with a password also asks for a code from your app.
        </p>
        <ActionForm
          action={actions.codes}
          className="grid max-w-md grid-cols-[minmax(0,1fr)_auto] items-end gap-3"
          after={(state) => (state.ok && codesOf(state).length ? <div className="mt-3"><BackupCodes codes={codesOf(state)} product={product} /></div> : null)}
        >
          <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
          <SubmitButton variant="outline">New backup codes</SubmitButton>
          <FormMessage className="col-span-full" hideSuccess />
        </ActionForm>
        <div className="border-t border-line pt-5">
          <ActionForm action={actions.off} focusAfter="#two-factor-status" className="grid max-w-md grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
            <SubmitButton variant="destructive">Turn off two-factor</SubmitButton>
            <FormMessage className="col-span-full" />
          </ActionForm>
        </div>
      </div>
    );
  }
  return (
    <ActionForm
      action={actions.begin}
      toast={false}
      className="grid max-w-md grid-cols-[minmax(0,1fr)_auto] items-end gap-3"
      after={(state) => (state.ok && state.data?.pending ? <Setup state={state} finish={actions.finish} product={product} /> : null)}
    >
      <p id="two-factor-status" tabIndex={-1} className="col-span-full text-small text-ink-2">
        <StatusBadge label="Off" tone="neutral" className="mr-2" />
        Add a code from an authenticator app to every password sign-in. Enter your password to start.
      </p>
      <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
      <SubmitButton variant="outline">Set up two-factor</SubmitButton>
      <FormMessage className="col-span-full" />
    </ActionForm>
  );
}
