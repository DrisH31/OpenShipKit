//
// /admin/plans/** — every plan page shares this guard: under
// OPENSHIPKIT_PROFILE=site there are no plans, so the section is a 404 (the
// admin's own not-found). Stored plans are untouched; switching back to saas
// shows them again. The server actions check the same thing (./actions.ts).
//

import { requireSaasProfile } from "@/server/profile";

export default function PlansLayout({ children }: { children: React.ReactNode }) {
  requireSaasProfile();
  return children;
}
