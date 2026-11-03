//
// The admin panel's frame. requireAdmin() 404s for everyone who isn't an
// admin — /admin doesn't admit it exists. Every page and every action checks
// again (layouts and pages render in parallel; actions skip the layout).
//
// No admin/loading.tsx here, on purpose: a loading boundary starts the
// streamed response (status 200) before a detail page (/admin/users/[id],
// posts, plans, content, audit) can call notFound(), so a missing id would
// answer 200. So the skeletons sit only where nothing below them can 404: in
// route groups that hold just a list page ((overview)/, users/(list)/,
// posts/(list)/, …) and in sections with no detail page (feedback,
// subscribers, agents). A link into a detail page shows <LinkPending> while
// the page renders, and a missing id stays a real 404.
//

import type { Metadata } from "next";
import { ProductShell } from "@/components/product/product-shell";
import { requireAdmin } from "@/server/session";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <ProductShell kind="admin" user={admin}>
      {children}
    </ProductShell>
  );
}
