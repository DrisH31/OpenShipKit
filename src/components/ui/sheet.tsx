"use client"

/* Standards (web-design): MOT-15 A gesture follows the hand · MOT-6 Physicality · UI-27 A scroll stays where it began */
import * as React from "react"
import { Drawer as SheetPrimitive } from "@base-ui/react/drawer"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

type Side = "top" | "right" | "bottom" | "left"
const SWIPE = { top: "up", right: "right", bottom: "down", left: "left" } as const
const SheetSide = React.createContext<Side>("right")

/** A panel that slides in from an edge and keeps the page underneath: details of a row, a mobile
    nav. Set `side` here (default right); the content takes it. It follows the hand (MOT-15, after
    Rauno Freiberg's essay): drag it back towards its edge and it moves with the finger, the scrim
    lightening as it goes; let go far or fast enough and it leaves at the speed it was thrown, or it
    settles home. Base UI's Drawer does the gesture; overlays.css draws it. */
function Sheet({ side = "right", ...props }: SheetPrimitive.Root.Props & { side?: Side }) {
  return (
    <SheetSide.Provider value={side}>
      <SheetPrimitive.Root data-slot="sheet" swipeDirection={SWIPE[side]} {...props} />
    </SheetSide.Provider>
  )
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-(--z-overlay)",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side: sideProp,
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  /** Which edge; defaults to the Sheet's `side`. Set it there, so the swipe goes the same way. */
  side?: Side
  showCloseButton?: boolean
}) {
  const rootSide = React.useContext(SheetSide)
  const side = sideProp ?? rootSide
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Viewport data-slot="sheet-viewport" className="fixed inset-0 z-(--z-overlay)">
        <SheetPrimitive.Popup
          data-slot="sheet-content"
          data-side={side}
          className={cn(
            "fixed z-(--z-overlay) flex flex-col gap-4 overflow-y-auto overscroll-contain bg-popover bg-clip-padding text-small text-popover-foreground shadow-lg outline-none data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:touch-pan-y data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:touch-pan-y data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
            className
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              data-slot="sheet-close"
              render={
                <Button
                  variant="ghost"
                  className="absolute top-3 end-3"
                  size="icon-sm"
                />
              }
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Popup>
      </SheetPrimitive.Viewport>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 p-6 pb-2", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 border-t p-6 pt-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-body font-semibold text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-small text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
