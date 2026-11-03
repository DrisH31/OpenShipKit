"use client"

/* Standards (web-design): LAY-4 Touch targets · LAY-13 A target fills its space · MOT-6 Physicality */
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/** Views of the same thing switched in place: one sliding pill (or an underline, `variant="line"`
    on `TabsList`) marks the chosen tab, and the panel arrives from the side of the tab chosen
    (MOT-13), with nothing on first paint or from the keyboard. */
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list relative inline-flex w-fit items-center justify-center gap-1 rounded-full p-1 text-muted-foreground group-data-horizontal/tabs:h-10 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-tonal",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/* The active tab's pill (or, in the line variant, its underline) is ONE indicator that
   slides between tabs on Base UI's measured --active-tab-* variables. Until it renders
   (before hydration), each active tab paints its own, so the state is never missing. */
function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        className={cn(
          "absolute left-0 translate-x-(--active-tab-left) w-(--active-tab-width) transition-[translate,width] duration-(--dur-ui) ease-out-quart group-data-vertical/tabs:translate-x-0 group-data-vertical/tabs:translate-y-(--active-tab-top) group-data-vertical/tabs:h-(--active-tab-height) group-data-vertical/tabs:transition-[translate,height]",
          variant === "line"
            ? "bottom-[-5px] h-0.5 bg-foreground group-data-vertical/tabs:top-0 group-data-vertical/tabs:right-[-4px] group-data-vertical/tabs:bottom-auto group-data-vertical/tabs:left-auto group-data-vertical/tabs:w-0.5"
            : "top-(--active-tab-top) h-(--active-tab-height) rounded-full bg-thumb shadow-pill group-data-vertical/tabs:top-0"
        )}
      />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex before:absolute before:-inset-[2.5px] before:content-[''] pointer-coarse:before:inset-x-[min(-2px,calc((100%-44px)/2))] pointer-coarse:before:inset-y-[min(-2px,calc((100%-44px)/2))] h-[calc(100%-1px)] flex-1 items-center justify-center gap-2 rounded-full border border-transparent px-4 py-1 text-small font-semibold whitespace-nowrap text-ink-2 transition-[color,background-color,border-color,scale] group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pe-1 has-data-[icon=inline-start]:ps-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-pill group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-thumb data-active:text-foreground",
        "group-has-data-[slot=tabs-indicator]/tabs-list:data-active:border-transparent group-has-data-[slot=tabs-indicator]/tabs-list:data-active:bg-transparent group-has-data-[slot=tabs-indicator]/tabs-list:data-active:shadow-none group-has-data-[slot=tabs-indicator]/tabs-list:after:hidden",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-end-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-small", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
