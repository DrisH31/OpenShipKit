"use client";

//
// The recursive half of the schema editor: one FieldNode (src/lib/schema-form)
// → its control, labelled, with the server's issues for its path underneath.
//
//   string → input / textarea (with a counter near the limit; none for a
//            fixed-length code like a currency, where "3/3" isn't a warning)
//   number → number input            boolean → checkbox
//   money  → a number the page names in `money` (a price's amountCents):
//            typed in the main unit ("19.50") with the currency's symbol,
//            stored in minor units (1950) — so "19" can't become $0.19
//   enum   → native select           object  → its fields (a fieldset when nested)
//   array  → rows with move up / down / remove, and "Add". A list of small
//            records (a link: label + href) is one grid row per item, its
//            field hints said once above the list (compactFields).
//            Rows keep a stable React key, so after a move or a remove focus
//            follows the row (or lands on the nearest control that still
//            works) and a polite status says where it went.
//   nullable string/number → the same input, empty = null
//   nullable object → "Include …" checkbox, then its fields
//   json   → a raw JSON box for that subtree (never silently dropped)
//
// Ids are derived from the value path, so the issue summary can link to and
// focus the exact control ("items.2.title" → #ed-items-2-title).
//

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { INVALID_WRAPPER, NativeSelect } from "@/components/product/form-fields";
import { amountText, currencySymbol, minorDigits, parseAmount } from "@/lib/amount";
import { compactFields, defaultFor, enabledValueFor, humanize, itemSummary, moveItem, pathKey, pathPattern, type FieldNode, type Path } from "@/lib/schema-form";
import { cn } from "@/lib/utils";

export interface EditorContext {
  idPrefix: string;
  /** Issue messages by exact path key. */
  issues: Map<string, string[]>;
  /** Path keys edited since the last result: their old issues are hidden. */
  edited: Set<string>;
  readOnly: Set<string>;
  hints: Record<string, string>;
  /** Example values shown in empty text fields, by path or pattern ("social.x": "https://x.com/yourname"). */
  placeholders: Record<string, string>;
  labels: Record<string, string>;
  optionLabels: Record<string, Record<string, string>>;
  /** Money fields by path or pattern → the sibling field holding the currency: { "prices.*.amountCents": "currency" }. */
  money: Record<string, string>;
}

export const EditorCtx = createContext<EditorContext>({
  idPrefix: "ed",
  issues: new Map(),
  edited: new Set(),
  readOnly: new Set(),
  hints: {},
  placeholders: {},
  labels: {},
  optionLabels: {},
  money: {},
});

/** The DOM id for the control at `path`. */
export function controlId(prefix: string, path: Path | string): string {
  const key = typeof path === "string" ? path : pathKey(path);
  return `${prefix}-${key.replace(/[^a-zA-Z0-9_-]+/g, "-") || "root"}`;
}

/** The hint for `path`: exact path, then the row pattern, then any field with this name ("*.href"). */
function hintAt(ctx: EditorContext, path: Path): string | undefined {
  const last = path[path.length - 1];
  return ctx.hints[pathKey(path)] ?? ctx.hints[pathPattern(path)] ?? (typeof last === "string" ? ctx.hints[`*.${last}`] : undefined);
}

/** The server's messages for `path`, unless it was edited since. */
function messagesAt(ctx: EditorContext, path: Path): string[] {
  const key = pathKey(path);
  return ctx.edited.has(key) ? [] : (ctx.issues.get(key) ?? []);
}

function useField(path: Path) {
  const ctx = useContext(EditorCtx);
  const key = pathKey(path);
  const pattern = pathPattern(path);
  return {
    id: controlId(ctx.idPrefix, path),
    key,
    messages: messagesAt(ctx, path),
    readOnly: ctx.readOnly.has(key),
    hint: hintAt(ctx, path),
    placeholder: ctx.placeholders[key] ?? ctx.placeholders[pattern],
    labelFor: (fallback: string) => ctx.labels[pattern] ?? ctx.labels[key] ?? fallback,
    optionLabels: ctx.optionLabels[pattern] ?? ctx.optionLabels[key] ?? {},
    currencyKey: ctx.money[pattern] ?? ctx.money[key],
  };
}

function Issues({ id, messages }: { id: string; messages: string[] }) {
  if (!messages.length) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-small text-danger">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{messages.join(" ")}</span>
    </p>
  );
}

function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const out = ids.filter(Boolean).join(" ");
  return out || undefined;
}

interface Props {
  node: FieldNode;
  path: Path;
  value: unknown;
  onChange: (path: Path, next: unknown) => void;
  label: string;
  /** Hide the label visually (array rows of plain strings: the row says it). */
  bareLabel?: boolean;
  /**
   * A field inside a compact list row. `suffix` is read after the label by
   * screen readers (", link 2"); `hideLabel` hides the label from sm up (the
   * first row's labels head the columns); `hintId` is the hint said once above
   * the list, used instead of a hint under every row.
   */
  inline?: { suffix: string; hideLabel: boolean; hintId?: string };
  /** The record this field sits in, for a field that reads a neighbour (a price's amount reads its currency). */
  siblings?: Record<string, unknown>;
}

/**
 * The character count near the limit: plain text, tied to the field through
 * aria-describedby (read when the field is focused), never a live region —
 * that would speak on every keystroke. Crossing the limit is announced once,
 * by <LimitStatus>.
 */
function Counter({ id, length, max }: { id: string; length: number; max?: number }) {
  if (!max || length < max * 0.8) return null;
  return (
    <span id={id} className={cn("tabular text-caption", length > max ? "text-danger" : "text-ink-3")}>
      <span aria-hidden>
        {length}/{max}
      </span>
      <span className="sr-only">
        {length} of {max} characters
      </span>
    </span>
  );
}

/** One live region, mounted empty, that speaks only when the text reaches or passes its limit. */
function LimitStatus({ length, max }: { length: number; max?: number }) {
  const words = !max || length < max ? "" : length === max ? `At the ${max}-character limit.` : `Over the ${max}-character limit.`;
  return (
    <span role="status" className="sr-only">
      {words}
    </span>
  );
}

function StringInput({ node, path, value, onChange, label, bareLabel, inline, nullable = false }: Props & { node: Extract<FieldNode, { kind: "string" }>; nullable?: boolean }) {
  const f = useField(path);
  const text = typeof value === "string" ? value : "";
  const hint = inline ? undefined : (f.hint ?? node.description);
  const set = (v: string) => onChange(path, nullable && v === "" ? null : v);
  const fixedLength = node.maxLength !== undefined && node.minLength === node.maxLength;
  const limit = fixedLength ? undefined : node.maxLength;
  const nearLimit = Boolean(limit) && text.length >= (limit ?? 0) * 0.8;
  const common = {
    id: f.id,
    value: text,
    readOnly: f.readOnly,
    placeholder: f.placeholder,
    // A short fixed-length code (a currency: "usd") gets a field its size, not the full width.
    className: cn(f.readOnly && "bg-tonal text-ink-2 dark:bg-tonal", fixedLength && (node.maxLength ?? 0) <= 8 && "max-w-28"),
    "aria-invalid": f.messages.length ? true : undefined,
    "aria-describedby": describedBy(hint && `${f.id}-hint`, inline?.hintId, nearLimit && `${f.id}-count`, f.messages.length > 0 && `${f.id}-err`),
  };
  return (
    <div className="flex flex-col gap-2">
      {/* On a compact list's later rows the label is hidden from sm up; `contents` drops its row too, so no empty line and gap sit above the input (the row's buttons line up with it). */}
      <div className={cn("flex items-baseline justify-between gap-3", inline?.hideLabel && "sm:contents")}>
        <label htmlFor={f.id} className={cn("text-small font-semibold text-ink", bareLabel && "sr-only", inline?.hideLabel && "sm:sr-only")}>
          {f.labelFor(label)}
          {inline ? <span className="sr-only">{inline.suffix}</span> : null}
          {nullable ? <span className="ml-1 font-normal text-ink-3">(optional)</span> : null}
        </label>
        <Counter id={`${f.id}-count`} length={text.length} max={limit} />
      </div>
      <LimitStatus length={text.length} max={limit} />
      {node.multiline ? (
        <Textarea {...common} rows={Math.min(8, Math.max(3, Math.ceil(text.length / 80)))} onChange={(e) => set(e.target.value)} />
      ) : (
        <Input {...common} type={node.format === "email" ? "email" : node.format === "uri" ? "url" : "text"} onChange={(e) => set(e.target.value)} />
      )}
      {hint ? (
        <p id={`${f.id}-hint`} className="text-caption text-ink-3">
          {f.readOnly ? `${hint} Can’t be changed here.` : hint}
        </p>
      ) : f.readOnly ? (
        <p className="text-caption text-ink-3">Can’t be changed here.</p>
      ) : null}
      <Issues id={`${f.id}-err`} messages={f.messages} />
    </div>
  );
}

function NumberInput({ node, path, value, onChange, label, siblings, nullable = false }: Props & { node: Extract<FieldNode, { kind: "number" }>; nullable?: boolean }) {
  const f = useField(path);
  const hint = f.hint ?? node.description;
  if (f.currencyKey) return <MoneyInput path={path} value={value} onChange={onChange} label={label} currency={siblings?.[f.currencyKey]} hint={hint} nullable={nullable} />;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={f.id} className="text-small font-semibold text-ink">
        {f.labelFor(label)}
        {nullable ? <span className="ml-1 font-normal text-ink-3">(optional)</span> : null}
      </label>
      <Input
        id={f.id}
        type="number"
        inputMode={node.integer ? "numeric" : "decimal"}
        step={node.integer ? 1 : "any"}
        min={node.minimum}
        max={node.maximum}
        value={typeof value === "number" && Number.isFinite(value) ? value : ""}
        readOnly={f.readOnly}
        className="max-w-48"
        aria-invalid={f.messages.length ? true : undefined}
        aria-describedby={describedBy(hint && `${f.id}-hint`, f.messages.length > 0 && `${f.id}-err`)}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(path, raw === "" ? (nullable ? null : undefined) : Number(raw));
        }}
      />
      {hint ? (
        <p id={`${f.id}-hint`} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
      <Issues id={`${f.id}-err`} messages={f.messages} />
    </div>
  );
}

/**
 * A price: typed in the currency's main unit ("19.50", "500" for JPY) with its
 * symbol in front, stored as integer minor units (1950). Text that isn't an
 * amount yet stays as typed, is marked, and stores NaN (sent as null), so a
 * save can't quietly keep the old price.
 */
function MoneyInput({ path, value, onChange, label, currency, hint, nullable }: { path: Path; value: unknown; onChange: (path: Path, next: unknown) => void; label: string; currency: unknown; hint?: string; nullable: boolean }) {
  const f = useField(path);
  const code = typeof currency === "string" && /^[a-z]{3}$/i.test(currency.trim()) ? currency.trim().toLowerCase() : "usd";
  // What the field shows. Re-derived when the value changes from outside (a reset, a save, a new currency); kept while it still means the value.
  const [draft, setDraft] = useState(() => ({ value, code, text: amountText(value, code) }));
  let text = draft.text;
  if (!Object.is(draft.value, value) || draft.code !== code) {
    text = amountText(value, code);
    setDraft({ value, code, text });
  }
  const whole = minorDigits(code) === 0;
  const unreadable = text.trim() !== "" && parseAmount(text, code) === undefined;
  const messages = unreadable ? [whole ? "Enter a whole amount, like 500." : "Enter an amount like 19 or 19.50."] : f.messages;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={f.id} className="text-small font-semibold text-ink">
        {f.labelFor(label)} <span className="font-normal text-ink-3">({code.toUpperCase()})</span>
      </label>
      <div
        className={cn(
          "flex h-10 max-w-48 min-w-0 items-center rounded-md border border-input focus-within:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus pointer-coarse:h-11 dark:bg-card",
          f.readOnly && "bg-tonal dark:bg-tonal",
          INVALID_WRAPPER,
        )}
      >
        <span aria-hidden className="shrink-0 pl-3 text-small text-ink-3">
          {currencySymbol(code)}
        </span>
        <input
          id={f.id}
          type="text"
          inputMode={whole ? "numeric" : "decimal"}
          autoComplete="off"
          value={text}
          readOnly={f.readOnly}
          aria-invalid={messages.length ? true : undefined}
          aria-describedby={describedBy(hint && `${f.id}-hint`, messages.length > 0 && `${f.id}-err`)}
          onChange={(e) => {
            const typed = e.target.value;
            const next = typed.trim() === "" ? (nullable ? null : undefined) : (parseAmount(typed, code) ?? Number.NaN);
            setDraft({ value: next, code, text: typed });
            onChange(path, next);
          }}
          className="tabular h-full min-w-0 flex-1 bg-transparent pr-3 pl-1.5 text-body text-ink outline-none md:text-small"
        />
      </div>
      {hint ? (
        <p id={`${f.id}-hint`} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
      <Issues id={`${f.id}-err`} messages={messages} />
    </div>
  );
}

function BooleanInput({ node, path, value, onChange, label }: Props) {
  const f = useField(path);
  const hint = f.hint ?? node.description;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={f.id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
        <input
          id={f.id}
          type="checkbox"
          checked={value === true}
          disabled={f.readOnly}
          onChange={(e) => onChange(path, e.target.checked)}
          aria-describedby={describedBy(hint && `${f.id}-hint`, f.messages.length > 0 && `${f.id}-err`)}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-(--color-action)"
        />
        <span className="flex flex-col gap-1">
          <span className="text-small font-semibold text-ink">{f.labelFor(label)}</span>
          {hint ? (
            <span id={`${f.id}-hint`} className="text-caption text-ink-3">
              {hint}
            </span>
          ) : null}
        </span>
      </label>
      <Issues id={`${f.id}-err`} messages={f.messages} />
    </div>
  );
}

function EnumInput({ node, path, value, onChange, label }: Props & { node: Extract<FieldNode, { kind: "enum" }> }) {
  const f = useField(path);
  const hint = f.hint ?? node.description;
  const index = node.options.findIndex((o) => o === value);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={f.id} className="text-small font-semibold text-ink">
        {f.labelFor(label)}
      </label>
      <NativeSelect
        id={f.id}
        value={index >= 0 ? String(index) : ""}
        disabled={f.readOnly}
        wrapperClassName="max-w-64"
        aria-invalid={f.messages.length ? true : undefined}
        aria-describedby={describedBy(hint && `${f.id}-hint`, f.messages.length > 0 && `${f.id}-err`)}
        onChange={(e) => onChange(path, node.options[Number(e.target.value)])}
      >
        {index < 0 ? <option value="">Choose…</option> : null}
        {node.options.map((o, i) => (
          <option key={String(o)} value={String(i)}>
            {f.optionLabels[String(o)] ?? humanize(String(o))}
          </option>
        ))}
      </NativeSelect>
      {hint ? (
        <p id={`${f.id}-hint`} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
      <Issues id={`${f.id}-err`} messages={f.messages} />
    </div>
  );
}

function JsonInput({ node, path, value, onChange, label }: Props) {
  const f = useField(path);
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [bad, setBad] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={f.id} className="text-small font-semibold text-ink">
        {f.labelFor(label)} <span className="font-normal text-ink-3">(JSON)</span>
      </label>
      <Textarea
        id={f.id}
        value={text}
        rows={6}
        spellCheck={false}
        className="font-mono text-caption"
        aria-invalid={bad || f.messages.length ? true : undefined}
        aria-describedby={describedBy(node.description && `${f.id}-hint`, bad !== null && `${f.id}-json`, f.messages.length > 0 && `${f.id}-err`)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            onChange(path, JSON.parse(text));
            setBad(null);
          } catch (error) {
            setBad(error instanceof Error ? error.message : "Invalid JSON");
          }
        }}
      />
      {node.description ? (
        <p id={`${f.id}-hint`} className="text-caption text-ink-3">
          {node.description}
        </p>
      ) : null}
      {bad ? (
        <p id={`${f.id}-json`} className="text-small text-danger">
          That isn’t valid JSON yet: {bad}
        </p>
      ) : null}
      <Issues id={`${f.id}-err`} messages={f.messages} />
    </div>
  );
}

/** Row keys: React keys that travel with an item when it moves, so focus and row state go with it. */
let rowSeq = 0;
const newRowKey = () => `row-${++rowSeq}`;

/** The column template of a compact row: the first field narrow, a link wide, the row's buttons last. */
const COMPACT_COLS: Record<number, string> = {
  2: "sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]",
  3: "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]",
};

type RowAction = "up" | "down" | "remove";

function ArrayInput({ node, path, value, onChange, label }: Props & { node: Extract<FieldNode, { kind: "array" }> }) {
  const ctx = useContext(EditorCtx);
  const f = useField(path);
  const items = Array.isArray(value) ? value : [];
  const full = node.maxItems !== undefined && items.length >= node.maxItems;
  const primitive = node.item.kind === "string" || node.item.kind === "number" || node.item.kind === "enum";
  const compact = primitive ? null : compactFields(node.item);
  const headingId = useId();
  const singular = f.labelFor(label).replace(/ies$/, "y").replace(/s$/, "");
  const noun = singular.toLowerCase();
  const hint = f.hint ?? node.description;
  // Hints for a compact row's fields, said once above the list rather than under every row.
  const fieldHints = (compact ?? [])
    .map((field) => {
      const sample = [...path, 0, field.key];
      const text = hintAt(ctx, sample) ?? field.node.description ?? (field.node.kind === "nullable" ? field.node.inner.description : undefined);
      return text ? { key: field.key, id: `${f.id}-hint-${field.key}`, label: ctx.labels[pathPattern(sample)] ?? humanize(field.key), text } : null;
    })
    .filter((x) => x !== null);

  // Stable keys, one per item. If the value changes length from outside (a reset), add or drop keys at the end.
  const [keys, setKeys] = useState<string[]>(() => items.map(newRowKey));
  let rowKeys = keys;
  if (keys.length !== items.length) {
    rowKeys = keys.length > items.length ? keys.slice(0, items.length) : [...keys, ...items.slice(keys.length).map(newRowKey)];
    setKeys(rowKeys);
  }

  // After a move or remove, where focus goes once the list re-renders, and what to say.
  const pendingFocus = useRef<{ index: number; action: RowAction | "add" } | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const row = document.getElementById(`${f.id}-row-${target.index}`);
    const button = (action: RowAction) => row?.querySelector<HTMLButtonElement>(`[data-row-action="${action}"]`) ?? null;
    let el: HTMLElement | null = target.action === "add" ? null : button(target.action);
    // At the top or the bottom the same button is now disabled: take the other direction.
    if (el && (el as HTMLButtonElement).disabled) el = button(target.action === "up" ? "down" : "up");
    (el ?? document.getElementById(`${f.id}-add`))?.focus();
  });

  const move = (from: number, to: number) => {
    setKeys(moveItem(rowKeys, from, to));
    onChange(path, moveItem(items, from, to));
    pendingFocus.current = { index: to, action: to < from ? "up" : "down" };
    setSaid(`Moved ${noun} to position ${to + 1} of ${items.length}.`);
  };
  const remove = (i: number) => {
    const left = items.length - 1;
    setKeys(rowKeys.filter((_, j) => j !== i));
    onChange(path, items.filter((_, j) => j !== i));
    pendingFocus.current = left > 0 ? { index: Math.min(i, left - 1), action: "remove" } : { index: 0, action: "add" };
    setSaid(left > 0 ? `Removed ${noun} ${i + 1}. ${left} left.` : `Removed ${noun} ${i + 1}. The list is empty.`);
  };
  const add = () => {
    setKeys([...rowKeys, newRowKey()]);
    onChange(path, [...items, defaultFor(node.item)]);
    // Focus the new row's first control once it renders.
    requestAnimationFrame(() => {
      const ctxRow = document.getElementById(`${f.id}-row-${items.length}`);
      ctxRow?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    });
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={describedBy(hint && `${f.id}-hint`, f.messages.length > 0 && `${f.id}-err`)}>
      {/* A legend isn't a flex item of its fieldset, so the gap doesn't reach it: its own margin keeps the label-to-content rhythm of the other fields. */}
      <legend id={headingId} className="mb-2 flex w-full items-baseline justify-between gap-3 text-small font-semibold text-ink">
        <span>{f.labelFor(label)}</span>
        <span className="tabular text-caption font-normal text-ink-3">
          {items.length}
          {node.maxItems !== undefined ? ` of ${node.maxItems}` : ""}
        </span>
      </legend>
      {hint || fieldHints.length ? (
        <div className="flex flex-col gap-1">
          {hint ? (
            <p id={`${f.id}-hint`} className="text-caption text-ink-3">
              {hint}
            </p>
          ) : null}
          {fieldHints.map((h) => (
            <p key={h.key} id={h.id} className="text-caption text-ink-3">
              <span className="font-semibold text-ink-2">{h.label}:</span> {h.text}
            </p>
          ))}
        </div>
      ) : null}
      <Issues id={`${f.id}-err`} messages={f.messages} />
      <p role="status" className="sr-only">
        {said}
      </p>
      {items.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-small text-ink-3">None yet.</p> : null}
      <ol className={cn("flex flex-col", compact ? "gap-3 sm:gap-2" : "gap-3")}>
        {items.map((item, i) => {
          const rowPath = [...path, i];
          const title = itemSummary(item);
          const rowLabel = `${singular} ${i + 1}${title && !primitive ? `: ${title}` : ""}`;
          const controls = (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button type="button" variant="ghost" size="icon-sm" className="pointer-coarse:size-11" data-row-action="up" aria-label={`Move ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                <ArrowUpIcon />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" className="pointer-coarse:size-11" data-row-action="down" aria-label={`Move ${noun} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>
                <ArrowDownIcon />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" className="pointer-coarse:size-11" data-row-action="remove" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => remove(i)}>
                <Trash2Icon />
              </Button>
            </div>
          );
          const rec = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
          const rowMessages = compact ? messagesAt(ctx, rowPath) : [];
          return (
            <li
              key={rowKeys[i]}
              id={`${f.id}-row-${i}`}
              className={
                primitive
                  ? "flex items-end gap-2"
                  : compact
                    ? cn("grid grid-cols-1 items-start gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0", COMPACT_COLS[compact.length])
                    : "flex flex-col gap-4 rounded-lg border border-line bg-bg p-4"
              }
            >
              {primitive ? (
                <>
                  <div className="min-w-0 flex-1">
                    <FieldEditor node={node.item} path={rowPath} value={item} onChange={onChange} label={rowLabel} bareLabel />
                  </div>
                  <div className="pb-1">{controls}</div>
                </>
              ) : compact ? (
                <>
                  {compact.map((field) => (
                    <div key={field.key} className="min-w-0">
                      <FieldEditor
                        node={field.node}
                        path={[...rowPath, field.key]}
                        value={rec[field.key]}
                        siblings={rec}
                        onChange={onChange}
                        label={humanize(field.key)}
                        inline={{ suffix: `, ${noun} ${i + 1}`, hideLabel: i > 0, hintId: fieldHints.find((h) => h.key === field.key)?.id }}
                      />
                    </div>
                  ))}
                  {/* Centred on the inputs (40 px) from sm up: under the column labels (21 px + the 8 px gap) on the first row; on later rows the label takes no room (sm:contents), so 4 px centres the 32 px buttons. */}
                  <div className={cn("justify-self-end", i === 0 ? "sm:pt-8" : "sm:pt-1")}>{controls}</div>
                  {rowMessages.length ? (
                    <div className="sm:col-span-full">
                      <Issues id={`${f.id}-row-${i}-err`} messages={rowMessages} />
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-small font-semibold text-ink-2">{rowLabel}</p>
                    {controls}
                  </div>
                  <FieldEditor node={node.item} path={rowPath} value={item} onChange={onChange} label={rowLabel} nested={false} />
                </>
              )}
            </li>
          );
        })}
      </ol>
      <div>
        <Button id={`${f.id}-add`} type="button" variant="outline" size="sm" onClick={add} disabled={full}>
          <PlusIcon aria-hidden /> Add {noun}
        </Button>
        {full ? <span className="ml-3 text-caption text-ink-3">That’s the most this section takes.</span> : null}
      </div>
    </fieldset>
  );
}

function ObjectInput({ node, path, value, onChange, label, nested = true }: Props & { node: Extract<FieldNode, { kind: "object" }>; nested?: boolean }) {
  const f = useField(path);
  const rec = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const fields = (
    <div className="grid gap-5">
      {node.fields.map((field) => (
        <FieldEditor key={field.key} node={field.node} path={[...path, field.key]} value={rec[field.key]} siblings={rec} onChange={onChange} label={humanize(field.key)} />
      ))}
    </div>
  );
  if (!nested || path.length === 0) {
    return (
      <>
        <Issues id={`${f.id}-err`} messages={f.messages} />
        {fields}
      </>
    );
  }
  const hint = f.hint ?? node.description;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-line p-4"
      aria-describedby={describedBy(hint && `${f.id}-hint`, f.messages.length > 0 && `${f.id}-err`)}
    >
      <legend className="px-1 text-small font-semibold text-ink">{f.labelFor(label)}</legend>
      {hint ? (
        <p id={`${f.id}-hint`} className="-mt-2 text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
      <Issues id={`${f.id}-err`} messages={f.messages} />
      {fields}
    </fieldset>
  );
}

function NullableInput({ node, path, value, onChange, label, inline, siblings }: Props & { node: Extract<FieldNode, { kind: "nullable" }> }) {
  const f = useField(path);
  const inner = node.inner;
  // Text and numbers: empty means "none" — no extra switch.
  if (inner.kind === "string") return <StringInput node={{ ...inner, description: inner.description ?? node.description }} path={path} value={value} onChange={onChange} label={label} inline={inline} nullable />;
  if (inner.kind === "number") return <NumberInput node={{ ...inner, description: inner.description ?? node.description }} path={path} value={value} onChange={onChange} label={label} siblings={siblings} nullable />;
  const on = value !== null && value !== undefined;
  const name = f.labelFor(label);
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={`${f.id}-on`} className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          id={`${f.id}-on`}
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(path, e.target.checked ? enabledValueFor(node) : null)}
          className="size-5 shrink-0 cursor-pointer rounded accent-(--color-action)"
        />
        <span className="text-small font-semibold text-ink">{name}</span>
        {!on ? <span className="text-caption text-ink-3">Off</span> : null}
      </label>
      {node.description ? <p className="-mt-2 text-caption text-ink-3">{node.description}</p> : null}
      <Issues id={`${f.id}-err`} messages={f.messages} />
      {on ? (
        <div className="border-l-2 border-line pl-4">
          <FieldEditor node={inner} path={path} value={value} onChange={onChange} label={name} nested={false} />
        </div>
      ) : null}
    </div>
  );
}

/** One field of the editor, chosen by its node's kind. */
export function FieldEditor(props: Props & { nested?: boolean }) {
  const { node } = props;
  switch (node.kind) {
    case "string":
      return <StringInput {...props} node={node} />;
    case "number":
      return <NumberInput {...props} node={node} />;
    case "boolean":
      return <BooleanInput {...props} />;
    case "enum":
      return <EnumInput {...props} node={node} />;
    case "array":
      return <ArrayInput {...props} node={node} />;
    case "object":
      return <ObjectInput {...props} node={node} />;
    case "nullable":
      return <NullableInput {...props} node={node} />;
    case "json":
      return <JsonInput {...props} />;
  }
}
