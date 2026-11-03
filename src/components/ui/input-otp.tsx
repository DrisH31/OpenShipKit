"use client"

/* Standards (web-design): TYP-12 Codes and IDs read left to right · UI-8 Forms · UI-18 A code arrives whole · UI-19 State lives in attributes · LAY-8 Focus is visible and never hidden · MOT-2 Only transform and opacity · MOT-8 Reduced motion ships less */
import * as React from "react"
import { flushSync } from "react-dom"
import { OTPInput, OTPInputContext } from "input-otp"
import { MinusIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { codeIn, westernDigits } from "@/components/ui/digits"

/* Digits in any of the scripts a phone keyboard types them in: Western, Arabic-Indic, Eastern Arabic-Indic. */
const DIGITS = "^[0-9\\u0660-\\u0669\\u06f0-\\u06f9]+$"

type Paste = { id: number; from: number; to: number }
type Status = { invalid: boolean; success: boolean; verifying: boolean; paste: Paste | null; landed: () => void }
const StatusContext = React.createContext<Status>({ invalid: false, success: false, verifying: false, paste: null, landed: () => {} })

/** A one-time code, one box per digit: the six digits from a sign-in email or a text message.
    A code pasted from a whole message is found in it ("Your code is 482-913" → 482913), and digits
    in Arabic-Indic scripts are taken as Western. One ring shows where typing goes and travels
    from box to box. `aria-invalid` marks a wrong code (danger ring and borders; say why in a
    FieldError beside it), `verifying` pulses the digits while it is checked, `success` lifts them
    once in turn and keeps a positive border. Compose with InputOTPGroup, InputOTPSlot and
    InputOTPSeparator (input-otp underneath: one real input, so autofill, paste and screen readers work). */
function InputOTP({
  className,
  containerClassName,
  value,
  defaultValue,
  onChange,
  maxLength,
  success = false,
  verifying = false,
  "aria-invalid": ariaInvalid,
  onPasteCapture,
  children,
  ...props
}: Omit<React.ComponentProps<typeof OTPInput>, "render" | "children"> & {
  children?: React.ReactNode
  containerClassName?: string
  /** The code was accepted: the boxes lift once, in turn, and keep a positive border. */
  success?: boolean
  /** The code is being checked: the digits pulse until `success` or `aria-invalid` arrives. */
  verifying?: boolean
}) {
  const invalid = ariaInvalid === true || ariaInvalid === "true"
  const [held, setHeld] = React.useState(typeof defaultValue === "string" ? defaultValue : "")
  const [paste, setPaste] = React.useState<Paste | null>(null)
  const current = value ?? held

  // Several digits at once light the boxes they filled, in turn: a paste says which (it knows where it
  // landed); autofill or an IME is taken as everything after the first box that changed.
  const change = (typed: string, landed?: { from: number; to: number }) => {
    const next = westernDigits(typed)
    let sweep = landed
    if (!sweep && next.length - current.length > 1) {
      let from = 0
      while (from < current.length && current[from] === next[from]) from++
      sweep = { from, to: next.length }
    }
    if (sweep && sweep.to - sweep.from > 1) {
      const { from, to } = sweep
      setPaste((p) => ({ id: (p?.id ?? 0) + 1, from, to }))
    }
    if (value === undefined) setHeld(next)
    onChange?.(next)
  }

  /* A paste lands where the caret is (after the original): a whole code replaces everything; part of
     one is set in at the selection and the rest kept. The code is found in whatever was pasted. */
  const pasteAtCaret = (event: React.ClipboardEvent<HTMLInputElement>) => {
    onPasteCapture?.(event)
    if (event.defaultPrevented) return
    const input = event.currentTarget
    event.preventDefault()
    if (input.readOnly || input.disabled) return
    const digits = codeIn(event.clipboardData.getData("text/plain"), maxLength)
    if (!digits) return
    const start = input.selectionStart ?? current.length
    const end = input.selectionEnd ?? current.length
    const whole = digits.length >= maxLength
    const from = whole ? 0 : start
    const next = (current.slice(0, from) + digits + current.slice(whole ? current.length : end)).slice(0, maxLength)
    if (next === current) return
    flushSync(() => change(next, { from, to: Math.min(from + digits.length, maxLength) }))
    input.setSelectionRange(Math.min(input.value.length, maxLength - 1), input.value.length)
  }

  return (
    <StatusContext.Provider value={{ invalid, success, verifying, paste, landed: () => setPaste(null) }}>
      <OTPInput
        data-slot="input-otp"
        value={current}
        onChange={change}
        maxLength={maxLength}
        onPasteCapture={pasteAtCaret}
        aria-invalid={ariaInvalid}
        aria-busy={verifying || undefined}
        data-success={success || undefined}
        autoComplete="one-time-code"
        spellCheck={false}
        containerClassName={cn("relative flex items-center gap-2 [direction:ltr] has-disabled:opacity-50 sm:gap-3", containerClassName)}
        className={cn("disabled:cursor-not-allowed", className)}
        {...props}
        // A code reads left to right in every language; the keyboard is the number pad.
        dir="ltr"
        inputMode="numeric"
        pattern={DIGITS}
      >
        {children}
        <Ring />
      </OTPInput>
    </StatusContext.Provider>
  )
}

/* The one focus ring (LAY-8), drawn once and moved, never redrawn per box: it glides to where
   typing goes next and spans every box a selection covers, its size on the same curve (MOT-2's
   written exception: one small absolutely-positioned indicator, as usePill). While a paste lands
   it steps aside, so the eye follows the digits arriving; it comes back where typing goes next.
   Placed straight on the element from a layout effect (as usePill), so a keystroke never
   re-renders the row to move it. */
function Ring() {
  const ctx = React.useContext(OTPInputContext)
  const { invalid, paste } = React.useContext(StatusContext)
  const landing = paste !== null
  const ref = React.useRef<HTMLSpanElement>(null)
  const first = ctx.slots.findIndex((s) => s.isActive)
  const last = ctx.slots.findLastIndex((s) => s.isActive)

  React.useLayoutEffect(() => {
    const ring = ref.current, row = ring?.parentElement
    if (!ring || !row) return
    const place = () => {
      const head = row.querySelector(`[data-slot="input-otp-slot"][data-index="${first}"]`)
      const tail = row.querySelector(`[data-slot="input-otp-slot"][data-index="${last}"]`)
      if (first < 0 || landing || !head || !tail) { ring.style.opacity = "0"; return }
      const r = row.getBoundingClientRect(), h = head.getBoundingClientRect(), t = tail.getBoundingClientRect()
      const appearing = ring.style.opacity !== "1"
      if (appearing) ring.style.transition = "none" // focus shows where it lands, not on its way there
      ring.style.translate = `${h.left - r.left}px ${h.top - r.top}px`
      ring.style.width = `${t.right - h.left}px`
      ring.style.height = `${h.height}px`
      ring.style.opacity = "1"
      if (appearing) { void ring.offsetWidth; ring.style.transition = "" }
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(row)
    return () => observer.disconnect()
  }, [first, last, landing])

  return (
    <span
      ref={ref}
      aria-hidden
      data-slot="input-otp-ring"
      style={{ opacity: 0 }}
      className={cn(
        "pointer-events-none absolute top-0 left-0 z-10 rounded-md ring-2 transition-[translate,width,height,opacity] duration-(--dur-spring) ease-(--ease-spring)",
        invalid ? "ring-danger" : "ring-focus"
      )}
    />
  )
}

/** A run of boxes; put an InputOTPSeparator between two runs (3 + 3 reads as two chunks to remember). */
function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="input-otp-group" className={cn("flex items-center gap-2 sm:gap-3", className)} {...props} />
}

/** One box: its digit (which arrives with a small turn up into place, and leaves with a shorter
    one), or a faint 0 while empty. */
function InputOTPSlot({ index, className, style, ...props }: React.ComponentProps<"div"> & { index: number }) {
  const ctx = React.useContext(OTPInputContext)
  const { invalid, success, verifying, paste, landed } = React.useContext(StatusContext)
  const { char, isActive } = ctx.slots[index] ?? {}
  // The digit that just left, kept for its exit (state from the last render, React's own pattern).
  const [shown, setShown] = React.useState(char)
  const [leaving, setLeaving] = React.useState<{ char: string; id: number } | null>(null)
  if (char !== shown) {
    setLeaving(shown && !char ? { char: shown, id: (leaving?.id ?? 0) + 1 } : null)
    setShown(char)
  }
  const pasted = paste !== null && index >= paste.from && index < paste.to
  return (
    <div
      data-slot="input-otp-slot"
      data-index={index}
      data-active={isActive}
      className={cn(
        "relative flex h-12 w-10 items-center justify-center rounded-md border border-field bg-card font-sans text-h3 font-semibold tabular shadow-control [container-type:inline-size] transition-[border-color,background-color] duration-(--dur-hover) sm:w-12 dark:bg-bg",
        "data-[active=true]:bg-tonal",
        invalid && "border-danger",
        success && "otp-lift border-positive",
        className
      )}
      // --otp-i: this box's place in the row (success, verifying); --otp-p: its place in a paste.
      style={{ ...style, "--otp-i": index, "--otp-p": pasted ? index - paste.from : 0 } as React.CSSProperties}
      {...props}
    >
      {/* A paste lights the boxes it filled, in order; a success lights them all, in the positive role. */}
      {/* The paste ends when its last box has lit, so a digit typed later arrives without a delay. */}
      {pasted && <span key={paste.id} aria-hidden onAnimationEnd={index === paste.to - 1 ? landed : undefined} className="otp-trail pointer-events-none absolute inset-0 rounded-md ring-2 ring-ink-3" />}
      {success && <span aria-hidden className="otp-trail-success pointer-events-none absolute inset-0 rounded-md ring-2 ring-positive" />}
      {/* The digit sizes to its box (container units), so a row squeezed narrower never overflows. */}
      <span className={cn("grid place-items-center text-[min(var(--text-h3),55cqi)] [perspective:15rem]", verifying && char && "otp-wave")}>
        <span aria-hidden className={cn("col-start-1 row-start-1 text-ink-faint transition-opacity duration-(--dur-hover)", char ? "opacity-0" : "opacity-100")}>0</span>
        {char && <span key={char} className={cn("otp-digit col-start-1 row-start-1 text-ink", pasted && "otp-digit-pasted")}>{char}</span>}
        {leaving && <span key={leaving.id} aria-hidden onAnimationEnd={() => setLeaving(null)} className="otp-digit-out col-start-1 row-start-1 text-ink">{leaving.char}</span>}
      </span>
    </div>
  )
}

/** The dash between two InputOTPGroups. */
function InputOTPSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="input-otp-separator" role="separator" className={cn("flex shrink-0 items-center text-ink-faint [&_svg]:size-5", className)} {...props}>
      <MinusIcon aria-hidden />
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
