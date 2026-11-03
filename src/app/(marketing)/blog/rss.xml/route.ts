//
// /blog/rss.xml — RSS 2.0 of the 50 newest published posts, with the full
// sanitised HTML in content:encoded, absolute links, lastBuildDate and an
// atom:link rel="self". Request-time: it reads the DataStore.
//

import { rssResponse } from "@/components/seo/rss";

export const dynamic = "force-dynamic";

export function GET() {
  return rssResponse({ kind: "post", path: "/blog", feedPath: "/blog/rss.xml", titleSuffix: "Blog" });
}
