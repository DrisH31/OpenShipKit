//
// /admin/media — the media library: upload an image (works without
// JavaScript), see every stored image newest first, copy an image's address
// to use in a post's cover or body, and delete one (with a confirm; refused
// while a post or content section still uses it).
//
// `?uploaded=<path>` and `?error=<code>` are the no-JavaScript upload's
// answers from /api/admin/media. The error is a FIXED code mapped to a
// sentence here, never text from the URL.
//

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { MediaUploadForm } from "@/components/admin/media-upload";
import { CopyButton } from "@/components/product/copy-button";
import { PageHeader } from "@/components/product/page-header";
import { EmptyState } from "@/components/product/states";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_READ_ONLY_MESSAGE } from "@/core/demo";
import { MAX_MEDIA_BYTES, formatBytes, isMediaPath } from "@/core/media";
import { formatDateTime } from "@/lib/format";
import { requireAdmin } from "@/server/session";
import { listMedia } from "@/server/services/media";
import { deleteMediaAction } from "./actions";

export const metadata: Metadata = { title: "Media" };

const PAGE_SIZE = 48;

const UPLOAD_ERRORS: Record<string, string> = {
  forbidden: "That upload didn’t come from this admin, so it was refused.",
  read_only: DEMO_READ_ONLY_MESSAGE,
  too_large: `That file is larger than ${formatBytes(MAX_MEDIA_BYTES)}. Export it smaller and try again.`,
  no_file: "Choose an image to upload.",
  empty: "That file is empty.",
  svg: "SVG files aren’t accepted: an SVG can carry a script. Export a PNG or WebP instead.",
  not_image: "That file isn’t a PNG, JPEG, WebP, AVIF or GIF image.",
  mismatch: "That file’s type doesn’t match its contents. Re-export it and try again.",
  unavailable: "The image couldn’t be saved. Check that the uploads folder is writable (UPLOADS_DIR).",
  error: "Something went wrong on our side. Try again in a minute.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const cursor = first(sp.cursor)?.slice(0, 200) || null;
  const page = await listMedia({ limit: PAGE_SIZE, cursor });
  const uploaded = first(sp.uploaded);
  const justUploaded = uploaded && isMediaPath(uploaded) ? uploaded : null;
  const errorCode = first(sp.error);
  const error = errorCode ? (UPLOAD_ERRORS[errorCode] ?? UPLOAD_ERRORS.error) : null;

  return (
    <>
      <PageHeader title="Media" answer="Images for post covers and bodies. Copy an image’s address into a post’s cover field, or into Markdown as ![what it shows](address)." />

      <MediaUploadForm />
      {justUploaded ? (
        <p role="status" className="text-small text-ink-2">
          Uploaded. Its address is <code className="font-mono">/uploads/{justUploaded}</code>.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="media-title" className="flex flex-col gap-3">
        <h2 id="media-title" className="font-sans text-body font-semibold text-ink">
          {cursor ? "Older images" : "Images"}
        </h2>
        {page.items.length === 0 ? (
          <EmptyState
            title={cursor ? "No older images" : "No images yet"}
            body={cursor ? "That’s every image." : "Upload one above. Images are stored on this server, in the uploads folder."}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {page.items.map((item) => (
              <li key={item.path} className="flex flex-col overflow-hidden rounded-xl border border-line bg-card">
                <a href={item.url} className="block bg-surface" aria-label={`Open the image ${item.path} in full size`}>
                  <Image
                    src={item.url}
                    alt=""
                    width={480}
                    height={270}
                    sizes="(min-width: 80rem) 20rem, (min-width: 64rem) 30vw, (min-width: 40rem) 45vw, 100vw"
                    className="aspect-video h-auto w-full object-contain"
                  />
                </a>
                <div className="flex flex-1 flex-col gap-3 p-3">
                  <p className="font-mono text-caption break-all text-ink-2">{item.url}</p>
                  <p className="text-caption text-ink-3">
                    {item.contentType.replace("image/", "").toUpperCase()} · {formatBytes(item.size)} · {formatDateTime(item.uploadedAt)}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <CopyButton value={item.url} label="Copy address" srLabel={`Copy the address of ${item.path}`} />
                    <ConfirmAction
                      action={deleteMediaAction.bind(null, item.path)}
                      trigger="Delete"
                      triggerVariant="outline"
                      triggerLabel={`Delete the image ${item.path}`}
                      title="Delete this image?"
                      description="It’s removed from the server and its address stops working. This can’t be undone. An image a post or section still uses can’t be deleted: the message will say where it’s used."
                      confirmLabel="Delete image"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor || cursor ? (
          <nav aria-label="Media pages" className="flex flex-wrap gap-3">
            {cursor ? (
              <Link href="/admin/media" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Newest
              </Link>
            ) : null}
            {page.nextCursor ? (
              <Link href={`/admin/media?cursor=${encodeURIComponent(page.nextCursor)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ImageIcon aria-hidden />
                Older images
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
