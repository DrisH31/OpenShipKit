"use server";

//
// The media library's one server action: delete an image. requireAdmin()
// first; deleteMedia refuses while a post or content section still uses the
// image (and says which), and audits. Uploads go through the route handler
// /api/admin/media instead — a server action's body is capped at 1 MB.
//

import { refresh } from "next/cache";
import { attempt, type ActionState } from "@/lib/action-state";
import { actorFor, requireAdmin } from "@/server/session";
import { deleteMedia } from "@/server/services/media";

export async function deleteMediaAction(path: string): Promise<ActionState> {
  const admin = await requireAdmin();
  return attempt("admin.media.delete", async () => {
    await deleteMedia(path, actorFor(admin));
    refresh();
    return "Image deleted.";
  });
}
