import "server-only";

//
// Email templates: plain functions that return { subject, html, text }.
// No email framework — one shared layout (renderEmail) with inline styles,
// which is what mail clients reliably honour.
//
//   verifyEmail · resetPassword · magicLink · magicLinkTwoFactor · welcome   (auth flows)
//   securityNotice · existingAccount                                         (account safety)
//   notification                                                             (anything else the app sends)
//
//   - Every HTML email has a plain-text twin with the same words and links.
//   - Dark-mode clients (Apple Mail, Outlook.com, Gmail apps) get a
//     prefers-color-scheme block; clients that ignore it get the light design,
//     which stays readable when they invert it.
//   - Anything interpolated is escaped. The product name comes from the
//     editable "site" content, so renaming the product renames the mail.
//   - A person's name is whatever was typed at sign-up, by anyone, for any
//     address. The confirmation email (sent before the address is proved)
//     never uses it, and greeting() only ever shows a first word made of
//     letters, so a "name" such as https://evil.example can't ride out in
//     mail from the site's own domain as a clickable link.
//

import { getContent } from "@/server/services/content";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface EmailLayout {
  productName: string;
  /** The grey preview line most inboxes show after the subject. */
  preheader: string;
  heading: string;
  /** Plain-text paragraphs; escaped, never HTML. */
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Small print under the button, e.g. "This link expires in an hour." */
  footnote?: string;
}

const COLORS = {
  page: "#F2F2F2",
  card: "#FFFFFF",
  ink: "#111111",
  ink2: "#4A4A4A",
  line: "#E2E2E2",
  button: "#111111",
  buttonInk: "#FFFFFF",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) links go into an href; anything else is dropped. */
function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The shared layout. Pure, so it is easy to test and to preview. */
export function renderEmail(layout: EmailLayout): { html: string; text: string } {
  const name = escapeHtml(layout.productName);
  const href = layout.action ? safeUrl(layout.action.url) : null;

  const paragraphs = layout.paragraphs
    .map((p) => `<p class="ol-ink2" style="margin:0 0 16px;font-size:16px;line-height:24px;color:${COLORS.ink2};">${escapeHtml(p)}</p>`)
    .join("\n");

  const button =
    href && layout.action
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr><td class="ol-button" style="border-radius:8px;background:${COLORS.button};">
    <a class="ol-button-link" href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;color:${COLORS.buttonInk};text-decoration:none;border-radius:8px;">${escapeHtml(layout.action.label)}</a>
  </td></tr>
</table>
<p class="ol-ink2" style="margin:0 0 16px;font-size:13px;line-height:20px;color:${COLORS.ink2};">If the button doesn’t work, paste this link into your browser:<br><a class="ol-ink" href="${escapeHtml(href)}" style="color:${COLORS.ink};word-break:break-all;">${escapeHtml(href)}</a></p>`
      : "";

  const footnote = layout.footnote
    ? `<p class="ol-ink2" style="margin:0;font-size:13px;line-height:20px;color:${COLORS.ink2};">${escapeHtml(layout.footnote)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(layout.heading)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .ol-page { background:#0A0A0A !important; }
    .ol-card { background:#161616 !important; border-color:#2A2A2A !important; }
    .ol-ink { color:#F2F2F2 !important; }
    .ol-ink2 { color:#B4B4B4 !important; }
    .ol-button { background:#F2F2F2 !important; }
    .ol-button-link { color:#111111 !important; }
  }
</style>
</head>
<body class="ol-page" style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(layout.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ol-page" style="background:${COLORS.page};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
      <tr><td class="ol-ink" style="padding:0 4px 16px;font-family:${FONT};font-size:15px;font-weight:700;color:${COLORS.ink};">${name}</td></tr>
      <tr><td class="ol-card" style="background:${COLORS.card};border:1px solid ${COLORS.line};border-radius:12px;padding:32px;font-family:${FONT};">
        <h1 class="ol-ink" style="margin:0 0 16px;font-size:22px;line-height:28px;font-weight:700;color:${COLORS.ink};">${escapeHtml(layout.heading)}</h1>
        ${paragraphs}
        ${button}
        ${footnote}
      </td></tr>
      <tr><td class="ol-ink2" style="padding:16px 4px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.ink2};">Sent by ${name}. If you weren’t expecting this email, you can ignore it.</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    layout.productName,
    "",
    layout.heading,
    "",
    ...layout.paragraphs.flatMap((p) => [p, ""]),
    ...(href && layout.action ? [`${layout.action.label}: ${href}`, ""] : []),
    ...(layout.footnote ? [layout.footnote, ""] : []),
    `Sent by ${layout.productName}. If you weren’t expecting this email, you can ignore it.`,
  ].join("\n");

  return { html, text };
}

async function productName(): Promise<string> {
  try {
    return (await getContent("site")).name;
  } catch {
    return "OpenShipKit";
  }
}

/** A first name that is only letters (any script), apostrophes and hyphens: never a link, an address or a number. */
const PLAIN_NAME = /^[\p{L}\p{M}][\p{L}\p{M}'’-]{0,39}$/u;

/** "Hi Ada," — or just "Hi," when the first word isn't plainly a name. Exported for tests. */
export function greeting(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first && PLAIN_NAME.test(first) ? `Hi ${first},` : "Hi,";
}

/**
 * Sent on sign-up (and on request) with the link that confirms the address.
 * Greets no one by name: the name was typed by whoever signed up, and the
 * address hasn't been proved to be theirs. `name` is accepted and ignored.
 */
export async function verifyEmailTemplate(input: { url: string; name?: string | null }): Promise<EmailContent> {
  const product = await productName();
  const subject = `Confirm your email for ${product}`;
  return {
    subject,
    ...renderEmail({
      productName: product,
      preheader: "One click to confirm your email address.",
      heading: "Confirm your email",
      paragraphs: [greeting(null), `Confirm this is your email address to finish setting up your ${product} account.`],
      action: { label: "Confirm email", url: input.url },
      footnote: "This link expires in 24 hours.",
    }),
  };
}

/** The "forgot password" link. */
export async function resetPasswordTemplate(input: { url: string; name?: string | null }): Promise<EmailContent> {
  const product = await productName();
  return {
    subject: `Reset your ${product} password`,
    ...renderEmail({
      productName: product,
      preheader: "Choose a new password.",
      heading: "Reset your password",
      paragraphs: [
        greeting(input.name),
        `Someone asked to reset the password for your ${product} account. If it was you, choose a new one below.`,
        "If you didn’t ask, ignore this email — your password stays the same.",
      ],
      action: { label: "Choose a new password", url: input.url },
      footnote: "This link expires in one hour and works once.",
    }),
  };
}

/** Passwordless sign-in (AUTH_MAGIC_LINK=true). */
export async function magicLinkTemplate(input: { url: string }): Promise<EmailContent> {
  const product = await productName();
  return {
    subject: `Your ${product} sign-in link`,
    ...renderEmail({
      productName: product,
      preheader: "Sign in with one click.",
      heading: `Sign in to ${product}`,
      paragraphs: ["Use the button below to sign in. No password needed."],
      action: { label: "Sign in", url: input.url },
      footnote: "This link expires in 10 minutes and works once.",
    }),
  };
}

/**
 * Sent instead of a sign-in link when the account has two-factor on: a link
 * would skip the authenticator code, so it points to the password sign-in.
 */
export async function magicLinkTwoFactorTemplate(input: { name?: string | null; signInUrl: string }): Promise<EmailContent> {
  const product = await productName();
  return {
    subject: `Sign in to ${product} with your password`,
    ...renderEmail({
      productName: product,
      preheader: "Your account uses two-factor sign-in, so sign-in links are off for it.",
      heading: "Use your password to sign in",
      paragraphs: [
        greeting(input.name),
        `Someone asked for a sign-in link for your ${product} account. Your account has two-factor sign-in, so we don’t send links: one would let anyone with this inbox in without your authenticator code.`,
        "Sign in with your password and the code from your authenticator app instead.",
        "If it wasn’t you, ignore this email. Nothing has changed.",
      ],
      action: { label: "Sign in", url: input.signInUrl },
    }),
  };
}

/** After the address is confirmed (or on a social sign-up). */
export async function welcomeTemplate(input: { name?: string | null; dashboardUrl?: string }): Promise<EmailContent> {
  const product = await productName();
  return {
    subject: `Welcome to ${product}`,
    ...renderEmail({
      productName: product,
      preheader: "Your account is ready.",
      heading: `Welcome to ${product}`,
      paragraphs: [greeting(input.name), "Your account is ready. Everything starts from your dashboard."],
      ...(input.dashboardUrl ? { action: { label: "Open your dashboard", url: input.dashboardUrl } } : {}),
    }),
  };
}

export async function orgInvitationTemplate(input: { orgName: string; inviterName: string | null; role: "admin" | "member"; url: string; expiresInDays: number }): Promise<EmailContent> {
  const product = await productName();
  const who = input.inviterName ? `${input.inviterName} invited you` : "You've been invited";
  return {
    subject: `Join ${input.orgName} on ${product}`,
    ...renderEmail({
      productName: product,
      preheader: `${who} to join ${input.orgName}.`,
      heading: `Join ${input.orgName}`,
      paragraphs: [
        `${who} to join ${input.orgName} on ${product} as ${input.role === "admin" ? "an admin" : "a member"}.`,
        `The link works for ${input.expiresInDays} days, for an account with this email address. If you weren't expecting it, you can ignore this email.`,
      ],
      action: { label: `Join ${input.orgName}`, url: input.url },
    }),
  };
}

/** What changed on the account, for securityNoticeTemplate. */
export type SecurityNoticeKind = "password-changed" | "password-reset" | "two-factor-enabled" | "two-factor-disabled";

const SECURITY_NOTICES: Record<SecurityNoticeKind, { subject: (product: string) => string; heading: string; body: string }> = {
  "password-changed": {
    subject: (p) => `Your ${p} password was changed`,
    heading: "Your password was changed",
    body: "The password on your account was just changed, and every other device was signed out.",
  },
  "password-reset": {
    subject: (p) => `Your ${p} password was reset`,
    heading: "Your password was reset",
    body: "The password on your account was just reset with an emailed link, and every device was signed out.",
  },
  "two-factor-enabled": {
    subject: (p) => `Two-factor sign-in is on for ${p}`,
    heading: "Two-factor sign-in is on",
    body: "Signing in now needs a code from your authenticator app (or a backup code) as well as your password.",
  },
  "two-factor-disabled": {
    subject: (p) => `Two-factor sign-in is off for ${p}`,
    heading: "Two-factor sign-in is off",
    body: "Signing in now needs only your password. You can turn two-factor back on from your account settings.",
  },
};

/**
 * "Something changed on your account" — sent after a password change or
 * reset and when two-factor is turned on or off, so a takeover never goes unnoticed.
 */
export async function securityNoticeTemplate(input: { kind: SecurityNoticeKind; name?: string | null; url?: string }): Promise<EmailContent> {
  const product = await productName();
  const notice = SECURITY_NOTICES[input.kind];
  return {
    subject: notice.subject(product),
    ...renderEmail({
      productName: product,
      preheader: notice.body,
      heading: notice.heading,
      paragraphs: [greeting(input.name), notice.body, "If this was you, there’s nothing to do. If it wasn’t, reset your password now."],
      ...(input.url ? { action: { label: "Reset your password", url: input.url } } : {}),
    }),
  };
}

/**
 * Someone tried to sign up with an email that already has an account. Sent
 * instead of an error (when verification is required) so the sign-up form
 * never reveals which emails are registered.
 */
export async function existingAccountTemplate(input: { name?: string | null; signInUrl: string; resetUrl: string }): Promise<EmailContent> {
  const product = await productName();
  return {
    subject: `You already have a ${product} account`,
    ...renderEmail({
      productName: product,
      preheader: "Sign in instead, or reset your password.",
      heading: "You already have an account",
      paragraphs: [
        greeting(input.name),
        `Someone tried to create a ${product} account with this email, but it already has one. If it was you, sign in instead.`,
        `Forgot your password? Choose a new one here: ${input.resetUrl}`,
        "If it wasn’t you, ignore this email. Nothing has changed.",
      ],
      action: { label: "Sign in", url: input.signInUrl },
    }),
  };
}

/** A generic message for anything else the app sends (billing notices, admin notes …). */
export async function notificationTemplate(input: {
  subject: string;
  heading?: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}): Promise<EmailContent> {
  const product = await productName();
  return {
    subject: input.subject,
    ...renderEmail({
      productName: product,
      preheader: input.paragraphs[0]?.slice(0, 120) ?? input.subject,
      heading: input.heading ?? input.subject,
      paragraphs: input.paragraphs,
      action: input.action,
      footnote: input.footnote,
    }),
  };
}
