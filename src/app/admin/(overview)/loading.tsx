// Shown while the admin overview's server render is in flight. It sits in a route group so it
// wraps only the overview, not the admin pages nested under /admin: a loading boundary
// starts the streamed response (status 200) before a detail page can call
// notFound(), so a missing id would answer 200 instead of 404 (src/app/admin/layout.tsx).
import { PageSkeleton } from "@/components/product/states";

export default function Loading() {
  return <PageSkeleton label="Loading the overview" cards={3} rows={5} />;
}
