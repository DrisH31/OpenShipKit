import "server-only";

//
// The closing band (content key "cta"): the one action again, in the page's
// single inverse band (a dark band on a light page; on a dark page it steps to
// the surface with a hairline — base.css). The primary is the solid accent
// button; the second action is an outline. `note` sits under the words (the
// showcase puts the clone command there, so the last screen can start it too).
//

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Section } from "@/components/marketing/layout";
import { Heading, Lead } from "@/components/marketing/type";
import { isGitHubUrl } from "@/lib/github";
import { cn } from "@/lib/utils";
import { ToolMarkIcon } from "./tool-mark-icon";
import { isDocsHref } from "@/components/site/docs-links";
import { docsOn } from "@/server/docs";
import { publicDocs } from "@/server/env";
import { getContent } from "@/server/services/content";
import { isShowcase } from "@/shared/seo";

export async function Cta({ note }: { note?: React.ReactNode }) {
  const [cta, site] = await Promise.all([getContent("cta"), getContent("site")]);
  // The default second action is "Read the docs": dropped where /docs isn't published (a renamed site).
  const secondary = cta.secondaryCta && isDocsHref(cta.secondaryCta.href) && !docsOn(isShowcase(site), publicDocs()) ? null : cta.secondaryCta;
  const primaryIsGitHub = isGitHubUrl(cta.primaryCta.href);

  return (
    <Section tone="inverse" aria-labelledby="cta-title" className="border-t border-line-strong">
      <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
        <div className="flex max-w-2xl flex-col">
          <Heading id="cta-title">{cta.title}</Heading>
          {cta.subtitle && <Lead className="mt-6">{cta.subtitle}</Lead>}
          {note && <div className="mt-8">{note}</div>}
        </div>
        <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row">
          <Link href={cta.primaryCta.href} className={cn(buttonVariants({ size: "lg" }), "group w-full sm:w-auto")}>
            {/* one GitHub action, one look: a GitHub link carries the mark first (as the header's), no arrow */}
            {primaryIsGitHub && <ToolMarkIcon name="GitHub" data-icon="inline-start" className="size-[1.125rem]" />}
            {cta.primaryCta.label}
            {!primaryIsGitHub && (
              <ArrowRightIcon
                aria-hidden
                data-icon="inline-end"
                className="transition-transform duration-(--dur-hover) ease-out-quart group-hover:translate-x-0.5"
              />
            )}
          </Link>
          {secondary && (
            <Link
              href={secondary.href}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full sm:w-auto")}
            >
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </Section>
  );
}
