//
// Numbers and dates for product screens, formatted ONE way everywhere so a
// figure on the dashboard and the same figure in the admin always agree.
//
// Rules: the locale is fixed (en-US) and dates are shown in UTC, so the
// server-rendered HTML and anything a client component formats match exactly
// (no hydration drift, no "yesterday" that is today in another zone).
// Relative times take `now` as an argument for the same reason.
//

const LOCALE = "en-US";

/** A change between periods: whole percent, no sign — the word or the arrow says which way. */
export const pctChange = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0, signDisplay: "never" });

const whole = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** 1234 → "1,234". */
export function formatCount(n: number): string {
  return whole.format(n);
}

/** "1 user", "2 users". `plural` defaults to `${singular}s`. */
export function plural(n: number, singular: string, pluralWord = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : pluralWord}`;
}

const dateFmt = new Intl.DateTimeFormat(LOCALE, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

function toDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Oct 6, 2026" (UTC). Empty input → "—". */
export function formatDate(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  return d ? dateFmt.format(d) : "—";
}

/** "Oct 6, 2026, 14:03 UTC". Empty input → "—". */
export function formatDateTime(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  return d ? `${dateTimeFmt.format(d)} UTC` : "—";
}

/**
 * "just now", "5 min ago", "3 h ago", "2 days ago", then the date. Future
 * times read "in 5 min" / "in 3 days". Pass `now` from the server render.
 */
export function relativeTime(iso: string | Date | null | undefined, now: Date = new Date()): string {
  const d = toDate(iso);
  if (!d) return "—";
  const diff = now.getTime() - d.getTime();
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const say = (n: number, unit: string) => (future ? `in ${n} ${unit}` : `${n} ${unit} ago`);
  if (s < 45) return future ? "in a moment" : "just now";
  const m = Math.round(s / 60);
  if (m < 60) return say(m, "min");
  const h = Math.round(m / 60);
  if (h < 24) return say(h, "h");
  const days = Math.round(h / 24);
  if (days < 30) return say(days, days === 1 ? "day" : "days");
  return formatDate(d);
}

/** For <input type="datetime-local">: "2026-10-06T14:03" in UTC, or "" for none. */
export function toDateTimeLocal(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? d.toISOString().slice(0, 16) : "";
}

/** "a:b::c" → eight 16-bit groups, or null when it isn't an IPv6 address. Accepts a trailing dotted IPv4 ("::ffff:1.2.3.4"). */
function ipv6Groups(address: string): number[] | null {
  let text = address;
  const tail: number[] = [];
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const octets = dotted[2].split(".").map(Number);
    if (octets.some((o) => o > 255)) return null;
    tail.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
    text = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (![...head, ...rest].every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const zeros = Array<number>(8 - known).fill(0);
  return [...head.map((g) => parseInt(g, 16)), ...zeros, ...rest.map((g) => parseInt(g, 16)), ...tail];
}

/** Eight groups → the short form (RFC 5952): lowercase, no leading zeros, the longest run of two or more zero groups as "::". */
function compressIpv6(groups: number[]): string {
  let best = { at: -1, len: 1 };
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best.at < 0) return hex.join(":");
  return `${hex.slice(0, best.at).join(":")}::${hex.slice(best.at + best.len).join(":")}`;
}

/**
 * An IP address as a person should read it, or null when it says nothing:
 * IPv6 in its short form, an IPv4-mapped IPv6 address as plain IPv4, a
 * loopback address (127.x, ::1) as "This machine", and an unspecified one
 * (0.0.0.0, ::, all-zero groups) or an empty value as null. Anything that
 * doesn't parse is returned trimmed, as stored.
 */
export function formatIpAddress(ip: string | null | undefined): string | null {
  const raw = ip?.trim().replace(/%.*$/, "") ?? "";
  if (!raw) return null;
  const v4 = (text: string) => {
    if (text === "0.0.0.0") return null;
    return text.startsWith("127.") ? "This machine" : text;
  };
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return v4(raw);
  const groups = ipv6Groups(raw);
  if (!groups) return raw;
  if (groups.every((g) => g === 0)) return null;
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "This machine";
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return v4([groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join("."));
  }
  return compressIpv6(groups);
}
