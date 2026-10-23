import { supabase } from "../supabaseClient";
import { formatMoney, formatDateTime } from "./format";

// Data layer for the two-wallet ledger (migrations 0001-0004).
// All money changes go through SQL functions (supabase.rpc); the browser
// never writes to the money tables directly.

export const LBP = "LBP";
export const USD = "USD";

// Turn raw database errors into something a family member can act on.
export function friendlyError(err) {
  const msg = (err && err.message) || String(err || "Something went wrong");
  if (/not enough balance|negative|nonneg/i.test(msg))
    return "Not enough money in that wallet.";
  if (/rate/i.test(msg) && /(range|band|within|outside)/i.test(msg))
    return "That exchange rate is too far from the family's current rate.";
  if (/permission denied|not allowed|admin/i.test(msg))
    return "You are not allowed to do that.";
  return msg;
}

async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const e = new Error(friendlyError(error));
    e.raw = error;
    throw e;
  }
  return data;
}

// ---------- loaders ----------

export async function loadAccounts(familyId) {
  const { data, error } = await supabase
    .from("wallet_accounts")
    .select("*")
    .eq("family_id", familyId);
  if (error) throw error;
  return data || [];
}

// Group accounts: { pool:{USD,LBP}, members:{[memberId]:{USD,LBP}}, cards:{[cardId]:account}, pockets:{[pocketId]:account} }
// Each value is the account row (id, balance_cache, currency).
export function groupAccounts(accounts) {
  const out = { pool: {}, members: {}, cards: {}, pockets: {} };
  for (const a of accounts) {
    if (a.owner_kind === "pool") out.pool[a.currency] = a;
    else if (a.owner_kind === "member") {
      (out.members[a.member_id] ||= {})[a.currency] = a;
    } else if (a.owner_kind === "card") {
      out.cards[a.card_id] = a; // one account per card, single currency
    } else if (a.owner_kind === "pocket") {
      out.pockets[a.pocket_id] = a; // one account per pocket, single currency (what you can see: yours, or all for admins)
    }
  }
  return out;
}

// Kept for older imports; see lib/format.js for the rules.
export const fmtMoney = formatMoney;
export const fmtWhen = formatDateTime;

export function bal(acct) {
  return acct ? Number(acct.balance_cache || 0) : 0;
}

// Value of a pair of wallets in USD at a given LBP-per-USD rate.
export function totalUsd(pair, lbpPerUsd) {
  if (!pair) return 0;
  const usd = bal(pair.USD);
  const lbp = bal(pair.LBP);
  return usd + (lbpPerUsd > 0 ? lbp / lbpPerUsd : 0);
}

// The LBP-per-USD rate to suggest in forms: the rate most recently USED by the family
// (expenses, exchanges, common expenses), which is also the rate the database compares
// non-admin entries against, so the suggestion is always accepted. Falls back to the
// admin's rate override when nothing has been recorded in LBP yet.
export async function latestLbpRate(familyId) {
  const newest = (table) =>
    supabase
      .from(table)
      .select("lbp_per_usd, created_at")
      .eq("family_id", familyId)
      .not("lbp_per_usd", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  const results = await Promise.all([newest("transactions"), newest("exchanges"), newest("common_expenses")]);
  const used = results
    .map((r) => r.data)
    .filter(Boolean)
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))[0];
  if (used) return Number(used.lbp_per_usd);

  const { data } = await supabase
    .from("exchange_rate_overrides")
    .select("rate")
    .eq("family_id", familyId)
    .eq("currency_pair", "USD_LBP")
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? Number(data.rate) : null;
}

// ---------- expenses ----------
// legs: [{currency:'USD', amount:-10}, {currency:'LBP', amount:-900000}, {currency:'USD', amount:5}, ...]
// negative = paid, positive = change received.

export function buildLegs({ paidUsd = 0, paidLbp = 0, changeUsd = 0, changeLbp = 0 }) {
  const legs = [];
  if (paidUsd > 0) legs.push({ currency: USD, amount: -round(paidUsd) });
  if (paidLbp > 0) legs.push({ currency: LBP, amount: -round(paidLbp) });
  if (changeUsd > 0) legs.push({ currency: USD, amount: round(changeUsd) });
  if (changeLbp > 0) legs.push({ currency: LBP, amount: round(changeLbp) });
  return legs;
}

function round(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

// Net spend in USD for a set of legs (mirrors the SQL rule).
export function netUsd(legs, lbpPerUsd) {
  let usd = 0;
  let lbp = 0;
  for (const l of legs) {
    if (l.currency === USD) usd += l.amount;
    else lbp += l.amount;
  }
  const rate = lbp !== 0 ? lbpPerUsd : 1;
  return round(-usd - (lbp !== 0 ? lbp / rate : 0));
}

export const createExpense = (a) =>
  call("create_expense", {
    p_member_id: a.memberId,
    p_category_id: a.categoryId || null,
    p_note: a.note || null,
    p_legs: a.legs,
    p_lbp_per_usd: a.lbpPerUsd ?? null,
    p_created_at: a.createdAt || null,
    p_original_amount: a.originalAmount ?? null,
    p_original_currency: a.originalCurrency ?? null,
  });

export const updateExpense = (a) =>
  call("update_expense", {
    p_id: a.id,
    p_category_id: a.categoryId || null,
    p_note: a.note || null,
    p_legs: a.legs,
    p_lbp_per_usd: a.lbpPerUsd ?? null,
    p_created_at: a.createdAt || null,
    p_original_amount: a.originalAmount ?? null,
    p_original_currency: a.originalCurrency ?? null,
  });

export const deleteExpense = (id) => call("delete_expense", { p_id: id });

// ---------- deposits (admin) ----------
export const createDeposit = ({ accountId, amount, lbpPerUsd, createdAt }) =>
  call("create_deposit", {
    p_account_id: accountId,
    p_amount: amount,
    p_lbp_per_usd: lbpPerUsd ?? null,
    p_created_at: createdAt || null,
  });
export const deleteDeposit = (id) => call("delete_deposit", { p_id: id });

// Money from outside the family (migration 0014): salary, bonus, gift, other, or a reimbursement
// (linked to a category, it lowers that category's spending instead of counting as income).
export const INCOME_TYPES = [
  { key: "salary", label: "Salary", note: "Counts as money in. It does not change your spending limit." },
  { key: "bonus", label: "Bonus", note: "Counts as money in. It does not change your spending limit." },
  { key: "gift", label: "Gift", note: "Counts as money in. It does not change your spending limit." },
  { key: "reimbursement", label: "Reimbursement", note: "Not income: it lowers what you spent in the category you pick." },
  { key: "other", label: "Other", note: "Counts as money in. It does not change your spending limit." },
];
export const createIncome = ({ accountId, amount, kind, lbpPerUsd = null, categoryId = null, note = null, createdAt = null }) =>
  call("create_income", {
    p_account_id: accountId, p_amount: amount, p_kind: kind, p_lbp_per_usd: lbpPerUsd,
    p_category_id: categoryId, p_note: note || null, p_created_at: createdAt,
  });
export const deleteIncome = (id) => call("delete_income", { p_id: id });

// ---------- transfers / exchange ----------
export const createTransfer = ({ from, to, amount, note, createdAt, taggedMemberId }) =>
  call("create_transfer", {
    p_from: from,
    p_to: to,
    p_amount: amount,
    p_note: note || null,
    p_created_at: createdAt || null,
    p_tagged_member_id: taggedMemberId || null,
  });
export const deleteTransfer = (id) => call("delete_transfer", { p_id: id });

export const createExchange = ({ from, to, amountFrom, amountTo, createdAt }) =>
  call("create_exchange", {
    p_from: from,
    p_to: to,
    p_amount_from: amountFrom,
    p_amount_to: amountTo,
    p_created_at: createdAt || null,
  });
export const deleteExchange = (id) => call("delete_exchange", { p_id: id });

// ---------- cards ----------
export const createCard = ({ familyId, name, currency }) =>
  call("create_card", { p_family_id: familyId, p_name: name, p_currency: currency });

export const createCardSpend = ({ cardId, amount, note, lbpPerUsd, createdAt, taggedMemberId, categoryId }) =>
  call("create_card_spend", {
    p_card_id: cardId,
    p_amount: amount,
    p_note: note || null,
    p_lbp_per_usd: lbpPerUsd ?? null,
    p_created_at: createdAt || null,
    p_tagged_member_id: taggedMemberId || null,
    p_category_id: categoryId || null,
  });
export const deleteCardSpend = (id) => call("delete_card_spend", { p_id: id });
export const updateCardSpend = ({ id, amount, note, lbpPerUsd, createdAt, taggedMemberId, categoryId }) =>
  call("update_card_spend", {
    p_id: id,
    p_amount: amount,
    p_note: note || null,
    p_lbp_per_usd: lbpPerUsd ?? null,
    p_created_at: createdAt || null,
    p_tagged_member_id: taggedMemberId || null,
    p_category_id: categoryId || null,
  });

// ---------- limits / periods ----------
export const periodStart = (period) => call("period_start", { p_period: period });

export const periodSpend = ({ familyId, memberId = null, categoryId = null, from, to = null }) =>
  call("period_spend", {
    p_family_id: familyId,
    p_member_id: memberId,
    p_category_id: categoryId,
    p_from: from,
    p_to: to,
  });

// Spend vs limit for one member, in USD (Monday weeks, Beirut months).
export async function getMemberSpend(familyId, member) {
  if (!member?.spending_limit_amount || !member?.spending_limit_period) return null;
  const from = await periodStart(member.spending_limit_period);
  const spent = Number((await periodSpend({ familyId, memberId: member.id, from })) || 0);
  const limit = Number(member.spending_limit_amount);
  const pct = limit > 0 ? spent / limit : 0;
  return {
    spent,
    limit,
    period: member.spending_limit_period,
    percentUsed: pct,
    isNearLimit: pct >= 0.8 && pct < 1,
    isOverLimit: pct >= 1,
  };
}

// ---------- family / members ----------
export const createFamily = ({ name, displayName }) =>
  call("create_family", { p_name: name, p_display_name: displayName });
export const createInvite = (familyId) => call("create_invite", { p_family_id: familyId });
export const joinFamily = ({ code, displayName }) =>
  call("join_family", { p_code: code, p_display_name: displayName });
export const setMemberLimit = ({ memberId, amount, period }) =>
  call("set_member_limit", { p_member_id: memberId, p_amount: amount, p_period: period });
export const setRole = ({ memberId, role }) =>
  call("set_role", { p_member_id: memberId, p_role: role });
export const removeMember = (memberId) => call("remove_member", { p_member_id: memberId });


// ---------- common (family) expenses: paid from the pool, admins only ----------
export const createCommonExpense = (a) =>
  call("create_common_expense", {
    p_family_id: a.familyId,
    p_title: a.title,
    p_amount: a.amount,
    p_currency: a.currency,
    p_category_id: a.categoryId || null,
    p_lbp_per_usd: a.lbpPerUsd ?? null,
    p_note: a.note || null,
    p_tagged_member_id: a.taggedMemberId || null,
    p_created_at: a.createdAt || null,
    p_account_id: a.accountId || null,
  });
export const deleteCommonExpense = (id) => call("delete_common_expense", { p_id: id });
export const updateCommonExpense = (a) =>
  call("update_common_expense", {
    p_id: a.id,
    p_title: a.title,
    p_amount: a.amount,
    p_currency: a.currency,
    p_category_id: a.categoryId || null,
    p_lbp_per_usd: a.lbpPerUsd ?? null,
    p_note: a.note || null,
    p_tagged_member_id: a.taggedMemberId || null,
    p_created_at: a.createdAt || null,
    p_account_id: a.accountId || null,
  });

export const createCommonBill = (a) =>
  call("create_common_bill", {
    p_family_id: a.familyId,
    p_name: a.name,
    p_amount: a.amount,
    p_currency: a.currency,
    p_recurrence: a.recurrence,
    p_next_due: a.nextDue,
    p_category_id: a.categoryId || null,
    p_tagged_member_id: a.taggedMemberId || null,
  });
export const deleteCommonBill = (id) => call("delete_common_bill", { p_id: id });
export const payCommonBill = ({ billId, amount, lbpPerUsd, createdAt, accountId }) =>
  call("pay_common_bill", {
    p_bill_id: billId,
    p_amount: amount ?? null,
    p_lbp_per_usd: lbpPerUsd ?? null,
    p_created_at: createdAt || null,
    p_account_id: accountId || null,
  });

// Spending totals computed by the database (day, category, person). Dates are ISO strings or null for "all time".
export async function spendRollup({ familyId, from = null, to = null, memberId = null }) {
  const { data, error } = await supabase.rpc("spend_rollup", {
    p_family_id: familyId, p_from: from, p_to: to, p_member_id: memberId,
  });
  if (error) throw new Error(error.message);
  return data;
}

// ---------- pockets (migration 0013) ----------

export async function loadPockets(memberId) {
  const { data, error } = await supabase
    .from("pockets")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export const createPocket = ({ familyId, name, currency, color = null, startAmount = null }) =>
  call("create_pocket", { p_family_id: familyId, p_name: name, p_currency: currency, p_color: color, p_start_amount: startAmount });
export const renamePocket = ({ id, name, color = null }) =>
  call("rename_pocket", { p_id: id, p_name: name, p_color: color });
export const setPocketArchived = ({ id, archived }) =>
  call("set_pocket_archived", { p_id: id, p_archived: archived });
