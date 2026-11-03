//
// A missing record inside the admin (/admin/posts/<deleted id>, a mistyped user
// id): rendered in the admin shell with a way back to its list and its audit
// trail, never the marketing 404. Still a 404. Non-admins never get here: the
// layout's requireAdmin() 404s above this boundary, with the site's own page.
//

import type { Metadata } from "next";
import { RecordNotFound } from "@/components/product/record-not-found";
import { ADMIN_NAV } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Not found" };

export default function AdminNotFound() {
  return <RecordNotFound nav={ADMIN_NAV} root={{ label: "Overview", href: "/admin" }} />;
}
