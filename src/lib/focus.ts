//
// Focus that survives a refresh. A form's result often re-renders the page
// without the control that had focus: a signed-out session's row, a triaged
// item that leaves the filtered list, a two-factor panel that swaps, a revoked
// key's row. The browser then drops focus to <body>, and a keyboard or
// screen-reader user is thrown back to the top of the page (WCAG 2.4.3).
//
// keepFocus() watches for that drop for a few seconds after a result and
// moves focus somewhere that makes sense, first match wins:
//
//   1. `next`    the same control in the next item of the list (else the
//                previous one), when the control's own item is gone;
//   2. `targets` selectors, resolved when focus drops ("#two-factor-status");
//   3. the first heading of the nearest section still on the page, else the
//      shell's main region (#content).
//
// Only a drop to <body> moves focus: if it is still on something (the form
// stayed) or the person moved it, nothing happens. A click anywhere cancels
// the watch. One watch at a time; a newer one replaces the older.
//
// Plain data (selectors), so a server page can pass a plan to a client form.
//

export interface FocusNext {
  /** The list item the control sits in: "li", "tr". */
  item: string;
  /** What to focus inside a neighbouring item; "" focuses the item itself. */
  target: string;
}

export interface FocusPlan {
  next?: FocusNext;
  targets?: readonly string[];
}

const WATCH_MS = 10_000;
const TICK_MS = 50;
let stopWatching: (() => void) | null = null;

/** Can `el` take focus right now (on the page, shown, not disabled)? */
function usable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  if (el.closest("[hidden], [inert]")) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  return el.getClientRects().length > 0;
}

/** Focus `el`; something that isn't focusable by nature (a heading, a list item) gets tabindex="-1" first. */
export function focusElement(el: HTMLElement, options?: FocusOptions): void {
  if (el.tabIndex < 0 && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus(options);
}

/** The first heading of the nearest section still on the page. */
function nearestHeading(ancestors: readonly Element[]): HTMLElement | null {
  for (const a of ancestors) {
    if (!a.isConnected) continue;
    const heading = a.querySelector("h1, h2, h3");
    if (heading && usable(heading)) return heading;
  }
  const main = document.getElementById("content") ?? document.querySelector("main");
  return main instanceof HTMLElement ? main : null;
}

/**
 * Watch for focus falling to <body> after `origin` (the form or button that
 * had it) is re-rendered away, and move it by `plan`. Call it when the result
 * arrives, BEFORE the refresh lands: it snapshots the list around `origin`.
 */
export function keepFocus(origin: Element | null, plan: FocusPlan = {}): void {
  if (typeof document === "undefined" || !origin) return;
  stopWatching?.();

  const item = plan.next ? origin.closest(plan.next.item) : null;
  const neighbours: Element[] = [];
  if (item) {
    for (let s = item.nextElementSibling; s; s = s.nextElementSibling) neighbours.push(s);
    for (let s = item.previousElementSibling; s; s = s.previousElementSibling) neighbours.push(s);
  }
  const ancestors: Element[] = [];
  for (let a = origin.parentElement; a && a !== document.body; a = a.parentElement) ancestors.push(a);

  const resolve = (): HTMLElement | null => {
    if (plan.next && item && !item.isConnected) {
      for (const n of neighbours) {
        if (!n.isConnected) continue;
        const el = plan.next.target ? n.querySelector(plan.next.target) : n;
        if (el && usable(el)) return el;
      }
    }
    for (const selector of plan.targets ?? []) {
      const el = document.querySelector(selector);
      if (el && usable(el)) return el;
    }
    return nearestHeading(ancestors);
  };

  const started = Date.now();
  const stop = () => {
    window.clearInterval(timer);
    document.removeEventListener("pointerdown", stop, true);
    if (stopWatching === stop) stopWatching = null;
  };
  const timer = window.setInterval(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      const el = resolve();
      stop();
      if (el) focusElement(el);
      return;
    }
    if (Date.now() - started > WATCH_MS) stop();
  }, TICK_MS);
  document.addEventListener("pointerdown", stop, true);
  stopWatching = stop;
}

/** Focus the first control marked invalid inside `root`, scrolled to the middle of the view (clear of a sticky save bar). */
export function focusFirstInvalid(root: Element | null): boolean {
  const el = root?.querySelector('[aria-invalid="true"]');
  if (!el || !usable(el)) return false;
  focusElement(el, { preventScroll: true });
  el.scrollIntoView({ block: "center" });
  return true;
}
