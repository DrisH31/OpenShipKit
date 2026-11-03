"use client"

/* Standards (web-design): UI-8 Forms · MOT-5 The frequency gate · UI-27 A scroll stays where it began */
import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"
import { markChosen } from "@/components/ui/chosen"
import { cn } from "@/lib/utils"

/** A choice from a long list you can type into: a country, a customer, a currency. Use it past about fifteen options, where a Select becomes a list to scroll; under that, Select (or radios up to five).
 *  Base UI's Combobox, set to the same spec as the house Select: a 40 px field (44 on touch) with the
 *  field finish, a 16 px panel, 40 px rows, the chosen row semibold with a check on the right.
 *  - Typing filters by the start of any word in each label, accents ignored, so the first row (the one
 *    Enter picks) is the one meant; the arrow keys move, Enter chooses, Escape closes.
 *  - Pass `items` to the root; with groups, an array of `{ value, items }` rendered with
 *    ComboboxGroup, ComboboxGroupLabel and ComboboxCollection. A value never appears in two groups.
 *  - One focus indicator, on the field: the house ring around its own edge (as InputGroup, v2.0.3).
 *  - `ComboboxEmpty` says nothing matched and how to widen the search. */
function Combobox<Value, Multiple extends boolean | undefined = false, Item = Value>(props: ComboboxPrimitive.Root.Props<Value, Multiple, Item>) {
  return <ComboboxPrimitive.Root<Value, Multiple, Item> filter={matchWordStart} {...props} />
}

/** The house filter: a name matches when one of its words starts with what was typed, ignoring case and
    accents — "ger" finds Germany (not Algeria or Niger), "states" finds United States, "cote" finds
    Côte d’Ivoire. Base UI's default matches anywhere in the name, which puts the wrong row first, the one
    Enter would choose. Pass `filter` to replace it. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
function matchWordStart(item: unknown, query: string, itemToString?: (item: never) => string) {
  const q = fold(query.trim())
  if (!q) return true
  const label = fold(itemToString ? itemToString(item as never) : String(item))
  return label.startsWith(q) || label.split(/[\s\-–(’'&.,]+/).some((word) => word.startsWith(q))
}

/** The field: the input, a clear button once something is chosen (`clearable`), and the chevron. */
function ComboboxInput({
  className,
  clearable = false,
  ...props
}: ComboboxPrimitive.Input.Props & { clearable?: boolean }) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-field"
      className={cn(
        "group/combobox relative flex h-10 w-full min-w-0 items-center gap-1 rounded-md border border-input bg-card shadow-control transition-colors duration-(--dur-hover) hover:border-ink-3 pointer-coarse:h-11 dark:bg-bg",
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-(--focus) has-data-popup-open:border-ink",
        "has-disabled:opacity-50 has-[[aria-invalid=true]]:border-danger has-[[aria-invalid=true]]:shadow-[0_0_0_1px_var(--color-danger)]",
        className
      )}
    >
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className="h-full min-w-0 flex-1 bg-transparent ps-3 text-body text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed pointer-fine:text-small"
        {...props}
      />
      {/* 4 px between the input and each button, and between the buttons: nothing clickable touches (LAY-3) */}
      <span className="flex shrink-0 items-center gap-1 pe-1">
        {clearable && (
          <ComboboxPrimitive.Clear
            aria-label="Clear the choice"
            className="relative inline-flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors duration-(--dur-hover) hover:bg-tonal hover:text-ink pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5"
          >
            <XIcon className="size-4" />
          </ComboboxPrimitive.Clear>
        )}
        <ComboboxPrimitive.Trigger
          aria-label="Show the options"
          className="relative inline-flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors duration-(--dur-hover) hover:bg-tonal hover:text-ink pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5"
        >
          <ChevronDownIcon className="size-4 transition-[rotate] duration-(--dur-pop) ease-out-quart group-has-data-popup-open/combobox:rotate-180" />
        </ComboboxPrimitive.Trigger>
      </span>
    </ComboboxPrimitive.InputGroup>
  )
}

/** The panel under the field. Its motion lives in overlays.css (it grows from the field, like a Select). */
function ComboboxContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  ...props
}: ComboboxPrimitive.Popup.Props & Pick<ComboboxPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-(--z-overlay) outline-none">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "w-(--anchor-width) max-w-(--available-width) min-w-48 origin-(--transform-origin) overflow-hidden rounded-2xl border border-line-strong bg-popover text-popover-foreground shadow-md",
            className
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn("max-h-[min(22rem,var(--available-height))] scroll-py-1.5 overflow-y-auto overscroll-contain p-1.5 outline-none data-empty:p-0", className)}
      {...props}
    />
  )
}

/** A row: the label, and a check on the right when it is the choice. */
function ComboboxItem({ className, children, onClick, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      onClick={(e) => { markChosen(e.currentTarget); onClick?.(e) }}
      className={cn(
        "relative flex min-h-10 w-full cursor-default items-center gap-2 rounded-lg py-2 pe-9 ps-3 text-small text-ink-2 outline-none select-none pointer-coarse:min-h-11 data-highlighted:bg-tonal-hover data-highlighted:text-ink data-selected:font-semibold data-selected:text-ink data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="pointer-events-none absolute end-3 flex size-4 items-center justify-center text-ink">
        <CheckIcon className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

/** What shows when nothing matches: say so, and how to widen the search. */
function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return <ComboboxPrimitive.Empty data-slot="combobox-empty" className={cn("px-4 py-6 text-center text-small text-ink-3 empty:hidden", className)} {...props} />
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" className={cn("block not-first:mt-1.5 not-first:border-t not-first:border-line not-first:pt-1.5", className)} {...props} />
}

function ComboboxGroupLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return <ComboboxPrimitive.GroupLabel data-slot="combobox-group-label" className={cn("px-3 pt-2 pb-1 text-caption font-semibold text-ink-3 select-none", className)} {...props} />
}

const ComboboxCollection = ComboboxPrimitive.Collection

export { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel, ComboboxCollection }
