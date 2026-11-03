//
// /invite/[token] — an invitation to join an organisation (OPENSHIPKIT_TENANCY=org).
// Works signed out: it says who invited you to what, and sends you to sign in
// or sign up and back here. Signed in with the invited address, it offers
// Accept (acceptInviteAction, in the dashboard's team actions, which require
// a session). 404 when teams are off or the link matches nothing. Never
// indexed (the auth layout), and the token never leaves this page's URL.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormMessage, SubmitButton } from "@/components/product/action-form";
import { buttonVariants } from "@/components/ui/button";
import { previewInvitation, teamsEnabled } from "@/server/services/orgs";
import { getCurrentUser } from "@/server/session";
import { acceptInviteAction } from "@/app/dashboard/team/actions";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  if (!teamsEnabled()) notFound();
  const { token } = await params;
  const [invitation, user] = await Promise.all([previewInvitation(token), getCurrentUser()]);
  if (!invitation) notFound();
  const here = `/invite/${encodeURIComponent(token)}`;
  const from = invitation.inviterName ? `${invitation.inviterName} invited you` : "You've been invited";

  let body: React.ReactNode;
  if (invitation.state !== "pending") {
    body = (
      <p className="text-small text-ink-2">
        This invitation {invitation.state === "expired" ? "has expired" : invitation.state === "accepted" ? "has already been used" : "was withdrawn"}. Ask someone in {invitation.orgName} to send a new one.
      </p>
    );
  } else if (!user) {
    body = (
      <>
        <p className="text-small text-ink-2">
          Sign in, or create an account, with <strong className="text-ink">{invitation.email}</strong> to accept.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={`/sign-in?redirect=${encodeURIComponent(here)}`} className={buttonVariants()}>
            Sign in
          </Link>
          <Link href={`/sign-up?redirect=${encodeURIComponent(here)}`} className={buttonVariants({ variant: "outline" })}>
            Create an account
          </Link>
        </div>
      </>
    );
  } else if (user.email.toLowerCase() !== invitation.email) {
    body = (
      <p className="text-small text-ink-2">
        This invitation is for <strong className="text-ink">{invitation.email}</strong>, and you’re signed in as {user.email}. Sign out and sign in with that address to accept it.
      </p>
    );
  } else {
    body = (
      <ActionForm action={acceptInviteAction.bind(null, token)} className="flex flex-col gap-3">
        <div>
          <SubmitButton>Join {invitation.orgName}</SubmitButton>
        </div>
        <FormMessage />
      </ActionForm>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-line bg-card p-6 sm:p-8">
      <h1 className="font-display text-h3 text-ink">Join {invitation.orgName}</h1>
      <p className="text-body text-ink-2">
        {from} to join as {invitation.role === "admin" ? "an admin" : "a member"}.
      </p>
      {body}
    </div>
  );
}
