"use client";

//
// Uploading an image to the media library, two ways:
//
//   <MediaUploadForm> — the media page's form. A real multipart <form> posting
//     to /api/admin/media, so it works without JavaScript (the route answers
//     with a 303 back to the page). With JavaScript the submit is sent with
//     fetch instead: the result shows inline, the grid refreshes, the field clears.
//   <UploadCoverButton> — the post editor's "Upload cover": picks a file,
//     uploads it, and hands the stored URL back (onUploaded) to fill the
//     cover field. JavaScript only; it renders nothing until hydrated, and the
//     cover field still takes a typed URL without it.
//
// Both send Accept: application/json and read { ok, item } or { ok: false,
// message } — the server's own sentence for why a file was refused (too
// large, an SVG, not an image by its bytes). The server is the check; the
// picker's `accept` and the size check here only save a wasted upload.
//

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ImageUpIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { MAX_MEDIA_BYTES, MEDIA_ACCEPT, formatBytes, type MediaItem } from "@/core/media";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export const MEDIA_UPLOAD_ENDPOINT = "/api/admin/media";

type UploadResult = { ok: true; item: MediaItem } | { ok: false; message: string };

/** Upload one file; never throws (a network failure is a result with a message). */
export async function uploadImage(file: File): Promise<UploadResult> {
  if (file.size > MAX_MEDIA_BYTES) {
    return { ok: false, message: `That file is ${formatBytes(file.size)}; images can be up to ${formatBytes(MAX_MEDIA_BYTES)}.` };
  }
  const body = new FormData();
  body.set("file", file);
  try {
    const res = await fetch(MEDIA_UPLOAD_ENDPOINT, { method: "POST", body, headers: { Accept: "application/json" } });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; item?: MediaItem; message?: string } | null;
    if (res.ok && data?.ok && data.item) return { ok: true, item: data.item };
    return { ok: false, message: data?.message || `The upload failed (${res.status}). Try again.` };
  } catch {
    return { ok: false, message: "The upload didn’t reach the server. Check your connection and try again." };
  }
}

function ErrorLine({ id, message }: { id: string; message: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-small text-danger">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

export function MediaUploadForm({ className }: { className?: string }) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  return (
    <form
      action={MEDIA_UPLOAD_ENDPOINT}
      method="post"
      encType="multipart/form-data"
      className={cn("flex flex-col gap-3 rounded-xl border border-line bg-card p-5 sm:p-6", className)}
      onSubmit={async (event) => {
        event.preventDefault();
        const file = input.current?.files?.[0];
        if (!file) {
          setError("Choose an image to upload.");
          input.current?.focus();
          return;
        }
        setPending(true);
        setError("");
        const result = await uploadImage(file);
        setPending(false);
        if (!result.ok) {
          setError(result.message);
          input.current?.focus();
          return;
        }
        if (input.current) input.current.value = "";
        toast.success("Image uploaded. Copy its address to use it in a post.");
        router.refresh();
      }}
    >
      <label htmlFor={inputId} className="text-small font-semibold text-ink">
        Upload an image
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          ref={input}
          id={inputId}
          type="file"
          name="file"
          accept={MEDIA_ACCEPT}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-hint ${errorId}` : `${inputId}-hint`}
          className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-small text-ink file:mr-3 file:rounded-full file:border-0 file:bg-tonal file:px-3 file:py-1 file:text-small file:font-semibold file:text-ink pointer-coarse:min-h-11"
        />
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner /> : <ImageUpIcon aria-hidden />}
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
      <p id={`${inputId}-hint`} className="text-caption text-ink-3">
        PNG, JPEG, WebP, AVIF or GIF, up to {formatBytes(MAX_MEDIA_BYTES)}. SVG isn’t accepted (it can carry a script). Files get a new random name; the original name isn’t kept.
      </p>
      <ErrorLine id={errorId} message={error} />
    </form>
  );
}

/** "Upload cover" for the post editor: uploads, then calls onUploaded with the image's URL. */
const noop = () => () => {};

export function UploadCoverButton({ onUploaded, className }: { onUploaded: (url: string) => void; className?: string }) {
  // True once hydrated (false in the server HTML): a file picker needs JavaScript to fill the field.
  const ready = useSyncExternalStore(noop, () => true, () => false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  if (!ready) return null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* No name: this input never posts with the editor's form. */}
      <input
        ref={input}
        type="file"
        accept={MEDIA_ACCEPT}
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setPending(true);
          setError("");
          const result = await uploadImage(file);
          setPending(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onUploaded(result.item.url);
          toast.success("Cover uploaded. Save to keep it.");
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-busy={pending || undefined}
        aria-describedby={error ? errorId : undefined}
        onClick={() => input.current?.click()}
        className="self-start"
      >
        {pending ? <Spinner /> : <ImageUpIcon aria-hidden />}
        {pending ? "Uploading…" : "Upload cover"}
      </Button>
      <ErrorLine id={errorId} message={error} />
    </div>
  );
}
