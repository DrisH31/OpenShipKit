import "server-only";

//
// The media registry: the S3-compatible bucket when MEDIA_STORAGE=s3 (or
// S3_BUCKET is set), else null and the disk under UPLOADS_DIR is used
// (src/server/services/media-storage.ts). Built once, lazily, so the build and
// a disk site never read the S3 variables.
//

import type { S3MediaStore } from "@/adapters/media/s3";
import { mediaStorage, optionalEnv, requireEnv } from "./env";

let store: Promise<S3MediaStore> | null = null;

export async function getBucket(): Promise<S3MediaStore | null> {
  if (mediaStorage() !== "s3") return null;
  store ??= import("@/adapters/media/s3").then((m) =>
    m.createS3MediaStore({
      endpoint: requireEnv("S3_ENDPOINT", "S3 media storage"),
      bucket: requireEnv("S3_BUCKET", "S3 media storage"),
      region: optionalEnv("S3_REGION") ?? "auto",
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID", "S3 media storage"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY", "S3 media storage"),
      // "uploads", "/uploads/" and "uploads/" are the same folder; "/" is the bucket's root (unset or empty: "uploads/").
      prefix: ((p) => (p ? `${p}/` : ""))((optionalEnv("S3_PREFIX") ?? "uploads").replace(/^\/+|\/+$/g, "")),
    }),
  );
  return store;
}
