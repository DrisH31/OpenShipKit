/* Standards (web-design): MOT-3 Durations by element · MOT-4 Easing with character */
/* The motion tokens for JavaScript (Motion, WAAPI). Mirrors src/styles/tokens.css —
   change a value in both places, or the CSS and JS halves of a page disagree. */
export const duration = {
  press: 0.09,
  hover: 0.16,
  tip: 0.14,
  pop: 0.16,
  popExit: 0.11,
  ui: 0.24,
  uiExit: 0.16,
  sheet: 0.3,
  sheetExit: 0.22,
  reveal: 0.72,
} as const

export const stagger = { list: 0.04, hero: 0.07 } as const

export const ease = {
  outQuint: [0.22, 1, 0.36, 1],
  outQuart: [0.25, 1, 0.5, 1],
  inOutQuart: [0.76, 0, 0.24, 1],
  outBack: [0.34, 1.28, 0.64, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const

/** A spring for input-driven motion (drag, toggle settle): quick, no visible bounce. */
export const spring = { type: "spring", stiffness: 520, damping: 42, mass: 1 } as const
