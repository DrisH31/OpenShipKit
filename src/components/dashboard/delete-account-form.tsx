"use client";

//
// The danger zone: delete the account for good. Two confirmations: a sign-in
// from the last few minutes (src/lib/reauth.ts — the action checks it again),
// and typing the account's email (works without JavaScript, and can't be done
// by a stray click). Without a fresh sign-in the form isn't offered: the
// panel says why, and "Sign in again to delete" signs out and opens the
// sign-in page, which brings the person straight back here (#danger), where
// the email field takes focus. On success the action signs out and goes home.
//

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { TextField } from "@/components/product/form-fields";
import { Button } from "@/components/ui/button";
import { FRESH_SIGN_IN_MINUTES } from "@/lib/reauth";

/** The section's id on the settings page: the sign-in comes back to it. */
const SECTION = "danger";

function ReauthButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" loading={pending}>
      Sign in again to delete
    </Button>
  );
}

function WhatHappens() {
  return (
    <p className="max-w-measure text-small text-ink-2">
      This removes your account, your sign-in methods and your sessions right away. Your subscription records are removed too, so cancel any paid plan in Billing first.
      Feedback you sent stays with the team; if you want it removed as well, ask us before you delete. This can’t be undone.
    </p>
  );
}

export function DeleteAccountForm({
  action,
  reauth,
  email,
  fresh,
}: {
  action: FormAction;
  /** Signs out and opens the sign-in page, which returns here. */
  reauth: () => Promise<void>;
  email: string;
  /** Signed in within FRESH_SIGN_IN_MINUTES. */
  fresh: boolean;
}) {
  const confirm = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Back from "Sign in again to delete": straight to the field.
    if (fresh && window.location.hash === `#${SECTION}`) confirm.current?.focus();
  }, [fresh]);

  if (!fresh) {
    return (
      <div className="flex flex-col gap-4">
        <WhatHappens />
        <p className="max-w-measure text-small text-ink-2">
          To make sure it’s you, sign in again. You’ll come straight back here, and have {FRESH_SIGN_IN_MINUTES} minutes to delete.
        </p>
        <form action={reauth}>
          <ReauthButton />
        </form>
      </div>
    );
  }
  return (
    <ActionForm action={action} toast={false} className="flex flex-col gap-4">
      <WhatHappens />
      <TextField
        label={
          <>
            Type <span className="font-mono font-normal">{email}</span> to confirm
          </>
        }
        name="confirm"
        ref={confirm}
        autoComplete="off"
        spellCheck={false}
        required
        className="max-w-md"
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="destructive">Delete my account</SubmitButton>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
