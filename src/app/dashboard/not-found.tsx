//
// Something missing inside the dashboard: rendered in the product shell with a
// way back, never the marketing 404. Still a 404.
//

import type { Metadata } from "next";
import { RecordNotFound } from "@/components/product/record-not-found";
import { DASHBOARD_NAV } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Not found" };

export default function DashboardNotFound() {
  return <RecordNotFound nav={DASHBOARD_NAV} root={{ label: "Home", href: "/dashboard" }} />;
}
