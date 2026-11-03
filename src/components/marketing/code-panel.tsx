import "server-only"

/* Standards (web-design): COL-1 Text contrast · PAGE-1 Content in the first byte · UI-17 Feedback where the action happened */
import { FileTextIcon, TerminalIcon } from "lucide-react"
import { CopyButton } from "@/components/product/copy-button"
import { cn } from "@/lib/utils"
import { highlightTokens, type CodeToken } from "@/server/highlight"
import { CopyLineButton } from "./copy-line-button"

/**
 * One line of a panel. `cmd` is typed at the prompt; `out` is what came back (or a
 * file's line); `note` is a `# comment`. A long command may be written over several
 * lines with a trailing ` \` on each but the last: it shows as one command, with one
 * prompt, and is copied exactly as written (the shell joins it back).
 */
export type CodeLine = { kind?: "cmd" | "out" | "note"; text: string }

/* A terminal or file excerpt, shown as proof of how something works: real commands, in
   colour, with their output beneath. A Server Component: the colours are worked out here
   (Shiki, src/server/highlight.ts) and arrive as plain spans — no highlighter ships to the
   browser; only the copy buttons are client components.
   - The look: window chrome (three dots and a mono title), commands after a muted `$`
     prompt that can't be selected or copied, output in the second ink, notes as comments.
   - Colour: commands as bash; output in `outLang` when it is a file (ini for an env file).
     highlightTokens has already raised every token to 4.5:1 against the panel's background
     in both schemes (src/shared/code-contrast.ts) — the themes' own oranges and greys fall
     short on our surfaces. `.code-tokens` (base.css) picks the scheme's colour.
   - Copy: the title bar's Copy takes every command, one per line, without prompts or
     output (`copy` overrides it: a file's lines; `false` hides it). With two or more
     commands, each also gets its own icon button in a gutter that doesn't scroll with the
     code; on a touch screen the gutter is left out (its 28 px rows can't hold 44 px
     targets) and the title bar's Copy, 44 px there, covers the block.
   - Lines never wrap (a command broken mid-token reads as two commands): a long one
     scrolls inside the panel, never the page, with a soft edge at the right while there
     is more. The scroller is focusable and named, so a keyboard can scroll it in every
     browser (Safari doesn't make scroll containers focusable on its own). */
export async function CodePanel({
  title,
  lines,
  copy,
  outLang,
  icon,
  className,
}: {
  title: string
  lines: CodeLine[]
  /** What the title bar's Copy puts on the clipboard. Default: the commands, one per line (no Copy when there are none). */
  copy?: string | false
  /** The grammar for `out` lines when they are a file's content ("ini", "yaml", "json"); plain text otherwise. */
  outLang?: string
  /** The title's icon. Default: a terminal when there are commands, else a file. */
  icon?: "terminal" | "file"
  className?: string
}) {
  const commands = lines.filter((l) => l.kind === "cmd").map((l) => forClipboard(l.text))
  const value = copy === false ? "" : (copy ?? commands.join("\n"))
  const rows = await toRows(lines, outLang)
  const gutter = commands.length > 1
  const Icon = (icon ?? (commands.length > 0 ? "terminal" : "file")) === "terminal" ? TerminalIcon : FileTextIcon

  return (
    <figure
      data-mockup
      className={cn("overflow-hidden rounded-xl border border-line-strong bg-card shadow-[0_1px_0_0_var(--line)]", className)}
    >
      <figcaption className="flex min-h-10 items-center gap-3 border-b border-line bg-[color-mix(in_oklab,var(--card),var(--ink)_3%)] py-1 pr-1.5 pl-3.5">
        <span aria-hidden className="flex shrink-0 gap-1.5">
          {[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-line-strong" />)}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-caption text-ink-3">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{title}</span>
        </span>
        {value && (
          <CopyButton
            value={value}
            size="xs"
            variant="ghost"
            srLabel={`Copy ${commands.length > 1 ? "every command" : commands.length === 1 ? "the command" : "the lines"}: ${title}`}
            className="shrink-0"
          />
        )}
      </figcaption>
      {/* --scroll-cover is the panel colour, for the scroller's right edge (.scroll-shade, base.css) */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] [--scroll-cover:var(--card)]">
        <pre
          tabIndex={0}
          role="region"
          aria-label={title}
          className="code-tokens scroll-shade overflow-x-auto py-4 pr-4 pl-4 font-mono text-small leading-7 focus-visible:outline-offset-[-2px]"
        >
          <code>
            {rows.map((row, i) => (
              <span
                key={i}
                className={cn(
                  "block whitespace-pre",
                  row.kind === "out" ? "text-ink-2" : "text-ink",
                  row.gapBefore && "mt-2",
                )}
              >
                {row.kind === "cmd" && (
                  <span aria-hidden className="text-ink-faint select-none">{row.first ? "$ " : "  "}</span>
                )}
                {row.tokens.map((t, j) => <Token key={j} token={t} />)}
                {row.tokens.every((t) => !t.content) && " "}
              </span>
            ))}
          </code>
        </pre>
        {gutter && (
          <div className="flex flex-col py-4 pr-2 pointer-coarse:hidden">
            {rows.map((row, i) => (
              <div key={i} className={cn("flex h-7 items-center", row.gapBefore && "mt-2")}>
                {row.first && row.command !== undefined && (
                  <CopyLineButton value={forClipboard(row.command)} label={`Copy: ${firstLine(row.command)}`} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}

/** One coloured token: both schemes' colours as custom properties, already raised to 4.5:1. */
function Token({ token }: { token: CodeToken }) {
  if (!token.light && !token.dark) return <>{token.content}</>
  const style = {
    "--shiki-light": token.light ?? "inherit",
    "--shiki-dark": token.dark ?? "inherit",
  } as React.CSSProperties
  return <span style={style}>{token.content}</span>
}

interface Row {
  kind: "cmd" | "out" | "note"
  tokens: CodeToken[]
  /** The first row of a command (it gets the prompt and, in the gutter, a copy button). */
  first: boolean
  /** The whole command, on its first row. */
  command?: string
  /** A little air before a command that follows output, so each command reads with its result. */
  gapBefore: boolean
}

/** A command as pasted: a trailing placeholder (`export KEY=osk_…`) is left off after its `=`, so the paste waits for the real value. */
function forClipboard(command: string): string {
  return command.replace(/[^\s=]*(?:…|\.\.\.)$/, "")
}

function firstLine(command: string): string {
  const line = command.split("\n")[0].replace(/\s*\\$/, "")
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

/** The panel's lines as rendered rows: a multi-line command becomes several rows; each row's tokens are coloured. */
async function toRows(lines: CodeLine[], outLang: string | undefined): Promise<Row[]> {
  const rows: Row[] = []
  let previous: CodeLine["kind"] | undefined
  for (const line of lines) {
    const kind = line.kind ?? "out"
    const lang = kind === "out" ? (outLang ?? null) : "bash"
    const tokenLines = await highlightTokens(line.text, lang)
    tokenLines.forEach((tokens, i) =>
      rows.push({
        kind,
        tokens,
        first: i === 0,
        command: kind === "cmd" && i === 0 ? line.text : undefined,
        gapBefore: i === 0 && kind === "cmd" && previous === "out",
      }),
    )
    previous = kind
  }
  return rows
}
