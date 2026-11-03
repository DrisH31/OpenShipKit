//
// /admin/content/<key> — edit one section with the editor generated from its
// zod schema (z.toJSONSchema → FieldNode tree), or as raw JSON. Saving goes
// through updateContent (validated, audited); reset forgets the stored value.
// Unknown keys are a 404.
//

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLinkIcon, HistoryIcon } from "lucide-react";
import { CONTENT_KEYS, isContentKey } from "@/core/content";
import { buttonVariants } from "@/components/ui/button";
import { BreadcrumbLeaf } from "@/components/product/app-breadcrumb";
import { PageHeader } from "@/components/product/page-header";
import { StatusBadge } from "@/components/product/status-badge";
import { SchemaEditor } from "@/components/admin/schema-editor";
import { CONTENT_HINTS, CONTENT_LABELS, CONTENT_PLACEHOLDERS } from "@/components/admin/content-editor-config";
import { formatDateTime } from "@/lib/format";
import { withDefaults } from "@/lib/schema-form";
import { fieldNodeFor } from "@/lib/schema-node";
import { siteProfile } from "@/server/env";
import { requireAdmin } from "@/server/session";
import { getContentState } from "@/server/services/content";
import { resetContentToDefault, saveContent } from "../actions";

/** Where each section shows up, so "see it live" lands on the right page. */
const LIVE_AT: Partial<Record<string, string>> = { pricing: "/pricing" };

/** Sections the site profile doesn't show anywhere (OPENSHIPKIT_PROFILE=site: no pricing). Still editable and stored. */
const HIDDEN_UNDER_SITE: ReadonlySet<string> = new Set(["pricing"]);

/** Hints by exact path, row pattern ("items.*.icon") or any field of that name ("*.href"). */
const HINTS: Record<string, string> = {
  "*.href": "A path (/pricing), an anchor (#faq), mailto: or a full https:// address.",
  "*.icon": "A Lucide icon name in kebab-case, like shield-check or rocket.",
  "*.source": "Where the number comes from. Figures without a source are hidden in production.",
  "*.avatar": "A root-relative path or a full URL to a square photo. Leave it empty to show the quote without a photo.",
  image: "A root-relative path (/images/app.png) or a full URL. Empty shows the built-in product preview.",
  ogImage: "Empty uses the generated card at /opengraph-image.",
  keywords: "Words people search for. Used in the meta keywords.",
  tagline: "Short line used in the default page title: “Name — tagline”.",
};

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: isContentKey(key) ? `${CONTENT_KEYS[key].label} · Content` : "Content" };
}

export default async function ContentEditorPage({ params }: { params: Promise<{ key: string }> }) {
  await requireAdmin();
  const { key } = await params;
  if (!isContentKey(key)) notFound();
  const meta = CONTENT_KEYS[key];
  const state = await getContentState(key);
  const node = fieldNodeFor(meta.schema);
  const hidden = siteProfile() === "site" && HIDDEN_UNDER_SITE.has(key);

  return (
    <>
      <BreadcrumbLeaf name={meta.label} />
      <PageHeader
        eyebrow={
          <Link href="/admin/content" className="underline-offset-4 hover:underline">
            Content
          </Link>
        }
        title={meta.label}
        answer={meta.description}
        action={
          <>
            <Link
              href={`/admin/audit?entity=content&entityId=${key}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <HistoryIcon aria-hidden className="size-3.5" /> History
            </Link>
            {hidden ? null : (
              <Link
                href={LIVE_AT[key] ?? "/"}
                target="_blank"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ExternalLinkIcon aria-hidden className="size-3.5" /> See it live<span className="sr-only"> (opens a new tab)</span>
              </Link>
            )}
          </>
        }
      />
      <p className="-mt-2 flex flex-wrap items-center gap-2 text-small text-ink-2">
        <StatusBadge label={state.stored ? "Customised" : "Showing the default"} tone={state.stored ? "positive" : "neutral"} />
        {state.updatedAt ? <span>Last saved {formatDateTime(state.updatedAt)}</span> : <span>Nothing stored yet. Saving stores your version.</span>}
      </p>
      {hidden ? (
        <p className="-mt-2 max-w-3xl text-small text-ink-2">
          Not shown on the site: it runs as a content site (<code className="font-mono text-caption">OPENSHIPKIT_PROFILE=site</code>), with no pricing. What you save
          here is kept and comes back if you switch to <code className="font-mono text-caption">saas</code>.
        </p>
      ) : null}
      <div className="max-w-3xl rounded-xl border border-line bg-card px-5 pt-5 sm:px-6 sm:pt-6">
        <SchemaEditor
          node={node}
          initial={withDefaults(node, state.value)}
          action={saveContent.bind(null, key)}
          resetAction={resetContentToDefault.bind(null, key)}
          resettable={state.stored}
          hints={{ ...HINTS, ...CONTENT_HINTS[key] }}
          placeholders={CONTENT_PLACEHOLDERS[key]}
          labels={CONTENT_LABELS[key]}
          idPrefix={`content-${key}`}
        />
        <div className="pb-5 sm:pb-6" />
      </div>
    </>
  );
}
