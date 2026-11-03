//
// /dashboard/team — the organisation you're working in (OPENSHIPKIT_TENANCY=org):
// its members and their roles, invitations, settings, and leaving or deleting it.
// 404 while teams are off.
//
// Every control here is only shown to a role that can use it (can(),
// canManage() in src/core/orgs.ts); the services refuse the rest anyway, so the
// page is a convenience, not the check. Forms work without JavaScript.
//

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, canManage, type OrgMember, type OrgRole } from "@/core/orgs";
import { PageHeader } from "@/components/product/page-header";
import { StatusBadge } from "@/components/product/status-badge";
import { ActionForm, FormMessage, SubmitButton } from "@/components/product/action-form";
import { SelectField, TextField } from "@/components/product/form-fields";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { currentOrg } from "@/server/orgs";
import { listInvitations, listMembers, listMyOrgs, teamsEnabled } from "@/server/services/orgs";
import { requireUser } from "@/server/session";
import {
  createOrgAction,
  deleteOrgAction,
  inviteAction,
  leaveAction,
  removeMemberAction,
  renameOrgAction,
  revokeInviteAction,
  setRoleAction,
  switchOrgAction,
  transferAction,
} from "./actions";

export const metadata: Metadata = { title: "Team" };

const ROLE: Record<OrgRole, { label: string; tone: Tone; says: string }> = {
  owner: { label: "Owner", tone: "positive", says: "Everything, including billing and deleting the organisation." },
  admin: { label: "Admin", tone: "info", says: "Invites and manages members, and renames the organisation." },
  member: { label: "Member", tone: "neutral", says: "Uses the product with the team." },
};

function Card({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5 sm:p-6">
      <h2 id={id} className="font-sans text-body font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function CreateOrgForm({ first }: { first: boolean }) {
  return (
    <ActionForm action={createOrgAction} className="flex flex-wrap items-end gap-3" resetOnSuccess>
      <TextField label={first ? "Organisation name" : "New organisation"} name="name" required maxLength={80} autoComplete="organization" className="w-80 max-w-full" />
      <SubmitButton>{first ? "Create organisation" : "Create"}</SubmitButton>
      <FormMessage className="basis-full" />
    </ActionForm>
  );
}

export default async function TeamPage() {
  const user = await requireUser("/dashboard/team");
  if (!teamsEnabled()) notFound();
  const access = await currentOrg(user);

  if (!access) {
    return (
      <>
        <PageHeader title="Team" answer="Create an organisation to work with others: invite them by email and give each a role." />
        <Card title="Create your organisation" id="create-title">
          <CreateOrgForm first />
        </Card>
      </>
    );
  }

  const { org, role } = access;
  const [members, mine, invitations] = await Promise.all([
    listMembers(user, org.id),
    listMyOrgs(user),
    can(role, "members.invite") ? listInvitations(user, org.id) : Promise.resolve([]),
  ]);
  const others = members.filter((m) => m.userId !== user.id);
  const who = (m: OrgMember) => m.name ?? m.email;

  return (
    <>
      <PageHeader title={org.name} answer={`You're ${role === "admin" ? "an admin" : `the ${role === "owner" ? "owner" : "a member"}`} here. ${ROLE[role].says}`} />

      {mine.length > 1 ? (
        <ActionForm action={switchOrgAction} className="flex flex-wrap items-end gap-3">
          <SelectField
            label="Working in"
            name="orgId"
            defaultValue={org.id}
            options={mine.map((m) => ({ value: m.org.id, label: `${m.org.name} (${ROLE[m.role].label.toLowerCase()})` }))}
            className="w-80 max-w-full"
          />
          <SubmitButton variant="outline">Switch</SubmitButton>
          <FormMessage className="basis-full" />
        </ActionForm>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Card title={`Members (${members.length})`} id="members-title">
          <div className="rounded-lg border border-line">
            <Table label="Members">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Joined</TableHead>
                  <TableHead className="px-4 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const self = m.userId === user.id;
                  const manage = !self && canManage(role, m.role);
                  return (
                    <TableRow key={m.userId}>
                      <TableCell className="px-4 py-3 whitespace-normal">
                        <span className="block text-ink">
                          {who(m)}
                          {self ? <span className="text-ink-3"> (you)</span> : null}
                        </span>
                        {m.name ? <span className="block text-caption text-ink-3 [overflow-wrap:anywhere]">{m.email}</span> : null}
                      </TableCell>
                      <TableCell>
                        {manage && role === "owner" ? (
                          <ActionForm action={setRoleAction.bind(null, org.id, m.userId)} className="flex items-end gap-2">
                            <SelectField
                              label={`Role for ${who(m)}`}
                              hideLabel
                              name="role"
                              defaultValue={m.role}
                              options={[
                                { value: "member", label: "Member" },
                                { value: "admin", label: "Admin" },
                              ]}
                              className="w-32"
                            />
                            <SubmitButton variant="ghost" size="sm" aria-label={`Save the role for ${who(m)}`}>
                              Save
                            </SubmitButton>
                            <FormMessage hideSuccess className="max-w-48 whitespace-normal" />
                          </ActionForm>
                        ) : (
                          <StatusBadge label={ROLE[m.role].label} tone={ROLE[m.role].tone} />
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{formatDate(m.joinedAt)}</TableCell>
                      <TableCell className="w-px px-4 text-right">
                        {manage ? (
                          <ActionForm action={removeMemberAction.bind(null, org.id, m.userId)} focusNext={{ item: "tr", target: "button[type=submit]" }} className="inline-flex flex-col items-end gap-1">
                            <SubmitButton variant="ghost" size="sm" aria-label={`Remove ${who(m)} from ${org.name}`}>
                              Remove
                            </SubmitButton>
                            <FormMessage hideSuccess className="max-w-48 text-left whitespace-normal" />
                          </ActionForm>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          {can(role, "members.invite") ? (
            <Card title="Invite someone" id="invite-title">
              <ActionForm action={inviteAction.bind(null, org.id)} className="flex flex-col gap-3" resetOnSuccess>
                <TextField label="Email address" name="email" type="email" required autoComplete="off" />
                <SelectField
                  label="Role"
                  name="role"
                  defaultValue="member"
                  options={[
                    { value: "member", label: "Member" },
                    ...(role === "owner" ? [{ value: "admin", label: "Admin" }] : []),
                  ]}
                  hint={role === "owner" ? undefined : "Only an owner can invite admins."}
                />
                <div>
                  <SubmitButton>Send invitation</SubmitButton>
                </div>
                <FormMessage />
              </ActionForm>
              {invitations.length > 0 ? (
                <div className="flex flex-col gap-2 border-t border-line pt-4">
                  <h3 className="text-small font-semibold text-ink">Waiting to accept</h3>
                  <ul className="flex flex-col gap-2">
                    {invitations.map((inv) => (
                      <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 text-small">
                        <span className="text-ink [overflow-wrap:anywhere]">
                          {inv.email} <span className="text-ink-3">· {inv.role} · until {formatDate(inv.expiresAt)}</span>
                        </span>
                        <ActionForm action={revokeInviteAction.bind(null, org.id, inv.id)} className="inline-flex flex-col items-end gap-1">
                          <SubmitButton variant="ghost" size="sm" aria-label={`Revoke the invitation for ${inv.email}`}>
                            Revoke
                          </SubmitButton>
                          <FormMessage hideSuccess className="max-w-48 whitespace-normal" />
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          {can(role, "org.rename") ? (
            <Card title="Settings" id="settings-title">
              <ActionForm action={renameOrgAction.bind(null, org.id)} className="flex flex-col gap-3">
                <TextField label="Name" name="name" defaultValue={org.name} required maxLength={80} />
                <TextField label="Address name" name="slug" defaultValue={org.slug} hint="Lower-case letters, digits and hyphens." maxLength={48} />
                <div>
                  <SubmitButton variant="outline">Save</SubmitButton>
                </div>
                <FormMessage />
              </ActionForm>
            </Card>
          ) : null}

          <Card title="Your organisations" id="orgs-title">
            <p className="text-small text-ink-2">Start another one: you’ll be its owner.</p>
            <CreateOrgForm first={false} />
          </Card>

          <Card title="Leave or delete" id="danger-title">
            {role === "owner" && others.length > 0 ? (
              <ActionForm action={transferAction.bind(null, org.id)} className="flex flex-wrap items-end gap-3">
                <SelectField
                  label="Make someone else the owner"
                  name="userId"
                  defaultValue=""
                  options={[{ value: "", label: "Choose a member" }, ...others.map((m) => ({ value: m.userId, label: who(m) }))]}
                  hint="They become the owner and you become an admin."
                  className="w-72 max-w-full"
                />
                <SubmitButton variant="outline">Transfer ownership</SubmitButton>
                <FormMessage className="basis-full" />
              </ActionForm>
            ) : null}
            <ActionForm action={leaveAction.bind(null, org.id)} className="flex flex-wrap items-center gap-3">
              <SubmitButton variant="outline">Leave {org.name}</SubmitButton>
              <FormMessage />
            </ActionForm>
            {can(role, "org.delete") ? (
              <ActionForm action={deleteOrgAction.bind(null, org.id, org.name)} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
                <TextField label={`Type “${org.name}” to delete it for everyone`} name="confirm" autoComplete="off" className="w-80 max-w-full" />
                <SubmitButton variant="destructive">Delete organisation</SubmitButton>
                <FormMessage className="basis-full" />
              </ActionForm>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
