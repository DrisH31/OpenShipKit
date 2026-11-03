# Teams

Organisations for B2B products: people belong to one or more organisations,
invite others by email, and each has a role inside each organisation. Off by
default. A fresh clone is single-user, exactly as before teams existed.

```bash
OPENSHIPKIT_TENANCY=org   # personal (default) | org
```

With it on, the dashboard gets a **Team** page and `/invite/<token>` links work.
With it off, both answer 404 and no organisation code runs. Turning it off later
deletes nothing: the organisations stay in the database for when it's back on.

## Roles

Roles live inside one organisation. The site's own admin (`users.role`, the
`/admin` panel) is a different thing, and it grants nothing inside a customer's
organisation.

| | Member | Admin | Owner |
|---|:---:|:---:|:---:|
| Use the product with the team, see members | ✓ | ✓ | ✓ |
| Leave | ✓ | ✓ | ✓ (not the last owner) |
| Invite members, remove members, rename the organisation | | ✓ | ✓ |
| Invite admins, make a member an admin or an admin a member | | | ✓ |
| Manage billing, delete the organisation, transfer ownership | | | ✓ |

The one list is `PERMISSIONS` in `src/core/orgs.ts`, checked with `can()`.
`tests/orgs.test.ts` runs every role, plus someone outside the organisation,
against every action through the real services. Changing who may do what is
a one-line change there, and that test shows exactly what moved.

Rules the services keep, whatever the page shows:

- **Someone outside an organisation gets "not found"**, never "forbidden": they
  can't tell it exists.
- **There's always an owner.** The last owner can't leave, be demoted or be
  removed. They transfer ownership, which makes them an admin, or they delete
  the organisation.
- **Ownership only moves by transfer**, never by a role change or an invitation.
- **Deleting an account** is refused while it's the only owner of an
  organisation with other members. Organisations it owns alone are deleted
  with it.
- **Every change is audited** under the organisation's id (`/admin/audit`).

## Invitations

An admin or owner invites an address with a role. The email holds a link
`/invite/<token>`, where the token is 32 random bytes. Only its SHA-256 is
stored, so a database backup can't be used to join anyone's team.

- The link works **once**, for **7 days**, and only for an account with the
  invited address. A signed-out visitor is sent to sign in or sign up and
  then back to the link.
- Inviting the same address again replaces the open invitation, and the old
  link stops working. Admins and owners can revoke one from the Team page.
- If the email can't be sent, the invitation still exists and the service
  returns the link, so it can be passed on another way.

## Building on it

In a page or server action, after `requireUser()`:

```ts
import { currentOrg } from "@/server/orgs";
import { requireOrgPermission } from "@/server/services/orgs";

const access = await currentOrg(user);          // { org, role } or null (teams off, or no organisation yet)
await requireOrgPermission(user, orgId, "members.invite"); // throws "not_found" / "forbidden"
```

`currentOrg()` reads which organisation the person last worked in from a
cookie, and checks the membership on every request. The cookie is only a
preference. Your own tables should carry an `org_id` (with
`on delete cascade`) and filter by it in every query. The membership check
above is what makes that filter safe.

## What's next

- **Billing per organisation, per seat.** A subscription belongs to the
  organisation, and invitations past the seat count are refused (ROADMAP 2.4).
- **Admin and MCP.** Organisations in `/admin`, MCP tools, and the
  organisation on audit rows (ROADMAP 2.6).
