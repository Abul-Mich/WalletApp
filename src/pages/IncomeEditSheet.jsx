import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabaseClient";
import { INCOME_TYPES, updateIncome } from "../lib/wallets";
import { formatMoney, formatRate, parseNumber } from "../lib/format";
import { MoneyInput, TextInput } from "../components/Field";
import AmountHero from "../components/AmountHero";
import { makeColorFor } from "../lib/categoryColors";
import { EditSheet, PersonChips } from "../components/RecordFields";

const num = (v) => {
  const n = parseNumber(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Edit a "money in" record: amount, kind, category (reimbursement), who it counts for (pool / card),
// exchange rate, date and note. The wallet it went into is fixed: to move it, delete it and add it again.
// record = a deposits row (amount, currency, exchange_rate_to_base, account_id, created_at, note, category_id,
// beneficiary_member_id) plus `kind` (the money-in type). categories/members are loaded if not passed.
export default function IncomeEditSheet({ record, kind: kindProp, categories: catsProp, members: memsProp, amAdmin, onClose, onSaved }) {
  const [categories, setCategories] = useState(catsProp || []);
  const [members, setMembers] = useState(memsProp || []);
  const [ownerKind, setOwnerKind] = useState(null); // member | pocket | pool | card
  const [kind, setKind] = useState(kindProp || record.kind);
  const cur = record.currency || "USD";
  const oldRate = cur === "LBP" && Number(record.exchange_rate_to_base) > 0 ? Math.round(1 / Number(record.exchange_rate_to_base)) : null;
  const [amount, setAmount] = useState(String(Number(record.amount)));
  const [categoryId, setCategoryId] = useState(record.category_id || "");
  const [forWho, setForWho] = useState(record.beneficiary_member_id || "");
  const [rate, setRate] = useState(oldRate ? String(oldRate) : "");
  const [note, setNote] = useState(record.note || "");
  const [when, setWhen] = useState(toLocalInput(record.created_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    supabase.from("wallet_accounts").select("owner_kind").eq("id", record.account_id).maybeSingle()
      .then(({ data }) => live && setOwnerKind(data?.owner_kind || null));
    if (!catsProp) supabase.from("categories").select("*").eq("family_id", record.family_id).order("name")
      .then(({ data }) => live && setCategories(data || []));
    if (!memsProp) supabase.from("members").select("id, display_name, removed_at").eq("family_id", record.family_id)
      .then(({ data }) => live && setMembers(data || []));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colorFor = useMemo(() => makeColorFor(categories), [categories]);
  const shared = ownerKind === "pool" || ownerKind === "card";
  const isReimb = kind === "reimbursement";
  const amt = num(amount);
  const rateNum = num(rate);
  const type = INCOME_TYPES.find((t) => t.key === kind);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!(amt > 0)) return setError("Enter an amount.");
    if (isReimb && !categoryId) return setError("Pick the category this reimbursement is for.");
    if (cur === "LBP" && !rateNum) return setError("Enter the exchange rate (LBP per $1).");
    const changedDate = when !== toLocalInput(record.created_at);
    if (changedDate && new Date(when) > new Date()) return setError("The date cannot be in the future.");
    setBusy(true);
    try {
      await updateIncome({
        id: record.id, amount: amt, kind, lbpPerUsd: cur === "LBP" ? rateNum : null,
        categoryId: isReimb ? categoryId : null, beneficiaryId: shared ? forWho : null,
        note: note.trim().slice(0, 200) || null, createdAt: changedDate ? new Date(when).toISOString() : null,
      });
      onSaved?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // Rendered on <body> so no parent list item can clip or offset the full-screen sheet.
  return createPortal(
    <EditSheet title="Edit money in" onClose={busy ? undefined : onClose}>
      <form onSubmit={submit} className="spend-form inc-form inc-edit">
        <div className="sf-scroll">
          <div className="inc-hero">
            <AmountHero value={amount} onChange={setAmount} currency={cur} autoFocus={false} fixedNote={`${cur} only`} />
          </div>

          <div className="sf-block">
            <span className="sf-label">What kind of money</span>
            <div className="sf-chips">
              {INCOME_TYPES.map((t) => (
                <button key={t.key} type="button" className={`sf-chip ${kind === t.key ? "on" : ""}`} aria-pressed={kind === t.key} onClick={() => setKind(t.key)}>{t.label}</button>
              ))}
            </div>
            {type && <p className="sf-limit-note inc-note">{type.note}</p>}
          </div>

          {isReimb && (
            <div className="sf-block">
              <span className="sf-label">Which category was it for</span>
              <div className="sf-chips">
                {categories.map((c) => (
                  <button key={c.id} type="button" className={`sf-chip ${categoryId === c.id ? "on" : ""}`} aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                    <i className="sf-dot" style={{ background: colorFor(c.name) }} />{c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {shared && amAdmin && (
            <PersonChips
              label="Counts for" hint="(optional)" value={forWho} onChange={setForWho}
              options={[{ value: "", label: "Whole family" }, ...members.filter((m) => !m.removed_at).map((m) => ({ value: m.id, label: m.display_name }))]}
            />
          )}

          {cur === "LBP" && (
            <MoneyInput label="Exchange rate (LBP per $1)" value={rate} onChange={setRate} placeholder="89,500" required
              help={rateNum ? formatRate(rateNum) : "How many LBP equal $1"} />
          )}

          <div className="sf-two">
            <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} max={toLocalInput(new Date().toISOString())} />
            <TextInput label="Note" value={note} onChange={setNote} placeholder="Optional" />
          </div>

          <p className="sf-muted sf-small">The wallet can't be changed. To move this money, delete the record and add it again.</p>

          {error && <p className="status error" role="alert">{error}</p>}
        </div>
        <div className="sf-footer">
          <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !(amt > 0)}>
            {busy ? "Saving..." : `Save${amt > 0 ? ` · ${formatMoney(amt, cur)}` : ""}`}
          </button>
        </div>
      </form>
    </EditSheet>,
    document.body
  );
}
