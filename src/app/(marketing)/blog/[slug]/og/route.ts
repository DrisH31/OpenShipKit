//
// /blog/<slug>/og — the post's generated 1200×630 card at a stable URL. Both
// og:image (with the post's title as its alt text) and the BlogPosting JSON-LD
// name it when the post has no cover. Request-time; an unknown or draft slug
// gets the plain site card.
//

import { postCardResponse } from "@/components/seo/post-card";
import { featureResponse } from "@/server/profile";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const off = featureResponse("blog");
  if (off) return off;
  const { slug } = await params;
  return postCardResponse(slug, "post");
}
