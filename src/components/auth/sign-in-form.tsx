"use client";

//
// Email + password sign-in (Better Auth). Posts to a server action, so it
// works before (or without) JavaScript; useActionState then keeps the page
// and shows errors inline. The action redirects on success.
//

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useActionState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AuthFooter, authLinkClass } from "./auth-header";
import { AuthFormMessage, AuthSubmitButton, AuthTextField, PasswordField, RedirectInput } from "./form-parts";
import { IDLE, type AuthFormAction } from "@/core/auth-forms";
import { BANNED_ERROR, BANNED_MESSAGE } from "@/core/auth";
import { OrDivider, SocialButtons, type SocialProvider } from "./social-buttons";

// ?error= on /sign-in. Our error URLs carry a code ("social", "magic-link");
// Better Auth either replaces it (a sign-in link) or appends its own after it
// (an OAuth callback: ?error=social&error=BANNED), so the LAST one is read.
// Any code we don't name still gets a sentence (never the raw code).
const TWO_FACTOR_ONLY =
  "Your account has two-factor sign-in, so it signs in only with your password and authenticator code. Sign in with those below.";
const QUERY_ERRORS: Record<string, string> = {
  social: "That sign-in didn’t finish. Try again, or use your email and password.",
  "magic-link": "That sign-in link is invalid or has expired. Ask for a new one.",
  INVALID_TOKEN: "That sign-in link is invalid or has expired. Ask for a new one.",
  "two-factor-required": TWO_FACTOR_ONLY,
  TWO_FACTOR_REQUIRED: TWO_FACTOR_ONLY,
  [BANNED_ERROR]: BANNED_MESSAGE,
  BANNED: BANNED_MESSAGE,
  // A GitHub/Google sign-up whose email the provider hasn't verified (refused while verification is required).
  SOCIAL_EMAIL_NOT_VERIFIED:
    "That account’s email isn’t verified with GitHub or Google yet. Verify it there and try again, or sign up with your email and a password.",
  // "Try the demo" (POST /api/demo) without JavaScript, when it couldn't sign in.
  "demo-unavailable": "The demo isn’t available right now. Try again in a minute.",
  "demo-limited": "That’s a lot of demo sign-ins at once. Wait a minute and try again.",
  "demo-forbidden": "That request came from another site, so it was refused. Use the button on this page.",
  // An existing account that isn't confirmed yet; Better Auth has emailed a new link.
  email_not_verified: "Confirm your email first. We’ve sent you a new link.",
};
const QUERY_ERROR_FALLBACK = "That sign-in didn’t finish. Try again.";

function queryErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return QUERY_ERRORS[code] ?? QUERY_ERROR_FALLBACK;
}

function withRedirect(path: string, redirectTo: string): string {
  return redirectTo === "/dashboard" ? path : `${path}?redirect=${encodeURIComponent(redirectTo)}`;
}

export function SignInForm({
  action,
  socialAction,
  providers,
  redirectTo,
  magicLink,
  notice,
}: {
  action: AuthFormAction;
  socialAction: (formData: FormData) => Promise<void>;
  providers: SocialProvider[];
  redirectTo: string;
  magicLink: boolean;
  /** A message from the page (SignInProps.notice), shown until the form is first sent. */
  notice?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  const searchParams = useSearchParams();
  const queryError = notice ?? queryErrorMessage(searchParams.getAll("error").at(-1) ?? null);
  // Memoised: AuthFormMessage keys its node on this object, so it must change only per submit (or query error).
  const shown = useMemo(
    () => (state.status === "idle" && queryError ? { status: "error" as const, message: queryError } : state),
    [state, queryError],
  );

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
        <AuthFormMessage state={shown} />
        <AuthTextField
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          error={state.fieldErrors?.email}
        />
        <PasswordField
          autoComplete="current-password"
          error={state.fieldErrors?.password}
          labelAside={
            <Link href="/auth/forgot-password" className={cn(authLinkClass, "text-small font-normal")}>
              Forgot password?
            </Link>
          }
        />
        <AuthSubmitButton>Sign in</AuthSubmitButton>
      </form>

      {magicLink ? (
        <p className="text-center text-small text-ink-2">
          <Link href={withRedirect("/auth/magic-link", redirectTo)} className={authLinkClass}>
            Email me a sign-in link instead
          </Link>
        </p>
      ) : null}

      <AuthFooter>
        New here?{" "}
        <Link href={withRedirect("/sign-up", redirectTo)} className={authLinkClass}>
          Create an account
        </Link>
      </AuthFooter>
    </div>
  );
}
