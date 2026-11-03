<!-- Thanks for contributing to OpenShipKit. Open it against `dev` (main only takes releases). Keep PRs small and focused; one change per PR. -->

## What and why

<!-- What does this change, and what problem does it solve? Link the issue: Fixes #123 -->

## How I checked it

- [ ] `npm run check` passes (typecheck, lint, tests)
- [ ] `npm run build` passes with no environment variables set
- [ ] `npm run smoke` passes against `npm run dev` (for UI, route or SEO changes)
- [ ] `npm run e2e` passes against `npm run dev` (for auth, admin, posts, forms or MCP changes)
- [ ] Tried it in the browser, light and dark, keyboard only (for UI changes)

## The rules (AGENTS.md)

- [ ] Writes go through `src/server/services/*` (validated + audited), never the DataStore from a page
- [ ] No new third-party service, SDK or tracking; Polar and Resend stay optional
- [ ] Nothing reads env or a database at build time or module scope
- [ ] Docs updated (`docs/`, `.env.example`, `AGENTS.md`) if behaviour, a variable or a command changed
- [ ] Schema change: migration generated with `npm run db:generate -- --name <change>` and committed
- [ ] None of the “Rules that cost traffic” (AGENTS.md) broken: no `revalidate` on a data page, JSON-LD as a plain script, nothing hidden at first paint, no canonical in a layout, no swallowed read errors
- [ ] An entry under “Unreleased” in CHANGELOG.md, if a site owner would notice
