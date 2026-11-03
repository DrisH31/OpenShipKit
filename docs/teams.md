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
`tests/orgs.test.ts` holds the same table written out and runs every role,
plus someone outside the organisation, against every action through the real
services. Changing who may do what therefore means changing both, and the test
fails until you do.

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
- **Whoever pays can't walk away from the bill.** The person paying for a
  renewing subscription can't leave or be removed until it's cancelled.
  Manage billing opens for whoever pays, whatever their role and even if
  they've since left the team: Polar keys the subscription to them. Deleting
  an account is refused while it would take a team with a renewing
  subscription, or cut short an existing team's paid time. "Renewing" has
  one meaning everywhere (`isRenewing()` in `src/core/types.ts`): the
  provider will charge again.

## Invitations

An admin or owner invites an address with a role. The email holds a link
`/invite/<token>`, where the token is 32 random bytes. Only its SHA-256 is
stored, so a database backup can't be used to join anyone's team.

- The link works **once**, for **7 days**, and only for an account with the
  invited address. That proves the person controls the address while sign-up
  requires email verification (the production default). A signed-out visitor is sent to sign in or sign up and
  then back to the link.
- Inviting the same address again replaces the open invitation, and the old
  link stops working. Admins and owners can revoke one from the Team page.
- If the email can't be sent, the invitation still exists and the service
  returns the link, so it can be passed on another way.
- **Limits, so invitations can't be used to send spam from your domain.** 30
  per person per hour, 100 per organisation per day, 3 per address per hour,
  and at most 100 waiting at once. The counters live in each app process (like
  every rate limit here); behind several replicas, see docs/scaling.md.

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
  to the Team page. A personal plan bought before teams were turned on still
  counts, so turning teams on cuts nobody off. It counts for that person
  only, in whichever team they work in: it opens their gates, not their
  teammates'.
- **The billing page:** it shows the organisation's plan, seats and
  payments. Any member can look, but only an owner can buy. An
  organisation's plan is a subscription (monthly or yearly), one at a time;
  changes go through Manage billing. A new plan can't be bought while the
  current one is still running out its period, so a later resume in Polar
  can't charge the team twice. The cost is a gap: when the old plan ends, the
  team is on the free plan until someone buys the new one.
- **Kept separate:** a subscription bought for an organisation never gives
  the buyer a personal plan. If the organisation is deleted, its
  subscription stays bound to it and grants nothing. And an organisation
  can't be deleted while its subscription would keep renewing.

**Per seat.** Tick **Charged per seat** on a price in `/admin/plans`, and
give it a Polar product with seat-based pricing. A checkout then buys one
seat per member and open invitation. The verified webhook records the seats,
and inviting or accepting stops at that number ("All 5 seats are in use").
A resend doesn't take a second seat. The check happens in the same database
transaction as the write, with the organisation's row locked, so simultaneous
invitations can't overshoot. Without a per-seat subscription there's no seat
limit.

**Who pays.** Polar keys a customer by email, so the subscription is billed
to the owner who bought it, and their Polar customer portal manages it. The
checkout's metadata ties it to the organisation, and the webhook reads it from
there. **Manage billing** is always the person's own billing: it shows for
anyone who pays for something (personal, or any team's, even one they've left)
and opens their Polar portal. An owner who doesn't pay is told who does. That's
"a former member" once the payer has left. After an ownership transfer, the
payer still cancels or changes it from their own Manage billing.

The rules about who may leave or delete trust the subscription rows that
webhooks wrote. If Polar can't deliver an event, it retries, and every later
event for the subscription re-fetches its current state. So a lost cancel is
corrected by the next delivery, not by guessing from dates.

## For the site admin

`/admin/orgs` lists every organisation with its member count, and each one
shows its members, open invitations, seats and subscription. It's read-only:
owners run their own organisation, and the site admin isn't a member. Agents get
the same view through MCP (`orgs_list`, `org_get`). Every team action is in
`/admin/audit`, filtered by **Organisations**.
