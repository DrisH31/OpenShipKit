// Shown while the plan list's server render is in flight. It sits in a route group so it
// wraps only this list, not the detail pages beside it: a loading boundary
// starts the streamed response (status 200) before a detail page can call
// notFound(), so a missing id would answer 200 instead of 404 (src/app/admin/layout.tsx).
import { PageSkeleton } from "@/components/product/states";

export default function Loading() {
  return <PageSkeleton label="Loading plans" cards={0} rows={4} />;
}
