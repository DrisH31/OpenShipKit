"use client";

//
// The profile card's form: display name (editable) and email (read-only — it
// is the sign-in identity; changing it would need a verified flow).
//

import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { TextField } from "@/components/product/form-fields";

export function ProfileForm({ action, name, email, emailVerified }: { action: FormAction; name: string | null; email: string; emailVerified: boolean }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      <TextField label="Name" name="name" defaultValue={name ?? ""} maxLength={80} autoComplete="name" hint="Shown in the app and in emails we send you." className="max-w-md" />
      <div className="flex flex-col gap-2">
        <p className="text-small font-semibold text-ink" id="email-label">
          Email
        </p>
        <p aria-labelledby="email-label" className="flex flex-wrap items-center gap-2 text-small text-ink">
          <span className="break-all">{email}</span>
          <span className="text-caption text-ink-3">{emailVerified ? "Confirmed" : "Not confirmed yet"}</span>
        </p>
        <p className="text-caption text-ink-3">Your sign-in email can’t be changed here. Ask us if you need to move the account.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="outline">Save name</SubmitButton>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
