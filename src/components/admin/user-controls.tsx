"use client";

//
// The access controls on a user's admin page: role (a small form with a native
// select — works without JavaScript) and ban / unban. Delete lives in the page
// header behind a confirm dialog. The services enforce the rules; these forms
// show what they say.
//

import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { SelectField } from "@/components/product/form-fields";

export function RoleForm({ action, role, self }: { action: FormAction; role: "user" | "admin"; self: boolean }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-3">
      <SelectField
        label="Role"
        name="role"
        defaultValue={role}
        options={[
          { value: "user", label: "User" },
          { value: "admin", label: "Admin: full access to this panel" },
        ]}
        className="w-72 max-w-full"
        hint={self ? "This is you. Demoting yourself is allowed only while another admin exists." : undefined}
      />
      <SubmitButton variant="outline">Save role</SubmitButton>
      <FormMessage className="basis-full" />
    </ActionForm>
  );
}

export function BanForm({ action, banned, self }: { action: FormAction; banned: boolean; self: boolean }) {
  if (self) return <p className="text-small text-ink-3">You can’t ban yourself.</p>;
  return (
    <ActionForm action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton variant={banned ? "outline" : "destructive"}>{banned ? "Unban" : "Ban from the app"}</SubmitButton>
      <FormMessage />
    </ActionForm>
  );
}
