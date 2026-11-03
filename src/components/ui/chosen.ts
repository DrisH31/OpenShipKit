/* Standards (web-design): MOT-5 The frequency gate */

/** Marks the item a menu, select or combobox was just closed by, so it blinks once before its menu
    fades (overlays.css; the macOS menu, via Rauno Freiberg's essay):
    the blink says "this one", the fade is the only motion. Call it from the item's click (Base UI
    fires click for Enter too). Two frames later, if the menu isn't closing (an item that keeps it
    open), the mark comes off, so it never blinks at some later close. No timings here: the blink's
    length is --dur-blink, in CSS only. */
export function markChosen(item: HTMLElement) {
  item.setAttribute("data-chosen", "")
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!item.closest("[data-ending-style]")) item.removeAttribute("data-chosen")
  }))
}
