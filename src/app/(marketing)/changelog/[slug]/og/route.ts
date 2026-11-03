//
// /changelog/<slug>/og — the entry's generated 1200×630 card (a "Changelog"
// eyebrow over the release's title, summary and date) at a stable URL. Both
// og:image and the Article JSON-LD name it when the entry has no cover.
// Request-time; an unknown or draft slug gets the plain site card.
//

import { postCardResponse } from "@/components/seo/post-card";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return postCardResponse(slug, "changelog");
}
