"use client"

/* Standards (web-design): UI-17 Feedback where the action happened */
import { useCallback, useEffect, useRef, useState } from "react"

/** A short-lived “done” state for the control that was just pressed (UI-17): `flash()` turns it
 *  on for `ms`, then off; pressing again restarts the clock. Pair it with Button’s `done` and
 *  `doneLabel`, or swap an icon on it. */
export function useFlash(ms = 1800) {
  const [on, setOn] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const flash = useCallback(() => {
    clearTimeout(timer.current)
    setOn(true)
    timer.current = setTimeout(() => setOn(false), ms)
  }, [ms])
  return [on, flash] as const
}
