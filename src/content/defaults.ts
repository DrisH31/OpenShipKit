//
// What the site says before anyone edits it. Each value must pass its schema in
// src/core/content.ts (tests/foundation.test.ts checks). getContent() falls back
// to these when the DataStore has no row for a key, so a fresh clone renders a
// complete landing page before anything is stored.
//
// Replace this copy with your product's — in the admin (/admin/content), through
// the MCP server (content_update), or right here.
//
// Rules for this copy (DESIGN.md, "Words"): the visitor's own words, specific
// over general, nothing claimed that the code doesn't do today, no figure
// without a source, and no third-party company named except the two optional
// services the code actually supports (Polar, Resend) and the open-source tools
// it is built on.
//

import type { ContentKey, ContentValue } from "@/core/content";
import { OPENSHIPKIT_REPO } from "@/shared/project";

/**
 * The template's own repository (written once, in src/shared/project.ts). Shown
 * in the hero, the steps, the header and the footer. It is OpenShipKit's, not
 * your product's, so it is NOT a default social profile: a renamed site would
 * otherwise claim it in Organization.sameAs (Invariant 8).
 */
const REPO = OPENSHIPKIT_REPO;

export const DEFAULT_CONTENT: { [K in ContentKey]: ContentValue<K> } = {
  site: {
    name: "OpenShipKit",
    tagline: "The open-source SaaS starter you run on your own server",
    description:
      "A free, MIT-licensed SaaS starter you host yourself: Next.js 16, Postgres and Better Auth, with billing, a blog, an admin and an MCP server for AI agents.",
    keywords: [
      "saas starter",
      "next.js saas boilerplate",
      "open source saas template",
      "self-hosted saas",
      "better auth",
      "postgres",
      "drizzle",
      "mcp server",
      "polar",
    ],
    contactEmail: "",
    legalName: "",
    locale: "en",
    // Empty until you set your own (Invariant 8). The OpenShipKit showcase links its repository without them.
    social: { x: "", github: "", linkedin: "", youtube: "", discord: "" },
    ogImage: "",
  },
  navigation: {
    header: [
      { label: "Features", href: "/#features" },
      { label: "Docs", href: "/docs" },
      { label: "Pricing", href: "/pricing" },
      { label: "Blog", href: "/blog" },
      { label: "Changelog", href: "/changelog" },
    ],
    headerCta: { label: "Get the code", href: REPO },
    footer: [
      {
        title: "Product",
        links: [
          { label: "Features", href: "/#features" },
          { label: "What runs where", href: "/#own" },
          { label: "Deploy", href: "/#deploy" },
          { label: "Pricing", href: "/pricing" },
          { label: "Changelog", href: "/changelog" },
        ],
      },
      {
        title: "Resources",
        links: [
          { label: "Docs", href: "/docs" },
          { label: "Set up with an AI agent", href: "/docs/ai-setup" },
          // No "GitHub" here: the footer's social row links the template's repository on the
          // showcase only (site-footer.tsx), so a renamed site that keeps these links never does.
          { label: "Blog", href: "/blog" },
          { label: "Contact", href: "/contact" },
          { label: "RSS", href: "/blog/rss.xml" },
        ],
      },
      {
        title: "Legal",
        links: [
          { label: "Privacy", href: "/legal/privacy" },
          { label: "Terms", href: "/legal/terms" },
        ],
      },
    ],
  },
  announcement: {
    enabled: true,
    text: "OpenShipKit 1.1 is out: teams, Stripe and Razorpay, and usage billing.",
    link: { label: "What’s new", href: "/changelog" },
  },
  hero: {
    eyebrow: "Free, open-source SaaS starter",
    title: "Your SaaS, on your server",
    subtitle:
      "Sign-in, billing, a blog, an admin and an MCP server, wired together on Postgres and Better Auth that you run yourself.",
    highlights: ["No vendor lock-in", "No per-seat auth bill", "No price change you didn’t choose"],
    primaryCta: { label: "Get the code", href: REPO },
    secondaryCta: { label: "Read the docs", href: "/docs" },
    image: "",
    imageAlt: "",
  },
  logos: {
    enabled: true,
    title: "Open source, from the framework to the server",
    // Two groups: what it is built on, and the open-source hosting tools the deploy guides cover (deploy/).
    items: [
      { name: "Next.js", href: "https://nextjs.org", group: "Built on" },
      { name: "React", href: "https://react.dev", group: "Built on" },
      { name: "Postgres", href: "https://www.postgresql.org", group: "Built on" },
      { name: "Drizzle", href: "https://orm.drizzle.team", group: "Built on" },
      { name: "Better Auth", href: "https://www.better-auth.com", group: "Built on" },
      { name: "Tailwind CSS", href: "https://tailwindcss.com", group: "Built on" },
      { name: "Docker", href: "https://www.docker.com", group: "Deploys to servers you control" },
      { name: "Dokploy", href: "https://dokploy.com", group: "Deploys to servers you control" },
      { name: "Coolify", href: "https://coolify.io", group: "Deploys to servers you control" },
      { name: "Caddy", href: "https://caddyserver.com", group: "Deploys to servers you control" },
      { name: "Traefik", href: "https://traefik.io/traefik", group: "Deploys to servers you control" },
    ],
  },
  features: {
    eyebrow: "What’s in the box",
    title: "The parts every SaaS needs, done properly",
    subtitle: "Each one is production-grade, readable and yours to change. Keep what you need and delete what you don’t.",
    items: [
      {
        icon: "shield-check",
        title: "Sign-in you own",
        description:
          "Email and password, magic links, email verification and two-factor with Better Auth. Users and sessions live in your Postgres; GitHub and Google sign-in turn on when you add their keys.",
      },
      {
        icon: "credit-card",
        title: "Billing that can’t be faked",
        description:
          "Subscriptions, trials and one-time purchases through Polar, Stripe or Razorpay, off until you add a key. Access comes only from signature-verified webhooks, never from a redirect.",
      },
      {
        icon: "file-text",
        title: "A blog and a changelog",
        description:
          "Markdown posts, changelog entries and legal pages, with drafts and tags, written in the admin or by your agent.",
      },
      {
        icon: "database",
        title: "Your data, in plain Postgres",
        description:
          "A Drizzle schema with generated SQL migrations. Back it up with pg_dump, read it with psql, move it to any host that runs Postgres.",
      },
      {
        icon: "layout-dashboard",
        title: "A dashboard and an admin",
        description:
          "Billing, settings and feedback for your users. Users, content, plans, posts, subscribers, agent keys and an audit log for you.",
      },
      {
        icon: "search",
        title: "Found by search and AI answers",
        description:
          "Server-rendered pages with JSON-LD, a sitemap, RSS, generated Open Graph images and llms.txt, so search engines and assistants can read every page.",
      },
    ],
  },
  steps: {
    enabled: true,
    eyebrow: "From clone to live",
    title: "Running in one command, nothing to sign up for",
    items: [
      {
        title: "Clone and run",
        description:
          "No database to install: it starts on an embedded Postgres with sample data, and keeps your data between restarts. Every page works on the first run.",
        code: `git clone ${REPO}.git my-saas\ncd my-saas && npm install\nnpm run dev\n# open http://localhost:3000`,
      },
      {
        title: "Make it yours",
        description:
          "One command writes your env file with generated secrets. Then edit every section of the site in the admin, or ask your agent to.",
        code: "npm run setup\n# writes .env.local with generated secrets",
      },
      {
        title: "Turn on only what you need",
        description:
          "Payments and email stay off until you add a key. On your own machine free plans work and sign-in emails print to the terminal. Add Resend before a live site’s first sign-up: it needs verified emails.",
        code: "# optional, in your env file\nPOLAR_ACCESS_TOKEN=…\nPOLAR_WEBHOOK_SECRET=…\nRESEND_API_KEY=…",
      },
    ],
  },
  stats: {
    enabled: false,
    items: [],
  },
  testimonials: {
    enabled: false,
    title: "What builders say",
    items: [],
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Billing that works on day one",
    subtitle:
      "OpenShipKit is free. These are the sample plans your SaaS starts with, sold through your payment provider (Polar, Stripe or Razorpay) once you add a key. Rename, reprice or delete them in the admin under Plans.",
    note: "Prices in USD. Sample plans: edit them in the admin.",
  },
  latestPosts: {
    enabled: true,
    eyebrow: "From the blog",
    title: "Latest posts",
    subtitle: "",
    count: 3,
    linkLabel: "All posts",
  },
  faq: {
    title: "Questions, answered",
    items: [
      {
        question: "Is OpenShipKit really free?",
        answer:
          "Yes. It’s MIT licensed: use it for personal or commercial products, change anything, and sell what you build. There’s no licence key, no paid tier and no attribution required.",
      },
      {
        question: "What do I pay for to run it?",
        answer:
          "A server. The app, Postgres and sign-in all run on it, so one small VPS is enough to start. A live site also needs Resend to send its sign-in emails, and a payment provider (Polar, Stripe or Razorpay) only once you sell something. Each bills at its own rates.",
      },
      {
        question: "Why Better Auth instead of a hosted sign-in service?",
        answer:
          "Because sign-in is part of your product. Better Auth is an open-source library that runs inside your app: users, sessions and two-factor secrets live in your Postgres, there’s no per-user fee, and no one else can change the price of your login page or switch it off.",
      },
      {
        question: "Where can I deploy it?",
        answer:
          "Anywhere you can run Node.js 24 next to a Postgres database: a VPS with docker compose, Dokploy, Coolify, or a plain Node host. The build needs no secrets and no database, so it builds anywhere too.",
      },
      {
        question: "What can the MCP server do?",
        answer:
          "Most of what the admin does: read and edit every section of the site, write and publish blog posts and changelog entries, manage plans, triage feedback and, with an admin key, look up users. Each key has a scope (read, write or admin). Every change is logged, and content, posts and plans can be restored to any earlier version.",
      },
      {
        question: "Do I need a payment provider or Resend?",
        answer:
          "Not to try it. Without a payment provider's key (Polar, Stripe or Razorpay) the pricing page still shows your plans and free plans work, and on your own machine sign-in links and verification emails print to the terminal. A live site needs Resend before its first sign-up: production requires a verified email, and its log never shows the link. Add one when you’re ready to sell; access is only ever granted by its verified webhooks.",
      },
      {
        question: "Can a coding agent set it up for me?",
        answer:
          "Yes. The docs have a step-by-step prompt pack at /docs/ai-setup for Claude Code, Cursor or any coding agent: it clones, configures and runs the project, then helps you deploy it. Add the GitHub, Dokploy or Cloudflare MCP servers and it can create the repository, the deployment and the DNS record too, without leaving the chat.",
      },
      {
        question: "I don’t want to run a server. Is there a simpler option?",
        answer:
          "Yes: GetShipKit, OpenShipKit’s sibling. It’s the same idea built on hosted services (Clerk for sign-in, Supabase for the database, Polar for payments), so there’s no server, database or backup to look after. Choose OpenShipKit when you want your users’ data and your costs in your own hands.",
      },
      {
        question: "Is it for me if I don’t write code?",
        answer:
          "Probably not. OpenShipKit is a codebase for developers who want to own their stack. If you’d rather not touch code, a hosted website builder will serve you better.",
      },
    ],
  },
  cta: {
    title: "Live this weekend, on a server you own",
    subtitle: "Clone it, run it, deploy it wherever you choose. Free and MIT licensed.",
    primaryCta: { label: "Get the code", href: REPO },
    secondaryCta: { label: "Read the docs", href: "/docs" },
  },
};
