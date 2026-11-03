import "server-only";

//
// Better Auth's UI: the app's own forms (src/components/auth), rendered from
// server components so the form is in the first byte and works without
// JavaScript. Which social buttons appear is decided here, on the server,
// from the keys that are set.
//
// Extra pages under /auth/<name>: forgot-password, reset-password,
// verify-email, two-factor (the code step of a password sign-in) and, with
// AUTH_MAGIC_LINK=true, magic-link. Every page honours ?redirect= through
// safeRedirect, so a sign-in always returns to a same-origin path.
//
// Being the auth UI, this is the one adapter file that renders components:
// src/components/auth/* and src/components/ui/button, plus
// src/server/services/content for the page copy.
//

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { safeRedirect, type AuthUI, type SignInProps } from "@/core/auth";
import { buttonVariants } from "@/components/ui/button";
import { AuthFooter, AuthHeader, authLinkClass } from "@/components/auth/auth-header";
import { EmailOnlyForm } from "@/components/auth/email-only-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignOutForm } from "@/components/auth/sign-out-button";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { TwoFactorForm } from "@/components/auth/two-factor-form";
import { getContent } from "@/server/services/content";
import {
  forgotPasswordAction,
  magicLinkAction,
  resendVerificationAction,
  resetPasswordAction,
  signInAction,
  signOutAction,
  signUpAction,
  socialSignInAction,
  verifyTwoFactorAction,
} from "./actions";
import { messageForCode } from "./errors";
import { configuredSocialProviders, getBetterAuth, magicLinkEnabled, twoFactorAvailable } from "./instance";

type PageProps = { searchParams: Record<string, string | undefined> };

async function productName(): Promise<string> {
  return (await getContent("site")).name;
}

async function BetterAuthSignIn({ redirectTo, notice }: SignInProps) {
  const name = await productName();
  return (
    <div className="flex flex-col gap-8">
      <AuthHeader title={`Sign in to ${name}`} description="Welcome back. Use the email you signed up with." />
      <SignInForm
        action={signInAction}
        socialAction={socialSignInAction}
        providers={configuredSocialProviders()}
        redirectTo={redirectTo}
        magicLink={magicLinkEnabled()}
        notice={notice}
      />
    </div>
  );
}

async function BetterAuthSignUp({ redirectTo }: SignInProps) {
  const name = await productName();
  return (
    <div className="flex flex-col gap-8">
      <AuthHeader title={`Create your ${name} account`} description="Sign up with your email and a password." />
      <SignUpForm action={signUpAction} socialAction={socialSignInAction} providers={configuredSocialProviders()} redirectTo={redirectTo} />
    </div>
  );
}

function BetterAuthSignOutButton({ className }: { className?: string }) {
  return <SignOutForm action={signOutAction} className={className} />;
}

function BackToSignIn() {
  return (
    <AuthFooter>
      <Link href="/sign-in" className={authLinkClass}>
        Back to sign in
      </Link>
    </AuthFooter>
  );
}

function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-8">
      <AuthHeader title="Reset your password" description="Enter your account’s email and we’ll send you a link to choose a new password." />
      <EmailOnlyForm action={forgotPasswordAction} submitLabel="Send reset link" />
      <BackToSignIn />
    </div>
  );
}

function ResetPasswordPage({ searchParams }: PageProps) {
  const token = searchParams.token;
  const error = messageForCode(searchParams.error);
  if (!token || error) {
    return (
      <div className="flex flex-col gap-8">
        <AuthHeader title="This link didn’t work" description={error ?? "The reset link is missing its token. Ask for a new one."} />
        <Link href="/auth/forgot-password" className={buttonVariants({ size: "lg", className: "w-full" })}>
          Send a new link
        </Link>
        <BackToSignIn />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <AuthHeader title="Choose a new password" description="You’ll be signed out everywhere else, then you can sign in with the new one." />
      <ResetPasswordForm action={resetPasswordAction} token={token} />
    </div>
  );
}

/** Where the emailed confirmation link lands (Better Auth appends ?error= on failure). */
async function VerifyEmailPage({ searchParams }: PageProps) {
  const next = safeRedirect(searchParams.next);
  const error = messageForCode(searchParams.error);
  const auth = await getBetterAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!error && session?.user.emailVerified) {
    return (
      <div className="flex flex-col gap-8">
        <AuthHeader title="Email confirmed" description={`${session.user.email} is confirmed. You’re all set.`} />
        <Link href={next} className={buttonVariants({ size: "lg", className: "w-full" })}>
          Continue
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeader
        title={error ? "This link didn’t work" : "Confirm your email"}
        description={error ?? "We sent a confirmation link to your inbox. Open it to finish. Need a new one? Enter your email."}
      />
      <EmailOnlyForm action={resendVerificationAction} submitLabel="Send a new link" redirectTo={next} defaultEmail={session?.user.email} />
      <BackToSignIn />
    </div>
  );
}

function MagicLinkPage({ searchParams }: PageProps) {
  if (!magicLinkEnabled()) notFound();
  return (
    <div className="flex flex-col gap-8">
      <AuthHeader title="Sign in with a link" description="We’ll email you a link that signs you in. No password needed." />
      <EmailOnlyForm action={magicLinkAction} submitLabel="Email me a link" redirectTo={safeRedirect(searchParams.redirect)} />
      <BackToSignIn />
    </div>
  );
}

/** The challenge cookie the password step sets (__Secure- prefixed over HTTPS). Its value is checked by the action. */
async function hasTwoFactorChallenge(): Promise<boolean> {
  return (await cookies()).getAll().some((c) => c.name.endsWith("better-auth.two_factor"));
}

/** /auth/two-factor — the code step after a correct password, for accounts with two-factor on. */
async function TwoFactorPage({ searchParams }: PageProps) {
  if (!(await twoFactorAvailable())) notFound();
  const next = safeRedirect(searchParams.redirect);
  const method = searchParams.method === "backup" ? "backup" : "totp";

  const auth = await getBetterAuth();
  if (await auth.api.getSession({ headers: await headers() })) redirect(next);

  if (!(await hasTwoFactorChallenge())) {
    return (
      <div className="flex flex-col gap-8">
        <AuthHeader title="This sign-in timed out" description="The code step lasts 10 minutes. Sign in with your password again to get a new one." />
        <Link href={next === "/dashboard" ? "/sign-in" : `/sign-in?redirect=${encodeURIComponent(next)}`} className={buttonVariants({ size: "lg", className: "w-full" })}>
          Sign in again
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeader
        title={method === "totp" ? "Enter your code" : "Use a backup code"}
        description={
          method === "totp"
            ? "Your account has two-factor sign-in. Open your authenticator app and enter the code it shows."
            : "Lost your phone? Enter one of the backup codes you saved when you turned on two-factor."
        }
      />
      <TwoFactorForm action={verifyTwoFactorAction} method={method} redirectTo={next} />
    </div>
  );
}

export const ui: AuthUI = {
  SignIn: BetterAuthSignIn,
  SignUp: BetterAuthSignUp,
  SignOutButton: BetterAuthSignOutButton,
  pages: {
    "forgot-password": ForgotPasswordPage,
    "reset-password": ResetPasswordPage,
    "verify-email": VerifyEmailPage,
    "magic-link": MagicLinkPage,
    "two-factor": TwoFactorPage,
  },
};
