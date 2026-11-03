//
// A price as a person types it ("19.50") and as it is stored (1950, integer
// minor units). Pure, client-safe; the currency's minor unit comes from
// src/shared/money.ts, so JPY's 500 stays 500.
//
//   amountText(1950, "usd")   → "19.50"
//   amountText(500, "jpy")    → "500"
//   parseAmount("19", "usd")  → 1900
//   parseAmount("1,299.5", "usd") → 129950
//   parseAmount("19.999", "usd")  → undefined (more decimals than the currency has)
//

import { isZeroDecimal } from "@/shared/money";

/** Decimal places of the currency's main unit: 2, or 0 for JPY and the other zero-decimal currencies. */
export function minorDigits(currency: string): number {
  return isZeroDecimal(currency) ? 0 : 2;
}

/** Stored minor units → the text in the field. Not a finite number → "". */
export function amountText(minor: unknown, currency: string): string {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "";
  const digits = minorDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

/** What a person typed → minor units; undefined when it isn't an amount in this currency. Thousands commas and spaces are ignored. */
export function parseAmount(text: string, currency: string): number | undefined {
  const clean = text.replace(/[\s,]/g, "");
  const digits = minorDigits(currency);
  const m = clean.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (m[1] === "" && !m[2])) return undefined;
  const fraction = m[2] ?? "";
  if (fraction.length > digits) return undefined;
  return Number(m[1] || "0") * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
}

/** The currency's symbol for a field prefix: "$", "€", "¥"; the code itself when the runtime doesn't know it. */
export function currencySymbol(currency: string): string {
  const code = currency.trim().toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}
