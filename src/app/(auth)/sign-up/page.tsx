//
// /sign-up — Better Auth's sign-up form (src/adapters/auth/better-auth/ui.tsx).
// ?redirect= is validated by safeRedirect (same-origin paths only). Someone
// already signed in goes straight to where they were heading.
//

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeRedirect } from "@/core/auth";
import { getAuthUI } from "@/server/auth-ui";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create your account with an email and a password.",
  alternates: { canonical: "/sign-up" },
};

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const redirectTo = safeRedirect(typeof params.redirect === "string" ? params.redirect : null);
  const [ui, user] = await Promise.all([getAuthUI(), getCurrentUser()]);
  if (user) redirect(redirectTo);
  return <ui.SignUp redirectTo={redirectTo} />;
}
