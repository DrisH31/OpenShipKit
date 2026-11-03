// Shown while a dashboard page's server render is in flight.
import { PageSkeleton } from "@/components/product/states";

export default function Loading() {
  return <PageSkeleton label="Loading the dashboard" cards={2} rows={3} />;
}
