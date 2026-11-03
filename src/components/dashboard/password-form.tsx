"use client";

//
// Change the password — or, for an account that only signs in with GitHub or
// Google, set one. Changing it signs out every other device (the auth action
// does that and emails a notice). Fields clear after a good change.
//

import { ActionForm, FormMessage, SubmitButton, type FormAction } from "@/components/product/action-form";
import { TextField } from "@/components/product/form-fields";

export function PasswordForm({ action, hasPassword, email }: { action: FormAction; hasPassword: boolean; email: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex max-w-md flex-col gap-4">
      {/* Lets password managers file the new password under the right account. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      {hasPassword ? <TextField label="Current password" name="currentPassword" type="password" autoComplete="current-password" required /> : null}
      <TextField label={hasPassword ? "New password" : "Password"} name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required hint="At least 8 characters." />
      <TextField label="Type it again" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="outline">{hasPassword ? "Change password" : "Set password"}</SubmitButton>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
