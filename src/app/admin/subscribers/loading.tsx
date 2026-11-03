// Shown while the subscriber list's server render is in flight. Safe here: this section has no
// detail page that could call notFound() under the boundary.
import { PageSkeleton } from "@/components/product/states";

export default function Loading() {
  return <PageSkeleton label="Loading subscribers" cards={0} rows={8} />;
}
