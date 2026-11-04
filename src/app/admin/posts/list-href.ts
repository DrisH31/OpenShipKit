import "server-only";

//
// Where the posts list for a kind is. The list opens on blog posts, or on the
// changelog when the blog is switched off (OPENSHIPKIT_WITHOUT=blog), and the
// default kind goes unsaid in its URL. The one place that rule lives: the
// list, its tabs, the editor's and new-post page's "back" links, and the
// redirect after a delete all ask here.
//

import type { PostKind } from "@/core/types";
import { featureOn } from "@/server/profile";

/** The kind the list shows when none is asked for. */
export function defaultPostKind(): PostKind {
  return featureOn("blog") ? "post" : "changelog";
}

/** /admin/posts for `kind`, with any extra query (deleted=1). */
export function postsListHref(kind: PostKind, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...(kind === defaultPostKind() ? {} : { kind }), ...extra }).toString();
  return `/admin/posts${q ? `?${q}` : ""}`;
}
