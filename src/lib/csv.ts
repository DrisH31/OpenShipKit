//
// CSV for exports (the subscriber list). RFC 4180 quoting, CRLF line ends, and
// one rule that matters for safety: a cell that starts with = + - @ (or a tab /
// carriage return) is prefixed with a single quote, so a spreadsheet opening
// the file never evaluates it as a formula (CSV / formula injection, OWASP).
//

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell, escaped and quoted when needed. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || s !== s.trim()) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One line, CRLF-terminated. */
export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}
