"use client"

/* Standards (web-design): UI-8 Forms · LAY-4 Touch targets · LAY-8 Focus is visible and never hidden · SND-5 Pitch carries place · UI-28 What the finger covers is shown beside it · UI-33 Every drag has a click */
import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@/lib/utils"

/** A value on a range, dragged or stepped with the arrow keys (Page Up/Down for tens, Home/End for
    the ends): a volume, a price limit. Pass two values for a range with two thumbs. Built on Base
    UI's Slider (one real range input per thumb, so screen readers and forms work); a 44 px hit area
    on touch; the fill is the action colour. With sounds on, it ticks as it passes each step, rising
    with the value and paced so a fast drag never piles up (sound/sound.tsx). Label it with
    aria-label, or a FieldLabel and `aria-labelledby`.
    While a thumb is dragged its value shows ABOVE it (after Rauno Freiberg's essay: a finger hides
    what it touches, so what it covers is shown where it can be seen), in the Root's own `format` and
    `locale`; Base UI captures the pointer, so the drag holds when the finger slides off the track. */
function Slider({ className, defaultValue, value, min = 0, max = 100, onValueChange, format, locale, ...props }: SliderPrimitive.Root.Props) {
  // The values on screen: the prop when controlled, else what the last drag left.
  const [moved, setMoved] = React.useState<number[]>()
  const values = value !== undefined ? [value].flat() : (moved ?? [defaultValue ?? min].flat())
  const say = React.useMemo(() => new Intl.NumberFormat(locale, format), [locale, format])
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      format={format}
      locale={locale}
      onValueChange={(v, details) => { setMoved([v].flat()); onValueChange?.(v, details) }}
      className={cn("w-full", className)}
      {...props}
    >
      <SliderPrimitive.Control data-slot="slider-control" className="relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-50 pointer-coarse:h-11">
        <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-tonal">
          <SliderPrimitive.Indicator data-slot="slider-range" className="h-full bg-action" />
        </SliderPrimitive.Track>
        {values.map((v, i) => (
          <SliderPrimitive.Thumb
            key={i}
            index={i}
            data-slot="slider-thumb"
            className="group/thumb block size-4 shrink-0 rounded-full border border-field bg-raised shadow-control transition-[scale] duration-(--dur-press) ease-out-quart hover:scale-110 data-dragging:scale-110 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--focus) has-[:focus-visible]:outline-solid data-disabled:pointer-events-none pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5 pointer-coarse:after:content-['']"
          >
            <span aria-hidden data-slot="slider-value" className="tabular pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 scale-90 rounded-md bg-ink px-1.5 py-0.5 text-caption font-semibold whitespace-nowrap text-bg opacity-0 transition-[opacity,scale] duration-(--dur-press) ease-out-quart group-data-dragging/thumb:scale-100 group-data-dragging/thumb:opacity-100 pointer-coarse:mb-6">
              {say.format(v)}
            </span>
          </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
