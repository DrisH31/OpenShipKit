"use client";

//
// Choose a new password with the token from the emailed link. On success the
// form gives way to a "Sign in" link (every other session was signed out).
//

import Link from "next/link";
import { useActionState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { AuthFormMessage, AuthSubmitButton, PasswordField } from "./form-parts";
import { IDLE, type AuthFormAction } from "@/core/auth-forms";

export function ResetPasswordForm({ action, token }: { action: AuthFormAction; token: string }) {
  const [state, formAction] = useActionState(action, IDLE);

  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-5">
        <AuthFormMessage state={state} />
        <Link href="/sign-in" className={buttonVariants({ size: "lg", className: "w-full" })}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <AuthFormMessage state={state} />
      <PasswordField label="New password" autoComplete="new-password" hint="At least 8 characters." error={state.fieldErrors?.password} />
      <PasswordField name="confirm" label="Repeat new password" autoComplete="new-password" error={state.fieldErrors?.confirm} />
      <AuthSubmitButton>Change password</AuthSubmitButton>
    </form>
  );
}
