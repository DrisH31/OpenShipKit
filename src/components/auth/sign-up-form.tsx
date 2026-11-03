"use client";

//
// Create an account (Better Auth). When email verification is required the
// action answers "check your inbox" and the form gives way to that message;
// otherwise the action signs the person in and redirects. The line under the
// button links the Terms and Privacy policy (/legal/terms, /legal/privacy).
//
// The focused "Create account" button goes away with the form, so focus moves
// to the "Check your inbox" panel: a screen reader reads its heading and
// message (a live region created together with its text often stays silent),
// and the next Tab starts there instead of at the top of the page.
//

import Link from "next/link";
import { useActionState, useEffect, useId, useRef } from "react";
import { MailCheck } from "lucide-react";
import { AuthFooter, authLinkClass } from "./auth-header";
import { AuthFormMessage, AuthSubmitButton, AuthTextField, PasswordField, RedirectInput } from "./form-parts";
import { IDLE, type AuthFormAction } from "@/core/auth-forms";
import { OrDivider, SocialButtons, type SocialProvider } from "./social-buttons";

export function SignUpForm({
  action,
  socialAction,
  providers,
  redirectTo,
}: {
  action: AuthFormAction;
  socialAction: (formData: FormData) => Promise<void>;
  providers: SocialProvider[];
  redirectTo: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  const signInHref = redirectTo === "/dashboard" ? "/sign-in" : `/sign-in?redirect=${encodeURIComponent(redirectTo)}`;

  if (state.status === "sent") return <CheckInbox message={state.message} />;

  return (
    <div className="flex flex-col gap-6">
      {providers.length > 0 ? (
        <>
          <SocialButtons providers={providers} action={socialAction} redirectTo={redirectTo} />
          <OrDivider />
        </>
      ) : null}

      <form action={formAction} className="flex flex-col gap-5" noValidate>
        <RedirectInput value={redirectTo} />
        <AuthFormMessage state={state} />
        <AuthTextField name="name" label="Name" autoComplete="name" defaultValue={state.values?.name} error={state.fieldErrors?.name} />
        <AuthTextField
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          error={state.fieldErrors?.email}
        />
        <PasswordField autoComplete="new-password" hint="At least 8 characters." error={state.fieldErrors?.password} />
        <AuthSubmitButton>Create account</AuthSubmitButton>
        <p className="text-caption text-ink-3 text-pretty">
          By creating an account you agree to the{" "}
          <Link href="/legal/terms" className={authLinkClass}>
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className={authLinkClass}>
            Privacy policy
          </Link>
          .
        </p>
      </form>

      <AuthFooter>
        Already have an account?{" "}
        <Link href={signInHref} className={authLinkClass}>
          Sign in
        </Link>
      </AuthFooter>
    </div>
  );
}

/** What replaces the form once the confirmation link is sent. Takes focus when it appears. */
function CheckInbox({ message }: { message?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-message`}
      className="flex flex-col items-start gap-4 outline-none"
    >
      <MailCheck className="size-6 text-ink-2" aria-hidden />
      <h2 id={`${id}-title`} className="font-display text-lead font-semibold tracking-tight text-ink">
        Check your inbox
      </h2>
      <p id={`${id}-message`} className="text-body text-ink">
        {message}
      </p>
      <p className="text-small text-ink-2">
        Nothing there? Check spam, or{" "}
        <Link href="/auth/verify-email" className={authLinkClass}>
          send another link
        </Link>
        .
      </p>
    </div>
  );
}
