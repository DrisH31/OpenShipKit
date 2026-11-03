"use client"

/* Standards (web-design): MOT-8 Reduced motion ships less */
import { useTheme } from "next-themes"
import { useRef, useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { MoonIcon, SunIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const noop = () => () => {}

/* One button for the scheme. There are only two outcomes, so one press flips to the other:
   no container, no third option. Until someone presses it, the page follows the system.
   - The icon shows where a press takes you: a moon on a light page, a sun on a dark one.
     Both are in the HTML and CSS picks one from the class next-themes sets before paint,
     so the right icon shows from the first frame, with no flash and no mismatch.
   - It’s a toggle (aria-pressed) named “Dark mode”: the name stays the same, the state changes.
   - The new scheme opens as a circle from the button (a View Transition, motion.css); the
     icon turns into place. Under reduced motion, or without View Transitions, it simply changes. */
export function SchemeSwitch({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const button = useRef<HTMLButtonElement>(null)
  const dark = mounted && resolvedTheme === "dark"

  const flip = () => {
    const root = document.documentElement
    const next = root.classList.contains("dark") ? "light" : "dark"
    button.current?.setAttribute("data-touched", "")
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTheme(next)
      return
    }
    // The circle grows from the button’s centre until it covers the farthest corner.
    const r = button.current!.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    root.style.setProperty("--vt-x", `${x}px`)
    root.style.setProperty("--vt-y", `${y}px`)
    root.style.setProperty("--vt-r", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`)
    root.classList.add("scheme-vt")
    const vt = document.startViewTransition(() => {
      flushSync(() => setTheme(next))
      // next-themes applies the class in an effect; the snapshot needs it now.
      root.classList.toggle("dark", next === "dark")
      root.classList.toggle("light", next === "light")
      root.style.colorScheme = next
    })
    vt.finished.finally(() => root.classList.remove("scheme-vt"))
  }

  return (
    <button
      ref={button}
      type="button"
      onClick={flip}
      aria-label="Dark mode"
      aria-pressed={mounted ? dark : undefined}
      title={mounted ? (dark ? "Switch to light" : "Switch to dark") : "Switch colour scheme"}
      data-scheme-toggle=""
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-full text-ink-2 transition-[color,background-color,scale] duration-(--dur-hover) ease-out-quart hover:bg-tonal hover:text-ink active:scale-[0.92] active:duration-(--dur-press) pointer-coarse:size-11",
        className
      )}
    >
      <MoonIcon className="size-[1.125rem] dark:hidden" aria-hidden />
      <SunIcon className="hidden size-[1.125rem] dark:block" aria-hidden />
    </button>
  )
}
