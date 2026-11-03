import "server-only";

//
// One changelog entry rendered in full: the date in a left rail on wide
// screens, the title linking to its permalink, and the body. On /changelog the
// <article> carries the slug as its id, so /changelog#<slug> lands on it, and
// body heading ids are prefixed with the slug so entries never share an id
// (the body's own "#heading" links are prefixed to match).
//

import Link from "next/link";
import type { Post } from "@/core/types";
import { renderMarkdown } from "@/server/markdown";
import { cn } from "@/lib/utils";
import { ArticleBody } from "./article-body";
import { formatPublishDate, isoDay, tagLabel } from "./format";

export function ChangelogEntry({
  entry,
  base,
  locale,
  standalone = false,
  className,
}: {
  entry: Post;
  base: string;
  locale: string;
  /** true on the permalink page: the title is the page's h1 and isn't a link. */
  standalone?: boolean;
  className?: string;
}) {
  const { html } = renderMarkdown(
    entry.body,
    standalone
      ? { siteOrigin: base }
      : // In the running list: ids (and the body's own "#heading" links) carry the slug, and images wait.
        { siteOrigin: base, minDepth: 3, idPrefix: entry.slug, lazyImages: true },
  );
  const Title = standalone ? "h1" : "h2";
  const headingId = `${entry.slug}-title`;
  return (
    <article
      id={standalone ? undefined : entry.slug}
      aria-labelledby={headingId}
      className={cn("grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12", className)}
    >
      <div className="md:pt-2">
        <p className="text-small text-ink-3 md:sticky md:top-[calc(var(--sticky-header)+2rem)]">
          <time dateTime={isoDay(entry.publishedAt)}>{formatPublishDate(entry.publishedAt, locale)}</time>
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <Title id={headingId} className={cn("font-display font-bold text-ink", standalone ? "text-h2" : "text-h3")}>
          {standalone ? (
            entry.title
          ) : (
            <Link href={`/changelog/${entry.slug}`} className="rounded-sm decoration-ink-faint underline-offset-4 hover:underline">
              {entry.title}
            </Link>
          )}
        </Title>
        {entry.description && <p className="max-w-measure text-lead text-ink-2">{entry.description}</p>}
        {entry.tags.length > 0 && <ChangelogTags tags={entry.tags} />}
        <ArticleBody html={html} />
      </div>
    </article>
  );
}

/** Changelog tags are labels, not links: tag pages exist for blog posts only. */
function ChangelogTags({ tags }: { tags: string[] }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag} className="inline-flex h-7 items-center rounded-full bg-tonal px-3 text-caption font-semibold text-ink-2">
          {tagLabel(tag)}
        </li>
      ))}
    </ul>
  );
}
