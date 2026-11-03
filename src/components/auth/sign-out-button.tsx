"use client";

//
// Sign out. A form posting to a server action (works without JavaScript);
// the action clears the session and redirects home.
//

import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

function Submit({ className }: { className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" loading={pending} className={className}>
      <LogOut aria-hidden />
      Sign out
    </Button>
  );
}

export function SignOutForm({ action, className }: { action: () => Promise<void>; className?: string }) {
  return (
    <form action={action}>
      <Submit className={className} />
    </form>
  );
}
