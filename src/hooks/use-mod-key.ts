import { useSyncExternalStore } from "react"

/* The key that goes with K (and friends) on this computer: "⌘" on Apple
   platforms, "Ctrl" everywhere else. The server snapshot is "⌘", so the first
   client paint matches the HTML; the real platform swaps in after hydration.
   The platform never changes, so there is nothing to subscribe to. */
const subscribe = () => () => {}

function isApple(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent
  return /mac|iphone|ipad|ipod/i.test(platform)
}

export function useModKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(subscribe, () => (isApple() ? "⌘" : "Ctrl"), () => "⌘")
}
