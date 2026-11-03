//
// /auth/<page> — the extra screens Better Auth's UI owns: forgot-password,
// reset-password, verify-email, two-factor and (AUTH_MAGIC_LINK=true)
// magic-link. Anything it doesn't define is a 404.
//

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAuthUI } from "@/server/auth-ui";

const TITLES: Record<string, string> = {
  "forgot-password": "Reset your password",
  "reset-password": "Choose a new password",
  "verify-email": "Confirm your email",
  "magic-link": "Sign in with a link",
  "two-factor": "Two-factor sign-in",
};

type Params = Promise<{ page: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { page } = await params;
  return { title: TITLES[page] ?? "Account" };
}

export default async function AuthExtraPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ page }, query, ui] = await Promise.all([params, searchParams, getAuthUI()]);
  const Page = Object.hasOwn(ui.pages ?? {}, page) ? ui.pages?.[page] : undefined;
  if (!Page) notFound();
  // Only single values are meaningful here; repeated keys keep the first.
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(query)) flat[k] = Array.isArray(v) ? v[0] : v;
  return <Page searchParams={flat} />;
}
