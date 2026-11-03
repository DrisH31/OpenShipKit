//
// Money from integer minor units — pure, safe in client and server code. The
// one place that knows a currency's minor unit, so the pricing page, llms.txt
// and the Offer JSON-LD always state the same price.
//
//   toMajorUnits(1900, "usd")  → 19
//   toMajorUnits(500, "jpy")   → 500    (no minor unit: ¥500 is 500, not 50000)
//   offerPrice(1950, "usd")    → "19.50" (schema.org Offer.price)
//   offerPrice(500, "jpy")     → "500"
//   formatPrice(1950, "usd")   → "$19.50"
//
// The locale defaults to en-US, not the visitor's, so server-rendered HTML and
// the hydrated client always agree. Whole amounts drop the ".00".
//

/** Currencies with no minor unit: amounts are already whole (¥500 is 500, not 50000). */
export const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

/** True when the currency has no minor unit (JPY, KRW …). */
export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL.has(currency.trim().toLowerCase());
}

/** An amount in minor units as major units: 1900 USD → 19, 500 JPY → 500. */
export function toMajorUnits(amountCents: number, currency: string): number {
  return isZeroDecimal(currency) ? amountCents : amountCents / 100;
}

/** The machine-readable price for schema.org Offers: "19.00", "19.50", "500" (JPY). */
export function offerPrice(amountCents: number, currency: string): string {
  return toMajorUnits(amountCents, currency).toFixed(isZeroDecimal(currency) ? 0 : 2);
}

/** An integer amount in minor units as a localised price: "$19", "$19.50", "€9", "¥500". */
export function formatPrice(amountCents: number, currency: string, locale = "en-US"): string {
  const code = currency.trim().toUpperCase() || "USD";
  const amount = toMajorUnits(amountCents, code);
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: whole ? 0 : undefined,
      maximumFractionDigits: whole ? 0 : undefined,
    }).format(amount);
  } catch {
    // An unknown currency code or locale: still show something honest.
    return `${amount.toFixed(whole ? 0 : 2)} ${code}`;
  }
}
