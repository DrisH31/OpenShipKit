"use client";

// An admin page failed to render on the server: say so, offer a retry.
import { RouteError } from "@/components/product/route-error";

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError audience="admin" error={error} retry={retry} home={{ label: "Admin overview", href: "/admin" }} />;
}
