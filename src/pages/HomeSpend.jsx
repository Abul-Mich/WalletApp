import { useEffect, useState } from "react";
import { spendRollup } from "../lib/wallets";
import { periodStartIso } from "../lib/beirutTime";
import { formatUsd } from "../lib/format";

// Home spending figures. Every number here comes from spend_rollup, the same function the
// Statistics page uses, so "spent" is always the sum of every spending record (wallet expenses,
// card spending, and common expenses tagged to the member) for the period.

const TZ = "Asia/Beirut";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UNIT = { weekly: "weekly", monthly: "monthly" };

// "Nov 1" for a monthly limit, the next Monday for a weekly one.
function resetsOn(period, startIso) {
  const start = new Date(startIso);
  if (period === "monthly") {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric" }).formatToParts(start).map((x) => [x.type, x.value]));
    return `${MONTHS[Number(p.month) % 12]} 1`;
  }
  const next = new Date(start.getTime() + 7 * 24 * 3600 * 1000 + 6 * 3600 * 1000); // +7 days, safely past a DST shift
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(next);
}

const total = (r) => Number((r && r.total) || 0);

// triggers: three values that change whenever records change, so the numbers follow new expenses.
export function useHomeSpend({ familyId, member, amAdmin, triggers = [] }) {
  const [state, setState] = useState({ month: null, limit: null });
  const limitAmount = member?.spending_limit_amount ?? null;
  const limitPeriod = member?.spending_limit_period ?? null;

  useEffect(() => {
    if (!familyId || !member?.id) return;
    let live = true;
    // Wait a moment so several quick changes (the page is still loading) become one request.
    const timer = setTimeout(async () => {
      try {
        const monthFrom = periodStartIso("monthly");
        const monthMember = amAdmin ? null : member.id;
        const hasLimit = !!(limitAmount && limitPeriod);
        const limitFrom = hasLimit ? periodStartIso(limitPeriod) : null;
        // The limit figure is the same query as the month figure when a non-admin has a monthly limit.
        const sameQuery = hasLimit && limitFrom === monthFrom && monthMember === member.id;
        const [monthRoll, limitRoll] = await Promise.all([
          spendRollup({ familyId, from: monthFrom, memberId: monthMember }),
          hasLimit && !sameQuery ? spendRollup({ familyId, from: limitFrom, memberId: member.id }) : null,
        ]);
        const month = total(monthRoll);
        let limit = null;
        if (hasLimit) {
          const spent = sameQuery ? month : total(limitRoll);
          const cap = Number(limitAmount);
          const pct = cap > 0 ? spent / cap : 0;
          limit = {
            spent, limit: cap, period: limitPeriod, percentUsed: pct,
            isNearLimit: pct >= 0.8 && pct < 1, isOverLimit: pct >= 1,
            left: cap - spent, resets: resetsOn(limitPeriod, limitFrom),
          };
        }
        if (live) setState({ month, limit });
      } catch (err) {
        console.error("Home spending failed:", err);
      }
    }, 250);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, member?.id, amAdmin, limitAmount, limitPeriod, triggers[0], triggers[1], triggers[2]]);

  return state;
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

// Slim row under the carousel: what was spent this month. Admins see everyone, members see themselves.
export function SpentChip({ amount, everyone, onOpen }) {
  if (amount === null) return null;
  return (
    <button type="button" className="hs-slim hs-slim-row" onClick={onOpen}>
      <span className="hs-slim-text"><span className="hs-muted">Spent this month · {everyone ? "everyone" : "you"}</span><strong>{formatUsd(amount)}</strong></span>
      <span className="hs-link">Statistics<Chevron /></span>
    </button>
  );
}

// Slim limit bar under the carousel (replaces "My spending"): what is left, the bar, when it resets.
export function LimitCard({ limit, onOpen }) {
  if (!limit) return null;
  const over = limit.isOverLimit;
  const tone = over ? "over" : limit.isNearLimit ? "near" : "ok";
  const pct = Math.max(0, Math.min(100, limit.percentUsed * 100));
  return (
    <button type="button" className="hs-slim" onClick={onOpen} aria-label="Your spending limit, open statistics">
      <span className="hs-slim-line">
        <span className="hs-slim-text">
          <strong className={tone}>{formatUsd(over ? -limit.left : limit.left)}</strong>
          <span className="hs-muted">{over ? "over your" : "left of"} {formatUsd(limit.limit)} {UNIT[limit.period] || limit.period} limit</span>
        </span>
        <span className="hs-muted hs-resets">Resets {limit.resets}</span>
      </span>
      <span className="hs-bar" aria-hidden="true"><span className={`hs-fill ${tone}`} style={{ width: `${pct}%` }} /></span>
    </button>
  );
}
