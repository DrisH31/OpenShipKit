//
// GET /admin/subscribers/export[?status=subscribed|unsubscribed] — the email
// list as CSV, for an email tool. Admins only (404 for everyone else, like the
// rest of /admin). Every cell goes through csvCell(), which neutralises
// spreadsheet formulas (=, +, -, @ …) so a hostile "email" can't run in Excel.
// The read-only demo admin is sent back to the page (?error=read_only).
// Never cached.
//

import type { SubscriberStatus } from "@/core/types";
import { csvRow } from "@/lib/csv";
import { DEMO_READ_ONLY_ERROR } from "@/core/demo";
import { isDemoUser } from "@/server/demo";
import { requireAdmin } from "@/server/session";
import { listSubscribers } from "@/server/services/community";

const MAX_ROWS = 100_000;

export async function GET(request: Request): Promise<Response> {
  const admin = await requireAdmin();
  // The read-only demo admin never downloads the list: back to the page, which says why.
  if (isDemoUser(admin)) return new Response(null, { status: 303, headers: { location: `/admin/subscribers?error=${DEMO_READ_ONLY_ERROR}`, "cache-control": "no-store" } });
  const raw = new URL(request.url).searchParams.get("status");
  const status: SubscriberStatus | undefined = raw === "subscribed" || raw === "unsubscribed" ? raw : undefined;

  let out = csvRow(["email", "status", "source", "subscribed_at"]);
  let cursor: string | null = null;
  let rows = 0;
  do {
    const page = await listSubscribers({ status, cursor, limit: 200 });
    for (const s of page.items) out += csvRow([s.email, s.status, s.source ?? "", s.createdAt]);
    rows += page.items.length;
    cursor = page.nextCursor;
  } while (cursor && rows < MAX_ROWS);

  const day = new Date().toISOString().slice(0, 10);
  return new Response(out, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subscribers-${status ?? "all"}-${day}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
