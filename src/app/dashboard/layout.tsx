//
// The signed-in product's frame. requireUser() here AND in every page and
// action: the layout's check is for the shell, each page's is the real one
// (layouts and pages render in parallel, and actions skip the layout).
// Never indexed.
//

import type { Metadata } from "next";
import { ProductShell } from "@/components/product/product-shell";
import { requireUser } from "@/server/session";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Dashboard" },
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/dashboard");
  return (
    <ProductShell kind="dashboard" user={user}>
      {children}
    </ProductShell>
  );
}
