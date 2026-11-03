"use client";

//
// Light, dark, or follow the system — a radio group on next-themes. Until the
// page hydrates, nothing is checked (the server can't know the choice), so the
// first paint never shows a wrong selection.
//

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "Match my system", Icon: MonitorIcon },
] as const;

const noop = () => () => {};

export function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const current = mounted ? (theme ?? "system") : null;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Colour scheme</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map(({ value, label, Icon }) => (
          <label
            key={value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-4 py-2 text-small text-ink hover:bg-tonal has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
              current === value && "border-ink font-semibold",
            )}
          >
            <input type="radio" name="theme" value={value} checked={current === value} onChange={() => setTheme(value)} className="sr-only" />
            <Icon aria-hidden className="size-4 text-ink-2" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
