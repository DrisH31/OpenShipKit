/* Standards (web-design): TYP-1 A scale, not ad-hoc sizes */
import { createCn } from "cn/engine"
import tables from "./cn-tables"

/* cn() taught the house type scale (src/lib/cn-config.ts), from tables compiled
   at build time (src/lib/cn-tables.ts): the browser gets ~5 KB of tables instead
   of Tailwind's whole class-group config compiled on the first call. Without the
   extension the merger can't tell a custom SIZE class (text-display, text-h1 …)
   from a COLOUR class (text-ink …) and silently drops one. Every component
   imports cn from HERE, never from "cn" directly. */
export const cn = createCn(tables)
