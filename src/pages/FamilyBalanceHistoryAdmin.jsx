import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { deleteDeposit, fmtMoney, fmtWhen } from "../lib/wallets";

const PAGE_SIZE = 20;

// Deposits (admin can delete) plus any old direct balance corrections
// (read-only: the ledger no longer allows editing the balance directly).
export default function FamilyBalanceHistoryAdmin({ familyId, onChanged }) {
  const [rows, setRows] = useState([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load(n) {
    setLoading(true);
    const [{ data: deposits }, { data: adjustments }] = await Promise.all([
      supabase.from("deposits").select("*, members:added_by_member_id(display_name)").eq("family_id", familyId).order("created_at", { ascending: false }).limit(n),
      supabase.from("wallet_balance_adjustments").select("*, members:set_by_member_id(display_name)").eq("family_id", familyId).order("created_at", { ascending: false }).limit(n),
    ]);
    const merged = [
      ...(deposits || []).map((d) => ({ ...d, kind: "deposit" })),
      ...(adjustments || []).map((a) => ({ ...a, kind: "adjustment" })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    setRows(merged.slice(0, n));
    setHasMore((deposits || []).length === n || (adjustments || []).length === n);
    setLoading(false);
  }

  useEffect(() => {
    load(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  async function remove(row) {
    if (!confirm("Delete this deposit? The family pool will be recalculated.")) return;
    try {
      await deleteDeposit(row.id);
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
      {!loading && rows.length === 0 && <p className="hint">No deposits yet.</p>}
      <ul className="txn-list">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.id}`}>
            <div>
              <span className="txn-amount">
                {Number(r.amount) > 0 ? "+" : ""}
                {fmtMoney(r.amount, r.currency || "USD")}
              </span>
              <span className="txn-meta">
                {r.kind === "deposit" ? "Deposit" : "Old balance correction"} · {r.members?.display_name} · {fmtWhen(r.created_at)}
                {r.note && ` · ${r.note}`}
              </span>
            </div>
            {r.kind === "deposit" && (
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
    </div>
  );
}
