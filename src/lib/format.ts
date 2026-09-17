import type { Currency } from "../bindings/Currency";

// ISO codes (USD 12,345.60) avoid ambiguity between the "$" of different pesos.
const LOCALE = "en-US";
const cache = new Map<string, Intl.NumberFormat>();

function formatter(key: string, options: Intl.NumberFormatOptions) {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, options);
    cache.set(key, f);
  }
  return f;
}

export function fmtMoney(value: number | null | undefined, currency: Currency, opts: { compact?: boolean } = {}): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const compact = opts.compact && abs >= 10_000;
  // Money always carries its cents, and always the same number of them: in a
  // column where 555.69 sits under 55,428, a figure that drops its decimals
  // while its neighbour keeps them can't be compared at a glance. Only the
  // compact form (chart axes) trades precision for width.
  const decimals = !opts.compact ? 2 : compact ? 1 : abs >= 1_000 ? 0 : 2;
  return formatter(`m:${currency}:${compact}:${decimals}`, {
    style: "currency",
    currency,
    currencyDisplay: "code",
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: compact ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function fmtNum(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatter("n", { maximumFractionDigits: 1 }).format(value);
}

export function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatter("p", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

/**
 * The engine works in years; a subscription price is typed and quoted per month,
 * so every price per building crosses this on its way to the screen.
 */
export function perMonth(value: number | null | undefined): number | null | undefined {
  return value == null ? value : value / 12;
}

export function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });
}
