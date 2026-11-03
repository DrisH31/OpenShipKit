# OpenShipKit docs

Guides for people building on OpenShipKit and for the coding agents helping
them. Start with **getting started**, or hand the setup to an agent with
**AI setup**; the rest is reference.

| Guide | Read it when |
|---|---|
| [Getting started](getting-started.md) | You just cloned it |
| [AI setup](ai-setup.md) | You want a coding agent to set it all up: copy-paste prompts, step by step, and the MCP servers that help |
| [Architecture](architecture.md) | You want to know where things go and why |
| [Deployment](deployment.md) | You’re choosing where it runs (VPS, Dokploy, Coolify, Node) and putting it on a server ([deploy/](../deploy/README.md) has the step-by-steps; [backups](../deploy/backups/README.md) cover the database and the uploads) |
| [Scaling](scaling.md) | Before a second server: what breaks first and what to do instead |
| [Auth](auth.md) | Sign-in methods, verification, 2FA, OAuth, admins |
| [Data](data.md) | Postgres, the embedded database, migrations, backups |
| [Billing](billing.md) | You want to charge (optional, Polar) |
| [Email](email.md) | Before real users sign up (optional, Resend) |
| [Content](content.md) | Editing the site, posts (draft or unlisted), images, legal pages |
| [Customization](customization.md) | Brand colour, copy, new pages and sections; syncing a design system |
| [Content site](site-profile.md) | A landing page + blog with no SaaS (`--profile site`) |
| [SEO](seo.md) | Metadata, structured data, sitemap, robots, llms.txt — and the rules that cost traffic when broken |
| [MCP](mcp.md) | Connecting AI agents to your site |
| [Modules](modules/README.md) | You need AI, document search, or more than one replica (opt-in: AI, RAG, Redis) |
| [Security](security.md) | The security model |
| [Teams](teams.md) | Organisations, roles, invitations (OPENSHIPKIT_TENANCY=org) |
| [Background jobs](jobs.md) | The Postgres job queue: retries, email retries, adding a job |
| [Observability](observability.md) | Structured logs, optional self-hosted error tracking, health |
| [Upgrading](upgrading.md) | Pulling template updates; Next.js and Postgres upgrades |
| [Releasing](releasing.md) | Branches, versions and tags; starting a site from a release |
| [Troubleshooting](troubleshooting.md) | Something’s wrong |

Also: [SPEC.md](../SPEC.md) (the contract), [AGENTS.md](../AGENTS.md) (for
coding agents), [.env.example](../.env.example) (every variable the app and npm scripts read).
