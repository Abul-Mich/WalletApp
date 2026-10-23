import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { periodStartIso } from "./beirutTime";
import {
  latestLbpRate, createExpense, createCommonBill, deleteCommonBill, payCommonBill,
} from "./wallets";

// One list for every bill: family bills (common_bills, admins add and pay them from the pool or a
// card) and personal bills (planned_payments created by the member, paid from their own wallet).
// Dates are plain "YYYY-MM-DD" keys on the Beirut calendar, so "due today" never shifts with the phone's time zone.

const TZ = "Asia/Beirut";
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
export const todayKey = () => keyFmt.format(new Date());
const parts = (k) => k.split("-").map(Number);
const utc = (k) => { const [y, m, d] = parts(k); return Date.UTC(y, m - 1, d); };

export function daysUntil(key) {
  return Math.round((utc(key) - utc(todayKey())) / 86400000);
}
export function addDaysKey(key, n) {
  return new Date(utc(key) + n * 86400000).toISOString().slice(0, 10);
}
// +1 month, keeping the day when it exists (Jan 31 -> Feb 28), like the database does.
export function addMonthKey(key) {
  const [y, m, d] = parts(key);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}
export const nextDueKey = (key, recurrence) => (recurrence === "weekly" ? addDaysKey(key, 7) : addMonthKey(key));
export const monthEndKey = () => {
  const [y, m] = parts(todayKey());
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const shortDay = (key) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(utc(key)));
export const monthName = () =>
  new Intl.DateTimeFormat("en-US", { month: "long", timeZone: TZ }).format(new Date());

export function dueText(days) {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} late`;
  if (days === 0) return "due today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
export const bucketOf = (days) => (days < 0 ? "late" : days <= 7 ? "soon" : "later");
export const REPEAT_TEXT = { monthly: "every month", weekly: "every week", one_time: "one time" };

function normalize(row, scope, rate) {
  const amount = Number(row.amount);
  const days = daysUntil(row.next_due_date);
  const usd = row.currency === "USD" ? amount : rate > 0 ? amount / rate : null;
  return {
    key: `${scope}:${row.id}`, id: row.id, scope, name: row.name, amount, currency: row.currency,
    recurrence: row.recurrence, due: row.next_due_date, days, bucket: bucketOf(days), usd,
    categoryId: row.category_id || null, taggedMemberId: row.tagged_member_id || null,
  };
}

const byDue = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.name.localeCompare(b.name));

export function useBills({ familyId, member, triggers = [] }) {
  const [data, setData] = useState({ items: [], paid: [], rate: 0, loaded: false });
  const timer = useRef(null);
  const memberId = member?.id;

  const reload = useCallback(async () => {
    if (!familyId || !memberId) return;
    const monthFrom = periodStartIso("monthly");
    const [fam, mine, famPaid, minePaid] = await Promise.all([
      supabase.from("common_bills").select("*").eq("family_id", familyId).eq("is_active", true),
      supabase.from("planned_payments").select("*").eq("family_id", familyId).eq("created_by_member_id", memberId).eq("is_active", true),
      supabase.from("common_expenses").select("id, title, amount, currency, net_usd, created_at, bill_id")
        .eq("family_id", familyId).not("bill_id", "is", null).gte("created_at", monthFrom),
      supabase.from("transactions").select("id, note, net_usd, created_at")
        .eq("family_id", familyId).eq("member_id", memberId).ilike("note", "Bill: %").gte("created_at", monthFrom),
    ]);
    const anyLbp = [...(fam.data || []), ...(mine.data || [])].some((b) => b.currency === "LBP");
    const rate = anyLbp ? Number((await latestLbpRate(familyId)) || 0) : 0;
    const items = [
      ...(fam.data || []).map((r) => normalize(r, "family", rate)),
      ...(mine.data || []).map((r) => normalize(r, "mine", rate)),
    ].sort(byDue);
    const day = (iso) => keyFmt.format(new Date(iso));
    const paid = [
      ...(famPaid.data || []).map((r) => ({ key: `fp:${r.id}`, scope: "family", name: r.title, usd: Number(r.net_usd), date: day(r.created_at) })),
      ...(minePaid.data || []).map((r) => ({ key: `mp:${r.id}`, scope: "mine", name: String(r.note).replace(/^Bill:\s*/, ""), usd: Math.abs(Number(r.net_usd)), date: day(r.created_at) })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1));
    setData({ items, paid, rate, loaded: true });
  }, [familyId, memberId]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { reload().catch((e) => console.error("Bills failed:", e)); }, 200);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, triggers[0], triggers[1], triggers[2]]);

  return { ...data, reload };
}

// What matters on the Home card and the top of the Bills page.
export function summarize(items, paid) {
  const sum = (list) => list.reduce((a, b) => a + (b.usd || 0), 0);
  const late = items.filter((b) => b.days < 0);
  const week = items.filter((b) => b.days >= 0 && b.days <= 7);
  const end = monthEndKey();
  const monthLeft = items.filter((b) => b.due <= end);
  const paidTotal = paid.reduce((a, b) => a + b.usd, 0);
  return {
    lateCount: late.length, lateUsd: sum(late), weekUsd: sum(week),
    monthLeftUsd: sum(monthLeft), paidUsd: paidTotal, monthTotalUsd: sum(monthLeft) + paidTotal,
  };
}

// ---------------------------------------------------------------- actions --

export async function createBill({ scope, familyId, memberId, name, amount, currency, recurrence, due, categoryId, taggedMemberId }) {
  if (scope === "family") {
    return createCommonBill({ familyId, name, amount, currency, recurrence, nextDue: due, categoryId, taggedMemberId });
  }
  let toBase = 1;
  if (currency === "LBP") {
    const r = await latestLbpRate(familyId);
    if (!r) throw new Error("Set the LBP exchange rate first.");
    toBase = 1 / Number(r);
  }
  const { error } = await supabase.from("planned_payments").insert({
    family_id: familyId, created_by_member_id: memberId, name: name.trim(), amount, currency,
    exchange_rate_to_base: toBase, category_id: categoryId || null, recurrence, next_due_date: due,
  });
  if (error) throw new Error(error.message);
}

export async function deleteBill(item) {
  if (item.scope === "family") return deleteCommonBill(item.id);
  const { error } = await supabase.from("planned_payments").delete().eq("id", item.id);
  if (error) throw new Error(error.message);
}

// Family bill: recorded as a family cost from the pool or a card (admins). Personal bill: a normal
// expense from the member's own wallet, then the due date moves on (or the bill ends if one-time).
export async function payBill(item, { amount, accountId = null, lbpPerUsd = null, memberId }) {
  if (item.scope === "family") {
    return payCommonBill({ billId: item.id, amount, accountId, lbpPerUsd: item.currency === "LBP" ? lbpPerUsd : null });
  }
  if (item.currency === "LBP" && !lbpPerUsd) throw new Error("Enter the exchange rate (LBP per $1).");
  await createExpense({
    memberId, categoryId: item.categoryId, note: `Bill: ${item.name}`,
    legs: [{ currency: item.currency, amount: -amount }],
    lbpPerUsd: item.currency === "LBP" ? lbpPerUsd : null,
    originalAmount: amount, originalCurrency: item.currency,
  });
  const patch = item.recurrence === "one_time" ? { is_active: false } : { next_due_date: nextDueKey(item.due, item.recurrence) };
  const { error } = await supabase.from("planned_payments").update(patch).eq("id", item.id);
  if (error) throw new Error(`Paid, but the bill could not be moved on: ${error.message}`);
}
