// Shown while the agent keys page's server render is in flight. Safe here: this section has no
// detail page that could call notFound() under the boundary.
import { PageSkeleton } from "@/components/product/states";

export default function Loading() {
  return <PageSkeleton label="Loading agent keys" cards={0} rows={4} />;
}
