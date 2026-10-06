import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { deleteTransfer, deleteExchange, fmtMoney, fmtWhen } from "../lib/wallets";

const PAGE_SIZE = 20;

// Admin view of every money movement: transfers between the pool, members
// and cards, plus currency exchanges. Mistakes are fixed by deleting the
// entry and entering it again (the ledger never rewrites history).
export default function BalanceTransfersAdmin({ familyId, rawAccounts, members, cards, reloadTrigger, onChanged }) {
  const [rows, setRows] = useState([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const acctName = (id) => {
    const a = rawAccounts.find((x) => x.id === id);
    if (!a) return "?";
    if (a.owner_kind === "pool") return `Family pool ${a.currency}`;
    if (a.owner_kind === "member")
      return `${members.find((m) => m.id === a.member_id)?.display_name ?? "Member"} ${a.currency}`;
    return `${cards.find((c) => c.id === a.card_id)?.name ?? "Card"}`;
  };
  const curOf = (id) => rawAccounts.find((x) => x.id === id)?.currency;

  async function load(n) {
    setLoading(true);
    setError(null);
    const [{ data: tr, error: e1 }, { data: ex, error: e2 }] = await Promise.all([
      supabase.from("transfers").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(n),
      supabase.from("exchanges").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(n),
    ]);
    if (e1 || e2) {
      setError((e1 || e2).message);
      setRows([]);
    } else {
      const all = [
        ...(tr || []).map((r) => ({ ...r, kind: "transfer" })),
        ...(ex || []).map((r) => ({ ...r, kind: "exchange" })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setRows(all.slice(0, n));
      setHasMore((tr || []).length === n || (ex || []).length === n);
    }
    setLoading(false);
  }

  useEffect(() => {
    load(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, reloadTrigger]);

  async function remove(r) {
    if (!confirm("Delete this entry? Balances will be recalculated.")) return;
    try {
      if (r.kind === "transfer") await deleteTransfer(r.id);
      else await deleteExchange(r.id);
      setLimit(PAGE_SIZE);
      load(PAGE_SIZE);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <p className="status error">{error}</p>}
      {loading && rows.length === 0 && <p className="hint">Loading...</p>}
      {!loading && rows.length === 0 && <p className="hint">No money movements yet.</p>}
      <ul className="txn-list">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.id}`}>
            <div>
              <span className="txn-amount">
                {r.kind === "transfer"
                  ? fmtMoney(r.amount, curOf(r.from_account_id))
                  : `${fmtMoney(r.amount_from, curOf(r.from_account_id))} → ${fmtMoney(r.amount_to, curOf(r.to_account_id))}`}
              </span>
              <span className="txn-meta">
                {r.kind === "transfer" ? "Transfer" : "Exchange"}: {acctName(r.from_account_id)} → {acctName(r.to_account_id)} · {fmtWhen(r.created_at)}
              </span>
            </div>
            {r.note && <p className="txn-note">{r.note}</p>}
            <div className="txn-actions">
              <button type="button" className="remove-btn" onClick={() => remove(r)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button type="button" className="load-more" disabled={loading} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          {loading ? "Loading..." : "Load 20 More"}
        </button>
      )}
    </div>
  );
}
