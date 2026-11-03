//
// The IndexNow key file. Engines verify a submission by fetching
// https://<site>/<INDEXNOW_KEY>.txt and comparing the body to the key, so the
// public URL must be at the site root: next.config.ts rewrites
// /<key>.txt → /api/indexnow/<key> (a route can't be named after a value
// that lives in the environment). Without that rewrite, put the key, alone,
// in public/<key>.txt instead.
//
// Answers 200 with the key only when the requested name IS the configured
// key; every other name — and every name while IndexNow is off — is a 404,
// so this never becomes a way to learn whether a key is set. The key is
// public by design (src/server/services/indexnow.ts), so this is tidiness,
// not secrecy.
//

import { indexNowKey } from "@/server/services/indexnow";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  const requested = raw.replace(/\.txt$/, "");
  const key = indexNowKey();
  if (!key || requested !== key) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return new Response(key, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Short: rotating the key should reach the engines within the hour.
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}
