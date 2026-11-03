"use client";

//
// <SchemaEditor> — the admin's generic editor for any zod-validated JSON value
// (a content section, a plan). The page converts the real schema with
// z.toJSONSchema and toFieldNode() and passes the FieldNode tree; this renders
// a form for it, plus a raw JSON tab for people who'd rather type.
//
// Rules:
//  - Validation is the server's. Save posts the whole value as JSON (one hidden
//    input); the service parses it with the real schema and returns issues by
//    path, which appear under the exact field and in a summary that links to
//    each one. Editing a field hides its stale issue.
//  - After a save or a reset the server returns the stored value, and the
//    editor takes it as the new baseline ("Unsaved changes" compares to that).
//  - Leaving with unsaved changes asks first (beforeunload).
//  - The JSON tab is the same value. Switching back to the form parses it; a
//    syntax error keeps you on the JSON tab with the reason.
//

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, CLEAR_OF_STICKY_BAR, FormMessage, SubmitButton, useActionForm, type FormAction } from "@/components/product/action-form";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";
import { humanize, setAt, type FieldNode, type Path } from "@/lib/schema-form";
import { EditorCtx, FieldEditor, controlId, type EditorContext } from "./schema-fields";

export interface SchemaEditorProps {
  /** The FieldNode tree of the value's schema (an object at the root). */
  node: FieldNode;
  /** The current value, with schema defaults filled in. */
  initial: unknown;
  /** Saves the value posted as the JSON field "value". On success returns `data.value` (the stored value, as JSON). */
  action: FormAction;
  saveLabel?: string;
  /** Restores the default. Same success contract as `action`. Omit to hide the button. */
  resetAction?: FormAction;
  resetLabel?: string;
  /**
   * Whether there is anything to reset (a stored value). Only hides the button:
   * the dialog stays mounted, so its result still reaches the editor after the
   * page refreshes to "nothing stored".
   */
  resettable?: boolean;
  /** Paths shown but not editable ("key" on an existing plan). */
  readOnly?: string[];
  /** Hints by path or row pattern: { "prices.*.amountCents": "In cents: 1900 = $19.00" }. */
  hints?: Record<string, string>;
  /** Example values for empty text fields, by path or pattern: { "social.x": "https://x.com/yourname" }. */
  placeholders?: Record<string, string>;
  /** Label overrides by path or pattern. */
  labels?: Record<string, string>;
  /** Option labels for enums, by path or pattern: { "prices.*.interval": { one_time: "One-time" } }. */
  optionLabels?: Record<string, Record<string, string>>;
  /** Money fields (integer minor units) by path or pattern → the sibling field with their currency: { "prices.*.amountCents": "currency" }. */
  money?: Record<string, string>;
  /** Prefix for control ids, unique per page. */
  idPrefix?: string;
}

const serialize = (v: unknown) => JSON.stringify(v ?? null);

function storedValue(state: ActionState): { ok: true; value: unknown } | null {
  const raw = state.data?.value;
  if (!state.ok || typeof raw !== "string") return null;
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return null;
  }
}

/** The issue summary: every problem the server found, each a link to its field. */
function IssueSummary({ idPrefix, onJump }: { idPrefix: string; onJump: (path: string) => void }) {
  const { state } = useActionForm();
  if (state.ok || !state.issues?.length) return null;
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger-line bg-danger-soft p-4">
      <p className="text-small font-semibold text-danger">{state.issues.length === 1 ? "One thing to fix before this can be saved" : `${state.issues.length} things to fix before this can be saved`}</p>
      <ul className="flex flex-col gap-1 text-small text-ink">
        {state.issues.map((issue, i) => (
          <li key={`${issue.path}-${i}`}>
            {issue.path ? (
              <a
                href={`#${controlId(idPrefix, issue.path)}`}
                onClick={(e) => {
                  e.preventDefault();
                  onJump(issue.path);
                }}
                className="font-semibold underline decoration-ink-faint underline-offset-4 hover:decoration-ink"
              >
                {issue.path
                  .split(".")
                  .map((p) => (/^\d+$/.test(p) ? `#${Number(p) + 1}` : humanize(p)))
                  .join(" › ")}
              </a>
            ) : (
              <span className="font-semibold">Whole value</span>
            )}
            : {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditorBody({
  node,
  value,
  setValue,
  raw,
  setRaw,
  tab,
  setTab,
  idPrefix,
  base,
  edited,
  markEdited,
}: {
  node: FieldNode;
  value: unknown;
  setValue: (v: unknown) => void;
  raw: string;
  setRaw: (s: string) => void;
  tab: string;
  setTab: (t: string) => void;
  idPrefix: string;
  base: Omit<EditorContext, "issues" | "edited">;
  edited: Set<string>;
  markEdited: (key: string) => void;
}) {
  const { state } = useActionForm();
  const [jsonError, setJsonError] = useState<string | null>(null);

  const issues = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!state.ok) for (const i of state.issues ?? []) m.set(i.path, [...(m.get(i.path) ?? []), i.message]);
    return m;
  }, [state]);

  const onChange = useCallback(
    (path: Path, next: unknown) => {
      markEdited(path.join("."));
      setValue(setAt(value, path, next));
    },
    [value, setValue, markEdited],
  );

  const jump = (path: string) => {
    const go = () => {
      const el = document.getElementById(controlId(idPrefix, path));
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    };
    if (tab !== "form") {
      setTab("form");
      requestAnimationFrame(go);
    } else go();
  };

  const switchTab = (next: string) => {
    if (next === tab) return;
    if (next === "json") {
      setRaw(JSON.stringify(value, null, 2));
      setJsonError(null);
      setTab("json");
      return;
    }
    try {
      setValue(JSON.parse(raw));
      setJsonError(null);
      setTab("form");
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  return (
    <EditorCtx.Provider value={{ ...base, issues, edited }}>
      <IssueSummary idPrefix={idPrefix} onJump={jump} />
      <Tabs value={tab} onValueChange={(v) => switchTab(String(v))}>
        <TabsList aria-label="Edit as">
          <TabsTrigger value="form">Form</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        <TabsContent value="form" className="pt-4">
          <FieldEditor node={node} path={[]} value={value} onChange={onChange} label="Value" />
        </TabsContent>
        <TabsContent value="json" className="flex flex-col gap-2 pt-4">
          <label htmlFor={`${idPrefix}-json`} className="text-small font-semibold text-ink">
            The whole value as JSON
          </label>
          <Textarea
            id={`${idPrefix}-json`}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setJsonError(null);
            }}
            spellCheck={false}
            rows={22}
            className="field-sizing-fixed font-mono text-caption leading-relaxed"
            aria-invalid={jsonError ? true : undefined}
            aria-describedby={jsonError ? `${idPrefix}-json-err` : undefined}
          />
          {jsonError ? (
            <p id={`${idPrefix}-json-err`} role="alert" className="text-small text-danger">
              Fix the JSON to go back to the form: {jsonError}
            </p>
          ) : (
            <p className="text-caption text-ink-3">Saving from here checks it against the same schema as the form.</p>
          )}
        </TabsContent>
      </Tabs>
    </EditorCtx.Provider>
  );
}

export function SchemaEditor({
  node,
  initial,
  action,
  saveLabel = "Save",
  resetAction,
  resetLabel = "Reset to default",
  resettable = true,
  readOnly = [],
  hints = {},
  placeholders = {},
  labels = {},
  optionLabels = {},
  money = {},
  idPrefix = "ed",
}: SchemaEditorProps) {
  const [value, setValue] = useState<unknown>(initial);
  const [baseline, setBaseline] = useState(() => serialize(initial));
  const [tab, setTab] = useState("form");
  const [raw, setRaw] = useState(() => JSON.stringify(initial, null, 2));
  const [edited, setEdited] = useState<Set<string>>(() => new Set());
  const [resetOpen, setResetOpen] = useState(false);

  const current = tab === "json" ? raw : serialize(value);
  const dirty = tab === "json" ? (() => {
    try {
      return serialize(JSON.parse(raw)) !== baseline;
    } catch {
      return true;
    }
  })() : serialize(value) !== baseline;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const markEdited = useCallback((key: string) => {
    setEdited((s) => (s.has(key) ? s : new Set(s).add(key)));
  }, []);

  const adopt = useCallback((state: ActionState) => {
    setEdited(new Set());
    const stored = storedValue(state);
    if (!stored) return;
    setValue(stored.value);
    setRaw(JSON.stringify(stored.value, null, 2));
    setBaseline(serialize(stored.value));
  }, []);

  const base = { idPrefix, readOnly: new Set(readOnly), hints, placeholders, labels, optionLabels, money };

  return (
    <div className="flex flex-col gap-4">
      <ActionForm action={action} onResult={adopt} toast={false} className={cn("flex flex-col gap-5", CLEAR_OF_STICKY_BAR)}>
        <input type="hidden" name="value" value={current} />
        <EditorBody
          node={node}
          value={value}
          setValue={setValue}
          raw={raw}
          setRaw={setRaw}
          tab={tab}
          setTab={setTab}
          idPrefix={idPrefix}
          base={base}
          edited={edited}
          markEdited={markEdited}
        />
        <div data-sticky-save className="sticky bottom-0 z-[1] -mx-5 flex flex-wrap items-center gap-3 border-t border-line bg-card/95 px-5 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
          <SubmitButton disabled={!dirty}>{saveLabel}</SubmitButton>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const back = JSON.parse(baseline) as unknown;
                setValue(back);
                setRaw(JSON.stringify(back, null, 2));
                setEdited(new Set());
              }}
            >
              Discard changes
            </Button>
          ) : null}
          <span className="text-small text-ink-3" aria-live="polite">
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <FormMessage className="basis-full" />
        </div>
      </ActionForm>

      {resetAction ? (
        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" className="self-start" hidden={!resettable} />}>
            <RotateCcwIcon aria-hidden /> {resetLabel}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{resetLabel}?</AlertDialogTitle>
              <AlertDialogDescription>
                The stored value is removed and the section shows the template’s default again. The old value stays in the audit log, so you can restore it from
                there.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ActionForm
              action={resetAction}
              onResult={(state) => {
                adopt(state);
                if (state.ok) setResetOpen(false);
              }}
            >
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <SubmitButton variant="destructive">{resetLabel}</SubmitButton>
              </AlertDialogFooter>
              <FormMessage hideSuccess className="mt-3" />
            </ActionForm>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
