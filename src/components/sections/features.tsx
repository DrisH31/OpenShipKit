import "server-only";

//
// The feature grid (content key "features"). Icons are content (kebab-case
// lucide names); only a curated set is bundled, so an editor can't pull the
// whole icon library into the page. An unknown name renders a neutral dot.
//
// Two forms. The OpenShipKit showcase (isShowcase) shows a bento: each card
// carries a small, real moment of the product beside its words (the sign-in
// form and the row it writes, the webhook log, the admin's nav, a pg_dump, the
// files search engines read, the post editor — ./feature-moments.tsx), so the
// section shows what each part does instead of an icon and a promise. A renamed
// site gets the plain form: no boxes, each item a hairline, an icon, a title
// and one sentence (its own features have no pictures here to show).
//

import {
  BarChart3Icon,
  BellIcon,
  BotIcon,
  BoxIcon,
  CloudIcon,
  CodeIcon,
  CreditCardIcon,
  DatabaseIcon,
  FileTextIcon,
  GaugeIcon,
  GitBranchIcon,
  GlobeIcon,
  HistoryIcon,
  KeyRoundIcon,
  LanguagesIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LockIcon,
  MailIcon,
  MessageSquareIcon,
  PaletteIcon,
  PlugIcon,
  RocketIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  UsersIcon,
  WebhookIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import type { ContentValue } from "@/core/content";
import { Container } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { cn } from "@/lib/utils";
import { getContent } from "@/server/services/content";
import { isShowcase } from "@/shared/seo";
import { FEATURE_MOMENTS } from "./feature-moments";

/** The icons a feature may name. Add one here (and import it) to make it available. */
export const FEATURE_ICONS: Record<string, LucideIcon> = {
  "bar-chart": BarChart3Icon,
  bell: BellIcon,
  bot: BotIcon,
  box: BoxIcon,
  cloud: CloudIcon,
  code: CodeIcon,
  "credit-card": CreditCardIcon,
  database: DatabaseIcon,
  "file-text": FileTextIcon,
  gauge: GaugeIcon,
  "git-branch": GitBranchIcon,
  globe: GlobeIcon,
  history: HistoryIcon,
  "key-round": KeyRoundIcon,
  languages: LanguagesIcon,
  layers: LayersIcon,
  "layout-dashboard": LayoutDashboardIcon,
  lock: LockIcon,
  mail: MailIcon,
  "message-square": MessageSquareIcon,
  palette: PaletteIcon,
  plug: PlugIcon,
  rocket: RocketIcon,
  search: SearchIcon,
  server: ServerIcon,
  "shield-check": ShieldCheckIcon,
  sparkles: SparklesIcon,
  terminal: TerminalIcon,
  users: UsersIcon,
  webhook: WebhookIcon,
  zap: ZapIcon,
};

function FeatureIcon({ name, className }: { name: string; className?: string }) {
  const Icon = FEATURE_ICONS[name];
  return (
    <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-ink ring-1 ring-line", className)}>
      {Icon ? <Icon className="size-[1.125rem]" strokeWidth={1.75} /> : <span className="size-1.5 rounded-full bg-ink-faint" />}
    </span>
  );
}

/**
 * The bento's spans on a 6-column grid, repeating every six cards: wide, narrow /
 * narrow, wide / half, half — so the eye zigzags instead of reading a table.
 */
const BENTO_SPANS = ["lg:col-span-4", "lg:col-span-2", "lg:col-span-2", "lg:col-span-4", "lg:col-span-3", "lg:col-span-3"];

type Feature = ContentValue<"features">["items"][number];

/** The showcase's card: words above, the product moment beneath in a well, its foot on the row's foot. */
function BentoCard({ item, index }: { item: Feature; index: number }) {
  const Moment = FEATURE_MOMENTS[item.icon];
  const span = BENTO_SPANS[index % BENTO_SPANS.length];
  return (
    <li className={cn("flex min-w-0 flex-col gap-6 rounded-2xl border border-line bg-card p-5 sm:p-6", span)}>
      <div className="flex flex-col gap-4">
        <FeatureIcon name={item.icon} />
        <div className="flex flex-col gap-2">
          <h3 className="font-sans text-body leading-snug font-semibold text-ink">{item.title}</h3>
          {item.description && <p className="max-w-[48ch] text-small text-ink-2">{item.description}</p>}
        </div>
      </div>
      {Moment && (
        <div aria-hidden className="mt-auto rounded-xl bg-bg p-3 ring-1 ring-line sm:p-4">
          <Moment />
        </div>
      )}
    </li>
  );
}

export async function Features() {
  const [features, site] = await Promise.all([getContent("features"), getContent("site")]);
  if (features.items.length === 0) return null;
  // The product moments describe OpenShipKit itself: a renamed site gets the plain grid.
  const showcase = isShowcase(site);

  return (
    <section id="features" aria-labelledby="features-title" data-tone="page" className="py-section">
      <Container>
        <SectionHeader
          id="features-title"
          eyebrow={features.eyebrow || undefined}
          title={features.title}
          lead={features.subtitle || undefined}
          className="max-w-3xl"
        />
        {showcase ? (
          <ul className="mt-12 grid grid-cols-1 gap-4 sm:mt-14 md:grid-cols-2 lg:grid-cols-6">
            {features.items.map((item, i) => (
              <BentoCard key={item.title} item={item} index={i} />
            ))}
          </ul>
        ) : (
          <ul className="mt-14 grid gap-x-8 gap-y-10 sm:mt-16 sm:grid-cols-2 lg:grid-cols-3 lg:gap-y-14">
            {features.items.map((item) => (
              <li key={item.title} className="flex flex-col gap-4 border-t border-line-strong pt-6">
                <FeatureIcon name={item.icon} />
                <div className="flex flex-col gap-2">
                  <h3 className="font-sans text-body leading-snug font-semibold text-ink">{item.title}</h3>
                  {item.description && <p className="max-w-[44ch] text-small text-ink-2">{item.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </section>
  );
}
