"use client"

/* Standards (web-design): UI-26 A jump leaves a way back · MOT-8 Reduced motion ships less · LAY-4 Touch targets */
import * as React from "react"
import { usePathname } from "next/navigation"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/* A JUMP LEAVES A WAY BACK (after Rauno Freiberg's scroll landmarks).
   A reader on a long page follows a link to another part of it (a contents entry, a footnote, a
   search result) and has lost where they were. After any in-page jump of more than about a screen,
   a small "Back to where you were" waits at the bottom; one press returns to the spot. It goes once
   used, once the reader scrolls back there by themselves, after another jump (which leaves its own),
   and on leaving the page.
   - Works on the window and on any inner scroller: the jump's target says which one moved.
   - A jump is a same-page link pressed, or a hashchange (the command palette's jumps), whose target
     ALREADY EXISTED; a hash that switches what is rendered (the catalogue's list) is not a jump.
   - Where the reader "was" is where they last stopped scrolling, not wherever a smooth scroll
     happened to be. */

type Scroller = Element | Window
const topOf = (s: Scroller) => (s instanceof Window ? s.scrollY : s.scrollTop)
const heightOf = (s: Scroller) => (s instanceof Window ? s.innerHeight : s.clientHeight)
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "off"

function scrollerOf(el: Element): Scroller {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight) return p
  }
  return window
}

const targetOf = (hash: string) => {
  if (hash.length < 2) return null
  try { return document.getElementById(decodeURIComponent(hash.slice(1))) } catch { return null }
}

/** Put once in the root layout; renders nothing until a long in-page jump. A page with a bar fixed
    to the bottom sets `--return-mark-offset` (its height) on :root, so the mark waits above it. */
export function ReturnMark({ className }: { className?: string }) {
  const [mark, setMark] = React.useState<{ scroller: Scroller; y: number; up: boolean } | null>(null)
  const shown = React.useRef(mark)
  React.useEffect(() => { shown.current = mark }, [mark])

  React.useEffect(() => {
    const rest = new Map<Scroller, number>()
    const timers = new Map<Scroller, number>()
    let pending: { scroller: Scroller; y: number } | null = null

    const settled = (s: Scroller) => {
      const now = topOf(s)
      rest.set(s, now)
      if (pending?.scroller === s) {
        const far = Math.abs(now - pending.y) > heightOf(s) * 0.75
        setMark(far ? { scroller: s, y: pending.y, up: pending.y < now } : null)
        pending = null
      } else if (shown.current?.scroller === s && Math.abs(now - shown.current.y) < heightOf(s) / 3) {
        setMark(null) // they went back by themselves
      }
    }
    const onScroll = (e: Event) => {
      const s: Scroller = e.target === document ? window : (e.target as Element)
      if (!rest.has(s)) rest.set(s, topOf(s))
      clearTimeout(timers.get(s))
      timers.set(s, window.setTimeout(() => settled(s), 150))
    }
    const jump = (hash: string, origin?: number) => {
      const target = targetOf(hash)
      if (!target) return
      const s = scrollerOf(target)
      pending = { scroller: s, y: origin ?? rest.get(s) ?? topOf(s) }
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element).closest?.("a[href*='#']") as HTMLAnchorElement | null
      if (!a || a.origin !== location.origin || a.pathname !== location.pathname || !targetOf(a.hash)) return
      const s = scrollerOf(targetOf(a.hash)!)
      jump(a.hash, rest.get(s) ?? topOf(s))
    }
    const onHash = () => { if (!pending) jump(location.hash) }

    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    document.addEventListener("click", onClick, true)
    window.addEventListener("hashchange", onHash)
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true })
      document.removeEventListener("click", onClick, true)
      window.removeEventListener("hashchange", onHash)
      for (const t of timers.values()) clearTimeout(t)
    }
  }, [])

  // A new page has nowhere to go back to.
  const page = usePathname()
  const [seen, setSeen] = React.useState(page)
  if (seen !== page) { setSeen(page); setMark(null) }

  if (!mark) return null
  const Arrow = mark.up ? ArrowUpIcon : ArrowDownIcon
  return (
    <button
      type="button"
      data-slot="return-mark"
      onClick={() => {
        mark.scroller.scrollTo({ top: mark.y, behavior: still() ? "instant" : "smooth" })
        setMark(null)
      }}
      className={cn(
        "fixed inset-x-0 bottom-[calc(var(--return-mark-offset,0px)+1rem)] z-(--z-header) mx-auto flex h-10 w-fit items-center gap-2 rounded-full border border-line bg-popover ps-3 pe-4 text-small font-semibold text-ink shadow-overlay transition-[background-color,scale] duration-(--dur-hover) ease-out-quart hover:bg-raised active:scale-[0.97] active:duration-(--dur-press) pointer-coarse:h-11 sm:bottom-[calc(var(--return-mark-offset,0px)+1.5rem)]",
        className
      )}
    >
      <Arrow aria-hidden className="size-4 text-ink-2" />
      Back to where you were
    </button>
  )
}
