"use client";

// A dashboard page failed to render on the server: say so in customer words, offer a retry and a way to reach us.
import { RouteError } from "@/components/product/route-error";

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError audience="customer" error={error} retry={retry} home={{ label: "Dashboard home", href: "/dashboard" }} />;
}
