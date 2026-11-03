//
// /dashboard/settings — profile, password, two-factor, where you're signed in,
// appearance, sign out, and deleting the account. One page with jump links,
// each section a card; every form posts to ./actions (requireUser in each).
// The security facts come from Better Auth's own tables, read fresh
// (getAccountSecurity), never from the cookie cache.
//

import type { Metadata } from "next";
import { PageHeader } from "@/components/product/page-header";
import { ErrorState } from "@/components/product/states";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { PasswordForm } from "@/components/dashboard/password-form";
import { SessionsList } from "@/components/dashboard/sessions-list";
import { TwoFactorPanel } from "@/components/dashboard/two-factor-panel";
import { ThemeChoice } from "@/components/dashboard/theme-choice";
import { DeleteAccountForm } from "@/components/dashboard/delete-account-form";
import { getAccountSecurity } from "@/adapters/auth/better-auth/actions";
import { getAuthUI } from "@/server/auth-ui";
import { isDemoUser } from "@/server/demo";
import { requireUser } from "@/server/session";
import { getContent } from "@/server/services/content";
import { signedInRecently } from "@/lib/reauth";
import {
  beginTwoFactor,
  changePassword,
  deleteAccount,
  finishTwoFactor,
  newBackupCodes,
  revokeOtherSessions,
  revokeSession,
  saveProfile,
  signInAgainToDelete,
  turnOffTwoFactor,
} from "./actions";

export const metadata: Metadata = { title: "Settings" };

function Section({ id, title, description, children, danger = false }: { id: string; title: string; description?: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={danger ? "flex scroll-mt-20 flex-col gap-4 rounded-xl border border-danger-line bg-card p-5 sm:p-6" : "flex scroll-mt-20 flex-col gap-4 rounded-xl border border-line bg-card p-5 sm:p-6"}
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className={danger ? "font-sans text-body font-semibold text-danger" : "font-sans text-body font-semibold text-ink"}>
          {title}
        </h2>
        {description ? <p className="max-w-measure text-small text-ink-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const user = await requireUser("/dashboard/settings");
  const [security, authUI, site] = await Promise.all([getAccountSecurity(), getAuthUI(), getContent("site")]);
  const { SignOutButton } = authUI;
  const twoFactorOn = Boolean(security?.twoFactor.available);
  // The read-only demo admin is one account shared by every visitor: its list shows this browser
  // only, without the network address, so nobody sees another visitor's sessions.
  const sessions = (security?.sessions ?? []).filter((s) => !isDemoUser(user) || s.current).map((s) => (isDemoUser(user) ? { ...s, ipAddress: null } : s));
  const signedInFresh = signedInRecently(security?.sessions.find((s) => s.current)?.createdAt);
  const jumps = [
    { id: "profile", label: "Profile" },
    { id: "password", label: "Password" },
    ...(twoFactorOn ? [{ id: "two-factor", label: "Two-factor" }] : []),
    { id: "sessions", label: "Sessions" },
    { id: "appearance", label: "Appearance" },
    { id: "danger", label: "Delete account" },
  ];

  return (
    <>
      <PageHeader title="Settings" answer="Your profile, how you sign in, and where you’re signed in." />
      <nav aria-label="Settings sections" className="-mt-2 flex flex-wrap gap-1">
        {jumps.map((j) => (
          <a key={j.id} href={`#${j.id}`} className="inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-small whitespace-nowrap text-ink-2 hover:bg-tonal hover:text-ink pointer-coarse:min-h-11">
            {j.label}
          </a>
        ))}
      </nav>

      <div className="flex max-w-3xl flex-col gap-6">
        <Section id="profile" title="Profile">
          <ProfileForm action={saveProfile} name={user.name} email={user.email} emailVerified={security?.emailVerified ?? false} />
        </Section>

        {security ? (
          <>
            <Section
              id="password"
              title={security.hasPassword ? "Password" : "Add a password"}
              description={
                security.hasPassword
                  ? "Changing it signs you out on every other device, and we email you a notice."
                  : `You sign in with ${security.linkedProviders.map((p) => (p === "github" ? "GitHub" : p === "google" ? "Google" : p)).join(" or ") || "a sign-in link"}. Add a password to sign in with your email too.`
              }
            >
              <PasswordForm action={changePassword} hasPassword={security.hasPassword} email={user.email} />
            </Section>

            {twoFactorOn ? (
              <Section id="two-factor" title="Two-factor sign-in" description="A second step after your password: a 6-digit code from an app on your phone.">
                {security.hasPassword ? (
                  <TwoFactorPanel
                    enabled={security.twoFactor.enabled}
                    product={site.name}
                    actions={{ begin: beginTwoFactor, finish: finishTwoFactor, off: turnOffTwoFactor, codes: newBackupCodes }}
                  />
                ) : (
                  <p className="text-small text-ink-2">Two-factor protects password sign-ins. Add a password above first.</p>
                )}
              </Section>
            ) : null}

            <Section id="sessions" title="Where you’re signed in" description="Sign out anything you don’t recognise, then change your password.">
              <SessionsList sessions={sessions} revoke={revokeSession} revokeOthers={revokeOtherSessions} now={new Date().toISOString()} />
            </Section>
          </>
        ) : (
          <ErrorState title="Security settings didn’t load" body="We couldn’t read your sign-in details just now. Reload the page; nothing was changed." />
        )}

        <Section id="appearance" title="Appearance" description="Saved in this browser.">
          <ThemeChoice />
        </Section>

        <Section id="sign-out" title="Sign out" description="Sign out of this browser. Other devices stay signed in.">
          <div>
            <SignOutButton />
          </div>
        </Section>

        <Section id="danger" title="Delete account" danger>
          <DeleteAccountForm action={deleteAccount} reauth={signInAgainToDelete} email={user.email} fresh={signedInFresh} />
        </Section>
      </div>
    </>
  );
}
