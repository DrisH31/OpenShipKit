"use client";

//
// The triage form under each feedback item: status and a private note (never
// shown to the person who sent it). Works without JavaScript.
//
// Under a status filter, a saved status can take the item out of the list:
// focus then moves to the next item (else the previous, else the page's
// heading), so triage goes on from the keyboard without starting at the top.
//

import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { SelectField, TextAreaField } from "@/components/product/form-fields";
import { FEEDBACK_STATUS, FEEDBACK_STATUSES } from "@/lib/status";
import type { FeedbackStatus } from "@/core/types";

export function FeedbackTriage({ action, status, note }: { action: FormAction; status: FeedbackStatus; note: string | null }) {
  return (
    <ActionForm action={action} focusNext={{ item: "li", target: "" }} className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <SelectField label="Status" name="status" defaultValue={status} options={FEEDBACK_STATUSES.map((s) => ({ value: s, label: FEEDBACK_STATUS[s].label }))} />
        <TextAreaField label="Private note" name="adminNote" defaultValue={note ?? ""} maxLength={5000} rows={2} placeholder="Only admins see this." />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="outline" size="sm">
          Save
        </SubmitButton>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
