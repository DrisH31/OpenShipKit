"use client";

//
// The dashboard's feedback box: kind, an optional title, the message. Posts to
// the page's server action (works without JavaScript) and clears itself after
// a good send. Errors land next to the field they belong to.
//

import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/product/form-fields";

const KINDS = [
  { value: "bug", label: "Something’s broken" },
  { value: "feature", label: "An idea or request" },
  { value: "general", label: "Anything else" },
] as const;

export function FeedbackForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-4">
      <SelectField label="What is it about?" name="kind" options={KINDS} defaultValue="bug" />
      <TextField label="Title" name="title" maxLength={140} placeholder="Export button does nothing on Safari" hint="Optional. A few words we can scan." />
      <TextAreaField
        label="What happened?"
        name="message"
        required
        minLength={3}
        maxLength={5000}
        rows={6}
        placeholder="What you did, what you expected, and what you saw instead."
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Send feedback</SubmitButton>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
