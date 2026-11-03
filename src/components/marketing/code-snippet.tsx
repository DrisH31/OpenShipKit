import "server-only"

/* Standards (web-design): COL-1 Text contrast · PAGE-2 The real product, shown */
import { cn } from "@/lib/utils"
import { highlightTokens } from "@/server/highlight"

/* A few lines of real code inside a picture of the product (a feature card's moment):
   coloured like CodePanel, on the same card background so the same contrast holds, but
   with no chrome, no copy and nothing focusable — the picture around it is decorative
   (its card's text says the same thing), so nothing in it may take focus. Lines that
   run long are clipped at the card's edge, not scrolled: keep them short. A `$ ` at the
   start of a line becomes a muted prompt; in bash, the lines without one are output
   (left uncoloured, in the second ink) except `# notes`, coloured as comments. */
export async function CodeSnippet({ code, lang, className }: { code: string; lang: string; className?: string }) {
  const lines = code.split("\n")
  const prompts = lines.map((l) => l.startsWith("$ "))
  // In a terminal (bash with prompts), only the commands are coloured; the rest is output, in the second ink.
  const terminal = lang === "bash" && prompts.some(Boolean)
  const tokens = terminal
    ? await Promise.all(
        lines.map(async (l, i) => (await highlightTokens(prompts[i] ? l.slice(2) : l, prompts[i] || l.startsWith("#") ? lang : null))[0] ?? []),
      )
    : await highlightTokens(code, lang)
  return (
    <pre className={cn("code-tokens overflow-hidden font-mono text-caption leading-6 text-ink", className)}>
      <code>
        {tokens.map((line, i) => (
          <span key={i} className={cn("block whitespace-pre", terminal && !prompts[i] && "text-ink-2")}>
            {prompts[i] && <span className="text-ink-faint select-none">$ </span>}
            {line.map((t, j) =>
              t.light || t.dark ? (
                <span
                  key={j}
                  style={
                    {
                      "--shiki-light": t.light ?? "inherit",
                      "--shiki-dark": t.dark ?? "inherit",
                    } as React.CSSProperties
                  }
                >
                  {t.content}
                </span>
              ) : (
                t.content
              ),
            )}
            {line.every((t) => !t.content) && " "}
          </span>
        ))}
      </code>
    </pre>
  )
}
