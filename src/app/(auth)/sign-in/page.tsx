//
// /sign-in — Better Auth's sign-in form (src/adapters/auth/better-auth/ui.tsx).
// ?redirect= is validated by safeRedirect (same-origin paths only). Someone
// already signed in goes straight to where they were heading. ?error=banned
// (requireUser() sending a banned person here) shows BANNED_MESSAGE.
//

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeRedirect, signInNotice } from "@/core/auth";
import { getAuthUI } from "@/server/auth-ui";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your account.",
  alternates: { canonical: "/sign-in" },
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const redirectTo = safeRedirect(typeof params.redirect === "string" ? params.redirect : null);
  const [ui, user] = await Promise.all([getAuthUI(), getCurrentUser()]);
  if (user) redirect(redirectTo);
  return <ui.SignIn redirectTo={redirectTo} notice={signInNotice(params.error)} />;
}
