//
// isLocalUrl(): is this site URL one only this machine can reach? The ONE
// host list, so the setup checklist on /dashboard, the landing hero's preview
// and the production boot check (src/server/boot-check.ts) can’t disagree about
// whether NEXT_PUBLIC_SITE_URL is still a development address.
//
// Local: localhost and *.localhost, the whole 127.0.0.0/8 loopback range,
// 0.0.0.0 and IPv6 loopback ([::1], and the unspecified [::]). Pure and
// client-safe; an unparseable URL counts as local (it isn't a deployed site).
//

/** True for a host (no port) only this machine can reach. Accepts "[::1]" or "::1". */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "::") return true;
  return /^127(\.\d{1,3}){3}$/.test(h);
}

/** True when `url` points at this machine (or isn't a URL at all). */
export function isLocalUrl(url: string): boolean {
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return true;
  }
}
