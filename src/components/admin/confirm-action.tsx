"use client";

//
// A button that asks before doing something that can't be undone (delete a
// user, a post, a plan; revoke a key). The dialog says exactly what will
// happen; its confirm button submits a small <ActionForm> with the hidden
// fields given. The action usually redirects or refreshes; a failure shows in
// the dialog, which stays open.
//
// On success the dialog closes and focus goes back to the trigger. When the
// refresh then removes the trigger's row (a revoked key), focus moves on to
// the same button in the next row, else the nearest heading (src/lib/focus.ts),
// instead of falling to the top of the page.
//

import { useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { keepFocus } from "@/lib/focus";

export function ConfirmAction({
  action,
  fields = {},
  trigger,
  triggerVariant = "destructive",
  triggerSize = "sm",
  triggerLabel,
  title,
  description,
  confirmLabel,
}: {
  action: FormAction;
  fields?: Record<string, string>;
  /** The visible trigger content. */
  trigger: React.ReactNode;
  triggerVariant?: "destructive" | "outline" | "ghost";
  triggerSize?: "sm" | "default" | "icon-sm";
  /** Accessible name when the trigger is an icon, or ambiguous in a list. */
  triggerLabel?: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const done = (ok: boolean) => {
    if (!ok) return;
    setOpen(false);
    keepFocus(document.getElementById(triggerId), { next: { item: "li, tr", target: "[data-confirm-trigger]" } });
  };
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        id={triggerId}
        data-confirm-trigger=""
        render={<Button type="button" variant={triggerVariant} size={triggerSize} aria-label={triggerLabel} />}
      >
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm action={action} onResult={(s) => done(s.ok)}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <SubmitButton variant="destructive">{confirmLabel}</SubmitButton>
          </AlertDialogFooter>
          <FormMessage hideSuccess className="mt-3" />
        </ActionForm>
      </AlertDialogContent>
    </AlertDialog>
  );
}
