//
// /changelog/rss.xml — RSS 2.0 of the 50 newest published changelog entries,
// each in full. Request-time: it reads the DataStore.
//

import { rssResponse } from "@/components/seo/rss";

export const dynamic = "force-dynamic";

export function GET() {
  return rssResponse({ kind: "changelog", path: "/changelog", feedPath: "/changelog/rss.xml", titleSuffix: "Changelog" });
}
