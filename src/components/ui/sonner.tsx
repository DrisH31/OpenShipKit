"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/** Where toasts appear (sonner), following the scheme, each with a close button and an icon from
    the one set. Put it once in the root layout and call `toast()` from `lib/toast`; a toast
    confirms what happened and offers Undo (UI-9), while a message that must stay is an `Alert`. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon data-slot="spinner" className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--line-strong)",   /* a toast floats over the bare page, where the quiet line vanishes (COL-10) */
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      closeButton
      toastOptions={{
        duration: 6000,
        classNames: {
          toast: "cn-toast",
          actionButton: "!min-h-8 !rounded-full !px-3 !font-semibold",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
