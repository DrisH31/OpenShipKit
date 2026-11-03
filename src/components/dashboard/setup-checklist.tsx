//
// "Make it yours": the getting-started checklist an admin sees on /dashboard
// until the template is ready for real customers. Each step's state is read
// from the running app (content, plans, env, keys) by the page and passed in —
// this component only lays it out. Customers never see it.
//
// A step is "done", "todo", or "optional" (payments and email are optional and
// off by default; the site works without them).
//

import Link from "next/link";
import { ArrowUpRightIcon, CircleCheckIcon, CircleDashedIcon, CircleIcon } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type StepState = "done" | "todo" | "optional";

export interface SetupStep {
  id: string;
  title: string;
  /** One or two sentences: what to do, and where. */
  body: React.ReactNode;
  state: StepState;
  /** The in-app place to do it. */
  action?: { label: string; href: string };
  /** The guide for it. */
  doc?: { label: string; href: string };
}

const ICON = { done: CircleCheckIcon, todo: CircleIcon, optional: CircleDashedIcon } as const;
const WORD = { done: "Done", todo: "To do", optional: "Optional" } as const;

export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.state === "done").length;
  const pct = Math.round((done / Math.max(1, steps.length)) * 100);
  return (
    <section aria-labelledby="setup-title" className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="setup-title" className="font-sans text-body font-semibold text-ink">
            Make it yours
          </h2>
          <p className="max-w-measure text-small text-ink-2">
            A few steps from this template to a product people can pay for. Only admins see this list.
          </p>
        </div>
        <p className="tabular text-small text-ink-2">
          {done} of {steps.length} done
        </p>
      </div>
      <Progress value={pct} aria-label={`Setup progress: ${done} of ${steps.length} steps done`} />
      <ol className="flex flex-col">
        {steps.map((step, i) => {
          const Icon = ICON[step.state];
          return (
            <li key={step.id} className="flex gap-3 border-t border-line py-4 first:border-t-0 first:pt-2 last:pb-0">
              <Icon
                aria-hidden
                className={cn("mt-0.5 size-5 shrink-0", step.state === "done" ? "text-positive" : step.state === "optional" ? "text-ink-3" : "text-ink-2")}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-small font-semibold text-ink">
                  <span>
                    {i + 1}. {step.title}
                  </span>
                  <span className={cn("text-caption font-normal", step.state === "done" ? "text-positive" : "text-ink-3")}>{WORD[step.state]}</span>
                </p>
                <p className="max-w-measure text-small text-ink-2">{step.body}</p>
                {step.action || step.doc ? (
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-small">
                    {step.action ? (
                      <Link href={step.action.href} className="inline-flex min-h-8 items-center font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
                        {step.action.label}
                      </Link>
                    ) : null}
                    {step.doc ? (
                      <a href={step.doc.href} className="inline-flex min-h-8 items-center gap-1 text-ink-2 underline decoration-ink-faint underline-offset-4 hover:text-ink hover:decoration-ink">
                        {step.doc.label}
                        <ArrowUpRightIcon aria-hidden className="size-3.5" />
                        <span className="sr-only">(opens the guide on GitHub)</span>
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
