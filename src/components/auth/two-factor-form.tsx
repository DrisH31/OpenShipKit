"use client";

//
// The second step of signing in when two-factor is on: a code from the
// authenticator app, or (method "backup") one of the saved backup codes.
// Switching between the two is a plain link (?method=backup), so the page
// works without JavaScript. The action redirects on success.
//

import Link from "next/link";
import { useActionState } from "react";
import { AuthFooter, authLinkClass } from "./auth-header";
import { AuthCheckboxField, AuthFormMessage, AuthSubmitButton, CodeField, RedirectInput } from "./form-parts";
import { IDLE, type AuthFormAction } from "@/core/auth-forms";

function withQuery(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function TwoFactorForm({ action, method, redirectTo }: { action: AuthFormAction; method: "totp" | "backup"; redirectTo: string }) {
  const [state, formAction] = useActionState(action, IDLE);
  const redirect = redirectTo === "/dashboard" ? undefined : redirectTo;
  const otherMethod = withQuery("/auth/two-factor", { method: method === "totp" ? "backup" : undefined, redirect });

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-5" noValidate>
        <RedirectInput value={redirectTo} />
        <input type="hidden" name="method" value={method} />
        <AuthFormMessage state={state} />
        {method === "totp" ? (
          <CodeField kind="totp" label="6-digit code" autoFocus error={state.fieldErrors?.code} hint="From your authenticator app. It changes every 30 seconds." />
        ) : (
          <CodeField kind="backup" label="Backup code" autoFocus error={state.fieldErrors?.code} hint="Each backup code works once." />
        )}
        <AuthCheckboxField name="trustDevice" label="Trust this device for 30 days" />
        <AuthSubmitButton>Verify and sign in</AuthSubmitButton>
      </form>

      <p className="text-center text-small text-ink-2">
        <Link href={otherMethod} className={authLinkClass}>
          {method === "totp" ? "Use a backup code instead" : "Use your authenticator app instead"}
        </Link>
      </p>

      <AuthFooter>
        Not you?{" "}
        <Link href={withQuery("/sign-in", { redirect })} className={authLinkClass}>
          Start over
        </Link>
      </AuthFooter>
    </div>
  );
}
