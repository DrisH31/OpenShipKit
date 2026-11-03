//
// The byline row: author, published date, updated date (only when it moved to
// a later day) and reading time. Real <time> elements so crawlers and AI
// readers get the dates the JSON-LD states. The dots come from MetaList, which
// never leaves one at the start of a wrapped line. Server component.
//

import { MetaList } from "@/components/product/meta-list";
import { cn } from "@/lib/utils";
import { formatPublishDate, isoDay, readingLabel, wasUpdated } from "./format";

export function PostMeta({
  publishedAt,
  updatedAt,
  readingMinutes,
  authorName,
  locale,
  className,
}: {
  publishedAt: string | null;
  updatedAt?: string | null;
  readingMinutes?: number;
  authorName?: string | null;
  locale?: string;
  className?: string;
}) {
  const parts: React.ReactNode[] = [];
  if (authorName) parts.push(<span key="author">By <span className="text-ink-2">{authorName}</span></span>);
  if (publishedAt) {
    parts.push(
      <time key="published" dateTime={isoDay(publishedAt)}>
        {formatPublishDate(publishedAt, locale)}
      </time>,
    );
  }
  if (wasUpdated(publishedAt, updatedAt)) {
    parts.push(
      <span key="updated">
        Updated <time dateTime={isoDay(updatedAt)}>{formatPublishDate(updatedAt, locale)}</time>
      </span>,
    );
  }
  if (readingMinutes) parts.push(<span key="reading">{readingLabel(readingMinutes)}</span>);
  if (parts.length === 0) return null;

  // MetaList draws each separator before its item and clips the one that starts a line,
  // so a wrapped byline never begins with a lone "·".
  return <MetaList className={cn("text-small text-ink-3", className)}>{parts}</MetaList>;
}
