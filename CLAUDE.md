@AGENTS.md

## Claude Code notes

- **MCP:** `.mcp.json` (and `opencode.json` for OpenCode) connects this session to the running site’s MCP server
  (`OPENSHIPKIT_MCP_URL`, default `http://localhost:3000/api/mcp`) with
  `Authorization: Bearer $OPENSHIPKIT_MCP_KEY`. In development set
  `OPENSHIPKIT_MCP_KEY` to the `MCP_DEV_KEY` from `.env.local` (`npm run setup`
  writes one) before starting Claude Code; against a real site, mint a key in
  `/admin/agents`. Call the `guide` tool first. Writes are live and audited.
- Use the MCP tools to change **content** (copy, posts, plans); edit **code**
  for behaviour. Don’t edit `src/content/defaults.ts` to change what a running
  site shows — stored content overrides defaults.
- Setting up or deploying a site for someone: [docs/ai-setup.md](docs/ai-setup.md)
  has the steps in order, with what to verify and what never to do.
- Finish with `npm run check`; for UI or route changes also `npm run smoke`
  against the dev server, and `npm run e2e` when you touched auth, the admin,
  posts, forms or MCP (it writes, then cleans up after itself).
- This repository is public. Never write a real domain, server address,
  hosting account, email, name or local path into it — `example.com` and
  placeholders only. The one exception is the project’s own credit:
  “A DRISH LABS project” (drishlabs.com, where it is listed under /apps) and
  the DrisH31 GitHub owner, shown only while the site is the OpenShipKit
  showcase. OpenShipKit has no website of its own.
