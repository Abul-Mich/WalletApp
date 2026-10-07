// One place for how money, numbers and dates look. The locale and time zone are
// fixed on purpose so every phone shows the same thing (English, Beirut time).

const TZ = "Asia/Beirut";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const plain2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ,
});
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ });
const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const timeOnly = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// $1,234.50  (negative: -$5.00)
export const formatUsd = (v) => usd.format(n(v));
// 1,234,500 LBP  (whole pounds; stored values are not rounded)
export const formatLbp = (v) => `${whole.format(Math.round(n(v)))} LBP`;
// Plain number with 2 decimals, no currency: 1,234.50
export const formatNumber2 = (v) => plain2.format(n(v));
export const formatWhole = (v) => whole.format(Math.round(n(v)));

export function formatMoney(v, currency = "USD") {
  if (currency === "USD" || !currency) return formatUsd(v);
  if (currency === "LBP") return formatLbp(v);
  return `${plain2.format(n(v))} ${currency}`;
}

// 89,500 LBP per $1
export const formatRate = (v) => `${whole.format(Math.round(n(v)))} LBP per $1`;
export const formatPercent = (v) => `${Math.round(n(v) * 100)}%`;

// 7 Oct 2026, 14:15  (Beirut time, 24 hour)
export const formatDateTime = (iso) => dateTime.format(new Date(iso));
export const formatShortDate = (iso) => shortDate.format(new Date(iso));
export const formatDate = (iso) => longDate.format(new Date(iso));
export const formatTime = (iso) => timeOnly.format(new Date(iso));

// Accepts "10.5", "10,5", "1,234.50", "1.234,50", "900,000", "900 000".
// Returns NaN when it is not a number.
export function parseNumber(input) {
  if (typeof input === "number") return input;
  let s = String(input ?? "").trim().replace(/[\s ]/g, "");
  if (!s) return NaN;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // the separator that comes last is the decimal mark
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    // 900,000 or 1,234,567 are thousands; 10,5 / 10,50 is a decimal
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, ""); // 1.234.567
  }
  return /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}
