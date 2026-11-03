import "server-only";

//
// The media library: list stored images and upload one. Uploads go through
// the same service as /admin/media (src/server/services/media.ts): the bytes
// are identified by their magic numbers (PNG, JPEG, WebP, AVIF or GIF; SVG
// refused), capped in size, stored under a random name and audited.
//
// media_upload takes the image as BASE64 only, never a URL to fetch: fetching
// an agent-supplied URL from this server would let a fooled agent make the
// server request internal addresses (SSRF). The MCP endpoint caps a request
// at 1 MB, so an image sent this way can be up to MCP_UPLOAD_MAX_BYTES;
// larger ones go through /admin/media.
//
// There is no media_delete: a deleted file can't be restored from the audit
// log, so deletes stay with a person in /admin/media.
//

import { z } from "zod";
import { MAX_MEDIA_BYTES, formatBytes, type MediaItem } from "@/core/media";
import { siteUrl } from "@/server/env";
import { ServiceError } from "@/server/services/errors";
import { listMedia, uploadMedia } from "@/server/services/media";
import { READ_ONLY, WRITE_ADDITIVE, defineTool } from "../types";
import { paging, pagingShape } from "./shared";

/** What fits in the MCP endpoint's 1 MB body as base64 (4 characters per 3 bytes), with room for the JSON-RPC envelope. */
export const MCP_UPLOAD_MAX_BYTES = Math.min(MAX_MEDIA_BYTES, 700 * 1024);

/** An image as an agent sees it: the root-relative url to put in a post, and the absolute one to show a person. */
function mediaView(item: MediaItem) {
  return { ...item, absoluteUrl: `${siteUrl()}${item.url}` };
}

/** Strict base64 → bytes: an optional data: prefix and whitespace are allowed; anything else is refused, not skipped. */
export function decodeBase64Image(value: string): { bytes: Uint8Array; claimedType: string | null } {
  let data = value.trim();
  let claimedType: string | null = null;
  const prefix = data.match(/^data:([\w.+-]+\/[\w.+-]+)?(?:;[\w-]+=[\w.-]+)*;base64,/i);
  if (prefix) {
    claimedType = prefix[1]?.toLowerCase() ?? null;
    data = data.slice(prefix[0].length);
  }
  data = data.replace(/\s+/g, "");
  if (!data || data.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new ServiceError("invalid", "data must be the image's bytes in standard base64 (optionally as a data:image/…;base64, URL).", [{ path: "data", message: "Not valid base64" }]);
  }
  return { bytes: new Uint8Array(Buffer.from(data, "base64")), claimedType };
}

export const mediaList = defineTool({
  name: "media_list",
  title: "List images",
  description:
    "List the images in the media library, newest first: each has path, url (root-relative, e.g. /uploads/2026/10/<id>.png: put this in a post's coverImage or in Markdown as ![what it shows](url)), absoluteUrl (to show a person), contentType, size in bytes and uploadedAt. Pages through results with nextCursor.",
  scope: "read",
  annotations: READ_ONLY,
  input: z.strictObject({ ...pagingShape }),
  async run(args) {
    const page = await listMedia(paging(args));
    return { items: page.items.map(mediaView), nextCursor: page.nextCursor };
  },
});

export const mediaUpload = defineTool({
  name: "media_upload",
  title: "Upload an image",
  description: `Add an image to the media library from base64 bytes and get back its url. PNG, JPEG, WebP, AVIF or GIF only, identified by the bytes themselves; SVG is refused. Up to ${formatBytes(MCP_UPLOAD_MAX_BYTES)} through this tool (the site takes up to ${formatBytes(MAX_MEDIA_BYTES)} in /admin/media). Upload only images the person gave you or asked for, never one copied from another site. Then set the post's coverImage to the returned url and coverAlt to what the image shows. Recorded in the audit log.`,
  scope: "write",
  annotations: WRITE_ADDITIVE,
  input: z.strictObject({
    data: z
      .string()
      .min(8)
      .max(Math.ceil((MCP_UPLOAD_MAX_BYTES * 4) / 3) + 200)
      .describe("The image's bytes as base64, or a data:image/png;base64,… URL"),
    contentType: z.string().max(100).optional().describe("The image's type if you know it (image/png …). Only a cross-check: the bytes decide"),
  }),
  async run({ data, contentType }, ctx) {
    const decoded = decodeBase64Image(data);
    if (decoded.bytes.length > MCP_UPLOAD_MAX_BYTES) {
      throw new ServiceError("invalid", `That image is ${formatBytes(decoded.bytes.length)}; through MCP the limit is ${formatBytes(MCP_UPLOAD_MAX_BYTES)}. Ask the person to upload it in /admin/media (up to ${formatBytes(MAX_MEDIA_BYTES)}).`);
    }
    const item = await uploadMedia({ bytes: decoded.bytes, claimedType: contentType ?? decoded.claimedType }, ctx.actor);
    return mediaView(item);
  },
});

export const MEDIA_TOOLS = [mediaList, mediaUpload];
