"use client";

//
// The post editor (blog post, changelog entry or page): title and slug, the
// Markdown body with Write / Preview, and the details that feed lists, SEO and
// RSS. One <ActionForm> with ordinary inputs, so it saves without JavaScript.
//
//   - Preview renders on the SERVER with renderMarkdown — the same renderer and
//     sanitiser as the public page — so what you see is what ships.
//   - The body textarea is hidden, never unmounted, while previewing, so the
//     form always posts what you wrote.
//   - The preview is a focusable region, not a live region: a short status
//     says "Rendering…" / "Preview ready", and focus moves into the region
//     so a screen reader reads the post at the person's pace (a live region
//     would read the whole article aloud on every preview).
//   - New posts derive the slug from the title until you edit the slug.
//   - Buttons carry an intent: Save (keep status), Publish, Unpublish.
//   - "Show on the blog list" is `listed`: a different question from
//     published. Unticked, a published post stays live at its address, in the
//     sitemap and the feed, but leaves /blog, tag pages and the home page.
//     (Not shown for pages, which have no list.)
//   - "Upload cover" (JavaScript) puts an image in the media library and fills
//     the cover field; the field still takes a typed address without it.
//

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EyeIcon, PencilIcon } from "lucide-react";
import type { Post, PostKind } from "@/core/types";
import { ActionForm, CLEAR_OF_STICKY_BAR, FieldIssues, FormMessage, SubmitButton, useActionForm, type FormAction } from "@/components/product/action-form";
import { CheckboxField, INVALID_WRAPPER, TextAreaField, TextField } from "@/components/product/form-fields";
import { UploadCoverButton } from "./media-upload";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { IDLE } from "@/lib/action-state";
import { toDateTimeLocal } from "@/lib/format";
import { POST_KIND } from "@/lib/status";
import { slugify } from "@/shared/slug";
import { cn } from "@/lib/utils";

function BodyField({ initial, preview }: { initial: string; preview: FormAction }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [state, render, pending] = useActionState(preview, IDLE);
  const { state: formState } = useActionForm();
  const invalid = !formState.ok && (formState.issues ?? []).some((i) => i.path === "body");
  // Set when the person asks for a preview; the render's arrival moves focus into it.
  const enterPreview = useRef(false);

  useEffect(() => {
    if (pending || !enterPreview.current) return;
    enterPreview.current = false;
    region.current?.focus({ preventScroll: true });
  }, [pending, state]);

  const show = (next: "write" | "preview") => {
    setMode(next);
    if (next === "preview") {
      enterPreview.current = true;
      const data = new FormData();
      data.set("body", area.current?.value ?? "");
      startTransition(() => render(data));
    } else requestAnimationFrame(() => area.current?.focus());
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="post-body" className="text-small font-semibold text-ink">
          Body
        </label>
        <div role="group" aria-label="Body view" className="inline-flex gap-1 rounded-full bg-tonal p-1">
          {(
            [
              ["write", "Write", PencilIcon],
              ["preview", "Preview", EyeIcon],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => show(m)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-small font-semibold text-ink-2 hover:text-ink pointer-coarse:h-11",
                mode === m && "bg-raised text-ink shadow-sm dark:bg-surface",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <Textarea
        ref={area}
        id="post-body"
        name="body"
        defaultValue={initial}
        hidden={mode === "preview"}
        rows={20}
        spellCheck
        className="field-sizing-fixed min-h-80 font-mono text-small leading-relaxed"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? "post-body-hint post-body-error" : "post-body-hint"}
      />
      {mode === "preview" ? (
        <div
          ref={region}
          role="region"
          aria-label="Preview"
          tabIndex={-1}
          aria-busy={pending || undefined}
          className="min-h-80 rounded-md border border-input bg-bg px-5 py-4"
        >
          {pending ? (
            <p className="flex items-center gap-2 text-small text-ink-3">
              <Spinner /> Rendering…
            </p>
          ) : state.ok && typeof state.data?.html === "string" ? (
            state.data.html.trim() ? (
              <>
                <p className="mb-4 text-caption text-ink-3">{state.message} Rendered exactly as the public page renders it.</p>
                {/* Sanitised by renderMarkdown on the server (an allowlist), the same as the public page. */}
                <div className="prose" dangerouslySetInnerHTML={{ __html: state.data.html }} />
              </>
            ) : (
              <p className="text-small text-ink-3">Nothing to preview yet. Write something first.</p>
            )
          ) : state.at ? (
            <p role="alert" className="text-small text-danger">
              {state.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <p role="status" className="sr-only">
        {mode !== "preview" ? "" : pending ? "Rendering the preview…" : state.ok && state.at ? `Preview ready. ${state.message}` : ""}
      </p>
      <p id="post-body-hint" className="text-caption text-ink-3">
        Markdown with GitHub extras: tables, task lists, fenced code. A <code className="font-mono">#</code> heading becomes a section heading; the title above is the page’s
        only H1.
      </p>
      <FieldIssues path="body" id="post-body-error" />
    </div>
  );
}

/** Title and address together: a new post's address follows the title until the person edits it. */
function TitleAndSlug({ kind, post }: { kind: PostKind; post: Post | null }) {
  const { state } = useActionForm();
  const isNew = !post;
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [touched, setTouched] = useState(!isNew);
  const base = POST_KIND[kind].publicPath;
  const invalid = !state.ok && (state.issues ?? []).some((i) => i.path === "slug");
  return (
    <>
      <TextField
        label="Title"
        name="title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (!touched) setSlug(slugify(e.target.value));
        }}
        required
        maxLength={200}
        className="[&_input]:text-body"
      />
      <div className="flex flex-col gap-2">
        <label htmlFor="post-slug" className="text-small font-semibold text-ink">
          Address
        </label>
        {/* The ring sits on the wrapper (the input and its path prefix read as one field), like every other field's. */}
        <div className={cn("flex min-w-0 items-center rounded-md border border-input focus-within:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus", INVALID_WRAPPER)}>
          <span className="shrink-0 border-r border-input px-3 font-mono text-caption text-ink-3">{base}/</span>
          <input
            id="post-slug"
            name="slug"
            value={slug}
            onChange={(e) => {
              setTouched(true);
              setSlug(e.target.value);
            }}
            placeholder={isNew ? "from-the-title" : undefined}
            maxLength={120}
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "post-slug-hint post-slug-error" : "post-slug-hint"}
            className="h-10 min-w-0 flex-1 bg-transparent px-3 font-mono text-body text-ink outline-none pointer-coarse:h-11 md:text-small"
          />
        </div>
        <p id="post-slug-hint" className="text-caption text-ink-3">
          Lower-case words joined by hyphens. {isNew ? "Filled from the title until you edit it." : "Changing it breaks links people already have."}
        </p>
        <FieldIssues path="slug" id="post-slug-error" />
      </div>
    </>
  );
}

/**
 * The cover and its alt text. The alt field shows once there is a cover; it is
 * hidden, never unmounted, so emptying the cover by mistake doesn't lose it.
 * Without JavaScript it shows when the saved post has a cover.
 */
function CoverFields({ post }: { post: Post | null }) {
  const [cover, setCover] = useState(post?.coverImage ?? "");
  return (
    <>
      <TextField
        label="Cover image"
        name="coverImage"
        value={cover}
        onChange={(e) => setCover(e.target.value)}
        maxLength={500}
        hint={
          <>
            An image from the{" "}
            <Link href="/admin/media" className="underline underline-offset-4">
              media library
            </Link>{" "}
            (/uploads/…), a root-relative path or a full URL. Empty uses the generated
            card.
          </>
        }
      />
      <UploadCoverButton onUploaded={setCover} />
      <div hidden={!cover.trim()}>
        <TextAreaField
          label="Cover description"
          name="coverAlt"
          defaultValue={post?.coverAlt ?? ""}
          maxLength={300}
          rows={2}
          hint="What the image shows, for screen readers and link previews. Leave it empty if the image is only decoration."
        />
      </div>
    </>
  );
}

export function PostEditor({
  kind,
  post,
  action,
  preview,
  canPublish = true,
}: {
  kind: PostKind;
  post: Post | null;
  action: FormAction;
  preview: FormAction;
  /** False when this kind can't be published here (a blog post with OPENSHIPKIT_WITHOUT=blog): drafts only. */
  canPublish?: boolean;
}) {
  const isNew = !post;
  const published = post?.status === "published";
  const word = POST_KIND[kind].label.toLowerCase();
  return (
    // Every control keeps a bar's height clear below it when focus scrolls it into
    // view, so the sticky save bar never covers the focused field (WCAG 2.4.11).
    <ActionForm action={action} className={cn("flex flex-col gap-6", CLEAR_OF_STICKY_BAR)}>
      {isNew ? <input type="hidden" name="kind" value={kind} /> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5 rounded-xl border border-line bg-card p-5 sm:p-6">
          <TitleAndSlug kind={kind} post={post} />
          <TextAreaField
            label="Summary"
            name="description"
            defaultValue={post?.description ?? ""}
            maxLength={300}
            rows={2}
            hint="One or two sentences for lists, RSS and the meta description."
          />
          <BodyField initial={post?.body ?? ""} preview={preview} />
        </div>

        <aside className="flex flex-col gap-5 rounded-xl border border-line bg-card p-5" aria-label="Details">
          <TextField label="Tags" name="tags" defaultValue={(post?.tags ?? []).join(", ")} hint="Comma-separated, up to 10." />
          {kind === "page" ? null : (
            <>
              {/* Marks that the form carries the checkbox: an unticked box posts nothing (see posts/actions.ts). */}
              <input type="hidden" name="listedField" value="1" />
              <CheckboxField
                label={kind === "changelog" ? "Show on the changelog" : "Show on the blog list"}
                name="listed"
                defaultChecked={post?.listed ?? true}
                hint={
                  kind === "changelog"
                    ? "Untick to keep it live at its address, in the sitemap and the feed, but off the changelog list."
                    : "Untick to keep it live at its address, in the sitemap and the feed, but off /blog, tag pages and the home page."
                }
              />
            </>
          )}
          <TextField label="Author" name="authorName" defaultValue={post?.authorName ?? ""} maxLength={80} />
          <CoverFields post={post} />
          {/* What the field showed: the save sends the date only when it was changed (see posts/actions.ts). */}
          {post ? <input type="hidden" name="publishedAtWas" value={toDateTimeLocal(post.publishedAt)} /> : null}
          <TextField
            label="Publish date"
            name="publishedAt"
            type="datetime-local"
            defaultValue={toDateTimeLocal(post?.publishedAt)}
            hint={published ? "In UTC. Empty keeps the current date." : "In UTC. Empty: set when you first publish."}
          />
          <TextField label="SEO title" name="seoTitle" defaultValue={post?.seoTitle ?? ""} maxLength={70} hint="Up to 70 characters. Empty uses the title." />
          <TextAreaField
            label="SEO description"
            name="seoDescription"
            defaultValue={post?.seoDescription ?? ""}
            maxLength={170}
            rows={3}
            hint="Aim for 155 characters or fewer, with the main claim first: search results cut the rest. Empty uses the summary."
          />
        </aside>
      </div>

      <div data-sticky-save className="sticky bottom-0 z-[1] flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card/95 px-4 py-3 backdrop-blur-sm">
        {published ? (
          <>
            <SubmitButton name="intent" value="save">
              Save changes
            </SubmitButton>
            <SubmitButton name="intent" value="unpublish" variant="outline">
              Unpublish
            </SubmitButton>
          </>
        ) : (
          <>
            {canPublish ? (
              <SubmitButton name="intent" value="publish">
                Publish {word}
              </SubmitButton>
            ) : null}
            <SubmitButton name="intent" value="save" variant={canPublish ? "outline" : "default"}>
              Save draft
            </SubmitButton>
            {canPublish ? null : <span className="text-caption text-ink-3">The blog is switched off, so this stays a draft.</span>}
          </>
        )}
        <FormMessage />
      </div>
    </ActionForm>
  );
}
