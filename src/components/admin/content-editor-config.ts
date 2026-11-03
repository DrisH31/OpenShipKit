//
// The content editor's words: labels for each section's fields, by content
// key, where the schema's own key reads wrong as a label. A list's label also
// names its rows and its Add button ("Header links" → "Header link 2",
// "Add header link"), and the screen-reader messages for moving them. Then
// hints and example values (placeholders) for fields whose format isn't
// obvious, by content key. Plain data, so it crosses into the client
// SchemaEditor as props.
//

import type { ContentKey } from "@/core/content";

const BUTTONS = { primaryCta: "Main button", secondaryCta: "Second button" };

export const CONTENT_LABELS: Partial<Record<ContentKey, Record<string, string>>> = {
  navigation: {
    header: "Header links",
    headerCta: "Header button",
    footer: "Footer columns",
    "footer.*.links": "Links",
  },
  hero: BUTTONS,
  cta: BUTTONS,
  logos: { items: "Logos" },
  features: { items: "Features" },
  steps: { items: "Steps" },
  stats: { items: "Figures" },
  testimonials: { items: "Quotes" },
  faq: { items: "Questions" },
  latestPosts: { count: "Posts to show", linkLabel: "Link to the blog" },
  site: {
    social: "Social profiles",
    "social.x": "X",
    "social.github": "GitHub",
    "social.linkedin": "LinkedIn",
    "social.youtube": "YouTube",
    "social.discord": "Discord",
  },
};

/** Hints by content key, then path or pattern; added to the editor's shared hints. */
export const CONTENT_HINTS: Partial<Record<ContentKey, Record<string, string>>> = {
  latestPosts: {
    count: "How many of the newest posts to show, 1 to 6. Unlisted posts are never shown here.",
    linkLabel: "The link to the blog under the posts. Empty hides it.",
  },
  // What the footer can link (src/components/site/social-links.ts; the schema refuses the rest).
  site: { social: "A full https:// address, or @handle for X, GitHub and YouTube." },
};

/** Example values for empty fields, by content key, then path or pattern. Examples only: never a real profile. */
export const CONTENT_PLACEHOLDERS: Partial<Record<ContentKey, Record<string, string>>> = {
  site: {
    "social.x": "https://x.com/yourname",
    "social.github": "https://github.com/yourorg",
    "social.linkedin": "https://www.linkedin.com/company/yourco",
    "social.youtube": "https://www.youtube.com/@yourchannel",
    "social.discord": "https://discord.gg/invite",
  },
};
