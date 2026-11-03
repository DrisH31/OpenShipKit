/* Standards (web-design): TYP-1 A scale, not ad-hoc sizes */

/* The house extension to Tailwind's class groups: the type scale. Without it, the
   merger can't tell a custom SIZE class (text-display, text-h1 …) from a COLOUR
   class (text-ink …) — both look like `text-*` — and silently drops one: the hero
   headline rendered at 16 px until this existed.

   It is compiled AT BUILD TIME into src/lib/cn-tables.ts, so the browser never
   parses Tailwind's whole class-group config. After editing this file, rebuild
   the tables (src/lib/utils.test.ts fails until you do):

     npx cn build --full --no-css --tokens /dev/null --config src/lib/cn-config.ts -o src/lib/cn-tables.ts

   `--full` keeps every class group (no subsetting by scanning the sources), so
   class names built at runtime merge exactly as they did with the runtime config. */
const config = {
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "figure", "lead", "body", "small", "caption", "eyebrow"] }],
    },
  },
}

export default config
