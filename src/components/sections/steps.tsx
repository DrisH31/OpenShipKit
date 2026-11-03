import "server-only";

//
// "How it works" (content key "steps"): a real sequence, so the numbers carry
// information. Each step's `code` is shown in a CodePanel (a terminal, in
// colour, with Copy), one line per line:
// "# …" is a note, "NAME=value" is an env line (shown as file content, with no
// prompt), anything else is a command. A step whose lines are all env lines is
// titled as a file, not a terminal. Hidden when disabled or empty.
//

import { CodePanel } from "@/components/marketing/code-panel";
import { Container } from "@/components/marketing/layout";
import { SectionHeader } from "@/components/marketing/section-header";
import { Steps as StepList } from "@/components/marketing/steps";
import type { CodeLine } from "@/components/marketing/code-panel";
import { getContent } from "@/server/services/content";

const ENV_LINE = /^[A-Z_][A-Z0-9_]*=/;

/** One step's code as panel lines. */
export function codeLines(code: string): CodeLine[] {
  return code
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ kind: text.startsWith("#") ? "note" : ENV_LINE.test(text) ? "out" : "cmd", text }));
}

/**
 * What an env file's Copy puts on the clipboard: its lines, without the notes,
 * and with a "…" placeholder value left empty. Pasting "POLAR_ACCESS_TOKEN=…"
 * would turn Polar on with a junk key; "POLAR_ACCESS_TOKEN=" keeps it off until
 * a real key is typed after the =.
 */
export function envCopyText(lines: CodeLine[]): string {
  return lines
    .filter((l) => l.kind === "out")
    .map((l) => l.text.replace(/=\s*(?:…|\.\.\.)\s*$/, "="))
    .join("\n");
}

function StepCode({ index, code }: { index: number; code: string }) {
  const lines = codeLines(code);
  const isFile = lines.every((l) => l.kind !== "cmd");
  // An env file's Copy takes its lines (the notes stay behind); a terminal's takes its commands.
  // Its lines are coloured as an env file (ini); a terminal's as bash.
  const copy = isFile ? envCopyText(lines) : undefined;
  return (
    <CodePanel
      className="reveal"
      title={`step ${index + 1} · ${isFile ? "env file" : "terminal"}`}
      lines={lines}
      copy={copy}
      outLang={isFile ? "ini" : undefined}
    />
  );
}

export async function Steps() {
  const steps = await getContent("steps");
  if (!steps.enabled || steps.items.length === 0) return null;

  return (
    <section id="how-it-works" aria-labelledby="steps-title" data-tone="page" className="py-section">
      <Container>
        <SectionHeader id="steps-title" eyebrow={steps.eyebrow || undefined} title={steps.title} className="max-w-3xl" />
        <StepList
          className="mt-14 sm:mt-16"
          items={steps.items.map((s, i) => ({
            title: s.title,
            body: s.description,
            visual: s.code.trim() ? (
              <StepCode index={i} code={s.code} />
            ) : undefined,
          }))}
        />
      </Container>
    </section>
  );
}
