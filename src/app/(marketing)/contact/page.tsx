//
// /contact — one short form, and a mailto fallback when the site has a contact
// address. Works without JavaScript: the form's server action (./actions.ts)
// posts back to this page, which renders the answer and, on a failure, what
// was typed. ?sent=1 or ?error=<code> (where /api/forms/contact redirects a
// plain form post) are read too; ?topic=sales (from the pricing page's
// "Contact sales") preselects the topic.
//

import type { Metadata } from "next";
import { DatabaseIcon, MailIcon, ReplyIcon } from "lucide-react";
import { Container } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { getSiteSeo } from "@/components/seo/site-seo";
import { ContactForm } from "@/components/site/contact-form";
import { isContactTopic } from "@/components/site/contact-topics";
import { getCurrentUser } from "@/server/session";
import { pageMetadata } from "@/shared/seo";
import { sendContactMessage } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { name, locale, twitterSite, ogImage, cardAlt } = await getSiteSeo();
  return pageMetadata({
    title: "Contact",
    description: `Questions about ${name}, plans or your account: send a message and a person will reply by email.`,
    path: "/contact",
    siteImage: ogImage,
    defaultImageAlt: cardAlt,
    siteName: name,
    locale,
    twitterSite,
  });
}

/** What happens to a message, in order. True to src/server/services/contact.ts: stored as feedback, then a reply by email. */
const NEXT = [
  { Icon: DatabaseIcon, text: "It’s saved in this site’s own database, not sent to a form service." },
  { Icon: ReplyIcon, text: "A person reads it and replies to the email you give." },
];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { site } = await getSiteSeo();
  const topic = first(params.topic);
  const user = await getCurrentUser().catch(() => null);

  return (
    <section aria-labelledby="contact-title" className="pt-12 pb-section sm:pt-16 lg:pt-24">
      <Container>
        <div className="grid-12 gap-x-8 gap-y-12">
          <div className="col-span-4 flex flex-col gap-8 sm:col-span-12 lg:col-span-5">
            <SectionHeader
              id="contact-title"
              level={1}
              hero
              eyebrow="Contact"
              title="Talk to a person"
              lead={`Questions about ${site.name}, a plan, or your account. Write a few lines and we’ll reply by email.`}
            />
            <ul className="flex flex-col gap-3 border-t border-line-strong pt-6" aria-label="What happens next">
              {NEXT.map(({ Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-small text-ink-2">
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  {text}
                </li>
              ))}
            </ul>
            {site.contactEmail && (
              <p className="flex items-start gap-3 text-small text-ink-2">
                <MailIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <span>
                  Prefer email? Write to{" "}
                  <a
                    href={`mailto:${site.contactEmail}`}
                    className="font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink"
                  >
                    {site.contactEmail}
                  </a>
                  .
                </span>
              </p>
            )}
          </div>
          <div className="col-span-4 sm:col-span-12 lg:col-span-6 lg:col-start-7">
            <ContactForm
              action={sendContactMessage}
              initial={{
                sent: first(params.sent) === "1",
                error: first(params.error) ?? null,
                topic: isContactTopic(topic) ? topic : "general",
              }}
              defaultEmail={user?.email ?? ""}
              defaultName={user?.name ?? ""}
            />
          </div>
        </div>
      </Container>
    </section>
  );
}
