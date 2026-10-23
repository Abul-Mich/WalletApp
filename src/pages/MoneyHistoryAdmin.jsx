import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmSheet";
import { supabase } from "../supabaseClient";
import { deleteTransfer, deleteExchange, deleteDeposit, fmtMoney, fmtWhen } from "../lib/wallets";

const PAGE_SIZE = 20;

// Admin view of every money movement in one list: deposits into the pool, transfers between
// the pool, members and cards, and currency exchanges (plus old direct balance corrections,
// read-only). Mistakes are fixed by deleting the entry and entering it again; the ledger never
// rewrites history.
export default function MoneyHistoryAdmin({ familyId, rawAccounts, members, cards, reloadTrigger, onChanged }) {
  const [rows, setRows] = useState([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { ask, dialog } = useConfirm();

  const acctName = (id) => {
    const a = rawAccounts.find((x) => x.id === id);
    if (!a) return "?";
    if (a.owner_kind === "pool") return `Family pool ${a.currency}`;
    if (a.owner_kind === "member")
      return `${members.find((m) => m.id === a.member_id)?.display_name ?? "Member"} ${a.currency}`;
    if (a.owner_kind === "pocket")
      return `${members.find((x) => x.id === a.member_id)?.display_name ?? "Member"}'s pocket`;
    return `${cards.find((c) => c.id === a.card_id)?.name ?? "Card"}`;
  };
  const curOf = (id) => rawAccounts.find((x) => x.id === id)?.currency;

  async function load(n) {
    setLoading(true);
    setError(null);
    const newest = (table, select) =>
      supabase.from(table).select(select).eq("family_id", familyId).order("created_at", { ascending: false }).limit(n);
    const [tr, ex, dp, adj] = await Promise.all([
      newest("transfers", "*"),
      newest("exchanges", "*"),
      newest("deposits", "*, members:added_by_member_id(display_name)"),
      newest("wallet_balance_adjustments", "*, members:set_by_member_id(display_name)"),
    ]);
    const failed = tr.error || ex.error || dp.error || adj.error;
    if (failed) {
      setError(failed.message);
      setRows([]);
    } else {
      const all = [
        ...(tr.data || []).map((r) => ({ ...r, kind: "transfer" })),
        ...(ex.data || []).map((r) => ({ ...r, kind: "exchange" })),
        ...(dp.data || []).map((r) => ({ ...r, kind: "deposit" })),
        ...(adj.data || []).map((r) => ({ ...r, kind: "adjustment" })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setRows(all.slice(0, n));
      setHasMore([tr, ex, dp, adj].some((q) => (q.data || []).length === n));
    }
    setLoading(false);
  }

  useEffect(() => {
    load(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, reloadTrigger]);

  function remove(r) {
    const what = r.kind === "deposit" ? "deposit" : r.kind === "exchange" ? "exchange" : "transfer";
    ask({
      title: `Delete this ${what}?`,
      detail: r.kind === "deposit" ? "Money added to the pool" : undefined,
      effect: "The balances are recalculated as if it never happened. This cannot be undone.",
      confirmLabel: `Delete ${what}`, cancelLabel: "Keep it", icon: "trash",
      onConfirm: async () => {
        if (r.kind === "transfer") await deleteTransfer(r.id);
        else if (r.kind === "exchange") await deleteExchange(r.id);
        else await deleteDeposit(r.id);
        setLimit(PAGE_SIZE);
        load(PAGE_SIZE);
        onChanged?.();
      },
    });
  }

  const amountOf = (r) => {
    if (r.kind === "transfer") return fmtMoney(r.amount, curOf(r.from_account_id));
    if (r.kind === "exchange") return `${fmtMoney(r.amount_from, curOf(r.from_account_id))} → ${fmtMoney(r.amount_to, curOf(r.to_account_id))}`;
    return `${Number(r.amount) > 0 ? "+" : ""}${fmtMoney(r.amount, r.currency || "USD")}`;
  };
  const metaOf = (r) => {
    if (r.kind === "transfer") return `Transfer: ${acctName(r.from_account_id)} → ${acctName(r.to_account_id)}`;
    if (r.kind === "exchange") return `Exchange: ${acctName(r.from_account_id)} → ${acctName(r.to_account_id)}`;
    return `${r.kind === "deposit" ? "Deposit into the pool" : "Old balance correction"} · ${r.members?.display_name ?? ""}`;
  };

  return (
    <div>
      {error && <p className="status error">{error}</p>}
      {loading && rows.length === 0 && <p className="hint">Loading...</p>}
      {!loading && rows.length === 0 && <p className="hint">No money movements yet.</p>}
      <ul className="txn-list">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.id}`}>
            <div>
              <span className={`txn-amount ${r.kind === "transfer" || r.kind === "exchange" ? "neutral" : Number(r.amount) > 0 ? "pos" : ""}`}>{amountOf(r)}</span>
              <span className="txn-meta">{metaOf(r)} · {fmtWhen(r.created_at)}</span>
            </div>
            {r.note && <p className="txn-note">{r.note}</p>}
            {r.kind !== "adjustment" && (
              <div className="txn-actions">
                <button type="button" className="remove-btn" onClick={() => remove(r)}>Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {hasMore && (
        <button type="button" className="load-more" disabled={loading} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          {loading ? "Loading..." : "Load 20 more"}
        </button>
      )}
      {dialog}
    </div>
  );
}
