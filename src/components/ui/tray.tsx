"use client"

/* Standards (web-design): UI-25 A tray holds one step · MOT-13 Things travel instead of teleporting · MOT-15 A gesture follows the hand · MOT-2 Animate transform and opacity only · LAY-4 Touch targets */
import * as React from "react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"
import { ArrowLeftIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/* A TRAY: a short, stepped task over the page, which stays where it was underneath (after the
   Family wallet's tray system).
   - ONE THING PER STEP: one piece of content or one action. A longer flow is several steps, each
     its own tray-sized question.
   - Each step has a title and ONE icon at its start: close on the first step, back on the rest.
   - The tray changes height between steps (a measured height on the token curve, MOT-2's written
     disclosure exception), and its content arrives from the direction you're going: forward from
     the end edge, back from the start. Write steps of different heights on purpose: the change of
     size is what tells the eye it moved on.
   - `tone="inverse"` takes the page's opposite scheme, for a flow that is dark where the page is light
     (Family's dark trays in a dark flow).
   - Opens and closes as the other overlays do (overlays.css): up from the bottom edge, shorter out.
   - IT FOLLOWS THE HAND (MOT-15, after Rauno Freiberg's essay):
     drag it down and it moves with the finger from the first pixel, resists past the top, lightens
     the scrim as it goes, and closes on release only if the drag was far or fast enough, keeping the
     throw's speed; flick it back and it stays. Base UI's Drawer does the gesture (velocity, damping,
     scroll edges, pointer capture); overlays.css draws it. A mouse drags from the header only: the
     step's body is Drawer.Content, so text in it selects as usual. */

export type TrayStep = { id: string; title: string; content: React.ReactNode }

/** A stepped task in a tray rising from the bottom: `steps` in order, `step` the one shown. The
    header's icon closes the tray on the first step and goes back a step after; Esc and the scrim
    close it. Change `step` from inside a step (its Continue button) to move on; the tray grows or
    shrinks to the new step and the content slides in from the side it came from. */
export function Tray({ open, onOpenChange, steps, step, onStep, trigger, tone = "default", className }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  steps: TrayStep[]
  step: string
  onStep: (id: string) => void
  /** The element that opens it (rendered as the dialog's trigger). */
  trigger?: React.ReactElement<Record<string, unknown>>
  tone?: "default" | "inverse"
  className?: string
}) {
  const index = Math.max(0, steps.findIndex((s) => s.id === step))
  const current = steps[index]!
  // Which way it went: kept from the last render (React’s own pattern for a value that follows a prop).
  // A fresh open has gone nowhere yet, so its first step rises with the tray rather than sliding in.
  const [went, setWent] = React.useState({ index, open, forward: true, moved: false })
  if (went.open !== open) setWent({ index, open, forward: true, moved: false })
  else if (went.index !== index) setWent({ index, open, forward: index > went.index, moved: true })

  // A callback ref, not an effect: the popup mounts after `open` turns true, so an effect keyed on
  // `open` would find nothing to observe and the height would never ease.
  const [height, setHeight] = React.useState<number>()
  const body = React.useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => { observer.disconnect(); setHeight(undefined) }
  }, [])

  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} swipeDirection="down">
      {trigger && <DrawerPrimitive.Trigger render={trigger} />}
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Backdrop data-slot="tray-overlay" className="fixed inset-0 z-(--z-overlay)" />
        <DrawerPrimitive.Viewport data-slot="tray-viewport" className="fixed inset-0 z-(--z-overlay) flex items-end justify-center p-3 sm:p-6">
          <DrawerPrimitive.Popup
            data-slot="tray-content"
            className={cn(
              "relative w-full max-w-[26rem] touch-pan-x overflow-hidden rounded-2xl border border-line bg-popover text-ink shadow-overlay outline-none",
              tone === "inverse" && "invert-scheme",
              className
            )}
          >
            {/* The grabber: says "this can be pulled" where fingers are; a pointer has the close icon. */}
            <span aria-hidden data-slot="tray-grabber" className="absolute inset-x-0 top-1.5 mx-auto hidden h-1 w-9 rounded-full bg-ink-faint pointer-coarse:block" />
            <div className="flex items-center gap-2 px-3 pt-3">
              {index === 0 ? (
                <DrawerPrimitive.Close data-slot="tray-close" aria-label="Close" className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors duration-(--dur-hover) hover:bg-tonal hover:text-ink pointer-coarse:size-11">
                  <XIcon aria-hidden className="size-[1.125rem]" />
                </DrawerPrimitive.Close>
              ) : (
                <button type="button" data-slot="tray-back" aria-label="Back" onClick={() => onStep(steps[index - 1]!.id)} className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors duration-(--dur-hover) hover:bg-tonal hover:text-ink pointer-coarse:size-11">
                  <ArrowLeftIcon aria-hidden className="size-[1.125rem]" />
                </button>
              )}
              <DrawerPrimitive.Title className="font-sans text-lead font-semibold text-ink">{current.title}</DrawerPrimitive.Title>
            </div>
            {/* The tray's height follows its step: measured, then eased (the step's size is the signal). */}
            <div style={{ height }} className="overflow-hidden transition-[height] duration-(--dur-ui) ease-out-quint">
              <DrawerPrimitive.Content>
                <div ref={body}>
                  <div key={current.id} data-slot="tray-step" data-dir={went.moved ? (went.forward ? "forward" : "back") : undefined} className="px-6 pt-2 pb-6">
                    {current.content}
                  </div>
                </div>
              </DrawerPrimitive.Content>
            </div>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  )
}
