//
// The footer's social profiles: what each settings field is called, and how
// what the admin typed becomes a link (socialHref, defined in src/core/content.ts
// so Site settings validates with the same rule). Pure; safe on client and server.
//
// The Site settings fields are free text (src/core/content.ts), so this takes
// every natural way of writing a profile and returns null only for what can't
// be made into one:
//   https://x.com/acme · x.com/acme · www.linkedin.com/company/acme → that address (https)
//   @acme / acme on X, GitHub and YouTube                             → the profile URL
//   anything on X                                                     → x.com/<handle>, or null when
//     it names no X handle (the same rule as xProfileUrl in src/shared/seo.ts)
//   a bare name on LinkedIn or Discord                                → null: LinkedIn needs
//     /in/ or /company/, Discord an invite, so there is no one right address
// Anything else (a relative path, javascript:, spaces) is null, so the footer
// never renders a broken or relative link.
//

export const SOCIAL_LABELS = {
  github: "GitHub",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  discord: "Discord",
} as const;

export type SocialKey = keyof typeof SOCIAL_LABELS;

/**
 * The link for a social setting, or null when the value can't be made into
 * one. The rule lives in src/core/content.ts, where Site settings validates
 * with it too.
 */
export { socialHref } from "@/core/content";
