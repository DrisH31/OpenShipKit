//
// Words for statuses, in one place, so the dashboard, the admin and the
// badges always say the same thing. Status is shown as a word (and an icon in
// StatusBadge), never as colour alone.
//

import type { Entitlement, FeedbackKind, FeedbackStatus, PostKind, PostStatus, SubscriptionStatus } from "@/core/types";

export type Tone = "positive" | "warning" | "danger" | "info" | "neutral";

export const FEEDBACK_STATUS: Record<FeedbackStatus, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "info" },
  planned: { label: "Planned", tone: "neutral" },
  in_progress: { label: "In progress", tone: "warning" },
  done: { label: "Done", tone: "positive" },
  closed: { label: "Closed", tone: "neutral" },
};

export const FEEDBACK_STATUSES = Object.keys(FEEDBACK_STATUS) as FeedbackStatus[];

export const FEEDBACK_KIND: Record<FeedbackKind, string> = {
  bug: "Bug",
  feature: "Feature request",
  general: "General",
  contact: "Contact form",
};

export const FEEDBACK_KINDS = Object.keys(FEEDBACK_KIND) as FeedbackKind[];

/**
 * Where a subscriber signed up, in words. The source is the free-text tag the
 * caller of subscribe() passed ("footer" from /api/forms/newsletter); add a
 * word here when you add a form. Unknown tags show as stored.
 */
const SUBSCRIBER_SOURCE: Record<string, string> = { footer: "Site footer" };

export function subscriberSource(source: string | null): string {
  if (!source) return "—";
  return SUBSCRIBER_SOURCE[source] ?? source;
}

export const POST_KIND: Record<PostKind, { label: string; plural: string; publicPath: string }> = {
  post: { label: "Post", plural: "Blog posts", publicPath: "/blog" },
  changelog: { label: "Changelog entry", plural: "Changelog", publicPath: "/changelog" },
  page: { label: "Page", plural: "Pages", publicPath: "/legal" },
};

export const POST_STATUS: Record<PostStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Published", tone: "positive" },
};

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  trialing: { label: "Trial", tone: "info" },
  active: { label: "Active", tone: "positive" },
  past_due: { label: "Payment due", tone: "warning" },
  canceled: { label: "Canceled", tone: "neutral" },
  incomplete: { label: "Incomplete", tone: "warning" },
  unpaid: { label: "Unpaid", tone: "danger" },
  paused: { label: "Paused", tone: "neutral" },
};

/** The entitlement's status as a word and tone: "Active", "Lifetime", "Free" … */
export function entitlementStatus(e: Entitlement): { label: string; tone: Tone } {
  if (e.status === "free") return { label: "Free", tone: "neutral" };
  if (e.status === "lifetime") return { label: "Lifetime", tone: "positive" };
  if (e.cancelAtPeriodEnd && e.status !== "past_due") return { label: "Cancels at period end", tone: "warning" };
  return SUBSCRIPTION_STATUS[e.status];
}
