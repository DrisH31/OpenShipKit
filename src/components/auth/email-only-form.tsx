"use client";

//
// One email field and a submit button — forgot password, magic link and
// "send another confirmation link" are all this shape. After a successful
// send the message replaces nothing: the person can correct the address and
// send again.
//

import { useActionState } from "react";
import { AuthFormMessage, AuthSubmitButton, AuthTextField, RedirectInput } from "./form-parts";
import { IDLE, type AuthFormAction } from "@/core/auth-forms";

export function EmailOnlyForm({
  action,
  submitLabel,
  redirectTo,
  defaultEmail,
}: {
  action: AuthFormAction;
  submitLabel: string;
  redirectTo?: string;
  defaultEmail?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {redirectTo ? <RedirectInput value={redirectTo} /> : null}
      <AuthFormMessage state={state} />
      <AuthTextField
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email ?? defaultEmail}
        error={state.fieldErrors?.email}
      />
      <AuthSubmitButton variant={state.status === "sent" ? "outline" : "default"}>{state.status === "sent" ? "Send again" : submitLabel}</AuthSubmitButton>
    </form>
  );
}
