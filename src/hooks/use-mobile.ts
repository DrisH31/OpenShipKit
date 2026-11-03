import { useSyncExternalStore } from "react"

const QUERY = "(max-width: 767px)"

/* Subscribes to the media query instead of setting state in an effect — no extra
   render, and the server snapshot (false) matches the first client paint. */
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
