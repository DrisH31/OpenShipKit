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

## Billing per organisation

With teams on, the organisation holds the plan, and everyone in it shares it:

- **Gates:** `requirePlan(user, ["pro"])` checks the plan of the
  organisation the person is working in. Someone in no organisation is sent
  to the Team page.
- **The billing page:** it shows the organisation's plan, seats and
  payments. Any member can look, but only an owner can buy. An
  organisation's plan is a subscription (monthly or yearly), one at a time;
  changes go through Manage billing.
- **Kept separate:** a subscription bought for an organisation never gives
  the buyer a personal plan. If the organisation is deleted, its
  subscription stays bound to it and grants nothing. And an organisation
  can't be deleted while its subscription would keep renewing.

**Per seat.** Tick **Charged per seat** on a price in `/admin/plans`, and
give it a Polar product with seat-based pricing. A checkout then buys one
seat per member and open invitation. The verified webhook records the seats,
and inviting or accepting stops at that number ("All 5 seats are in use").
A resend doesn't take a second seat. Without a per-seat subscription there's
no seat limit.

**Who pays.** Polar keys a customer by email, so the subscription is billed
to the owner who bought it, and their Polar customer portal manages it. The
checkout's metadata ties it to the organisation, and the webhook reads it from
there. After an ownership transfer, the billing page and Manage billing say
who manages payment, until that's changed in Polar.

## For the site admin

`/admin/orgs` lists every organisation with its member count, and each one
shows its members, open invitations, seats and subscription. It's read-only:
owners run their own organisation, and the site admin isn't a member. Agents get
the same view through MCP (`orgs_list`, `org_get`). Every team action is in
`/admin/audit`, filtered by **Organisations**.
