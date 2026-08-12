import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const PAGE_SIZE = 20;

// There was previously no UI at all for member_balance_transfers (top-ups /
// returns between a member and the shared family balance) — only insert-only
// forms. This gives admins a place to see and correct them, backed by the
// admin-only update/delete RLS policies on that table.
export default function BalanceTransfersAdmin({
  familyId,
  baseCurrency,
  onChanged,
  reloadTrigger,
}) {
  const [rows, setRows] = useState([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [error, setError] = useState(null);

  async function load(nextLimit) {
    setLoading(true);
    setError(null);

    const [
      { data: transfers, error: transfersError },
      { data: members, error: membersError },
    ] = await Promise.all([
      supabase
        .from("member_balance_transfers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(nextLimit),
      supabase
        .from("members")
        .select("id, display_name")
        .eq("family_id", familyId),
    ]);

    if (transfersError || membersError) {
      setError((transfersError || membersError).message);
      setRows([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    const memberNames = (members || []).reduce((map, member) => {
      map[member.id] = member.display_name;
      return map;
    }, {});

    const rowsWithNames = (transfers || []).map((t) => ({
      ...t,
      member_display_name: memberNames[t.member_id] || "Unknown",
    }));

    setRows(rowsWithNames);
    setHasMore((transfers || []).length === nextLimit);
    setLoading(false);
  }

  useEffect(() => {
    load(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, reloadTrigger]);

  function refresh() {
    setLimit(PAGE_SIZE);
    load(PAGE_SIZE);
    onChanged?.();
  }

  async function saveEdit(row) {
    setError(null);
    const parsed = parseFloat(editAmount);
    if (Number.isNaN(parsed) || parsed === 0) {
      setError("Enter a non-zero amount.");
      return;
    }
    // Preserve the original sign (top-up vs return) unless the admin typed
    // a different sign explicitly.
    const { error: err } = await supabase
      .from("member_balance_transfers")
      .update({ amount: parsed })
      .eq("id", row.id);
    if (err) {
      setError(err.message);
      return;
    }
    setEditingId(null);
    refresh();
  }

  async function remove(row) {
    if (
      !confirm("Delete this entry? The member's balance will be recalculated.")
    )
      return;
    const { error: err } = await supabase
      .from("member_balance_transfers")
      .delete()
      .eq("id", row.id);
    if (err) {
      setError(err.message);
      return;
    }
    refresh();
  }

  return (
    <div>
      {error && <p className="status error">{error}</p>}
      {loading && rows.length === 0 && <p className="hint">Loading...</p>}
      {!loading && rows.length === 0 && (
        <p className="hint">No balance transfers yet.</p>
      )}

      <ul className="txn-list">
        {rows.map((r) => (
          <li key={r.id}>
            {editingId === r.id ? (
              <div className="inline-form">
                <input
                  type="number"
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
                <button type="button" onClick={() => saveEdit(r)}>
                  Save
                </button>
                <button
                  type="button"
                  className="remove-btn"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div>
                  <span className="txn-amount">
                    {Number(r.amount) > 0 ? "+" : ""}
                    {Number(r.amount).toFixed(2)} {r.currency}
                    {r.currency !== baseCurrency && (
                      <span className="txn-converted">
                        {" "}
                        (≈{(r.amount * r.exchange_rate_to_base).toFixed(2)}{" "}
                        {baseCurrency})
                      </span>
                    )}
                  </span>
                  <span className="txn-meta">
                    {Number(r.amount) > 0
                      ? "Withdraw from Main"
                      : "Return to Main"}{" "}
                    · {r.member_display_name}
                  </span>
                </div>
                <div className="txn-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(r.id);
                      setEditAmount(String(r.amount));
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="remove-btn"
                    onClick={() => remove(r)}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      {hasMore && (
        <button
          type="button"
          className="load-more"
          disabled={loading}
          onClick={() => setLimit((l) => l + PAGE_SIZE)}
        >
          {loading ? "Loading..." : "Load 20 More"}
        </button>
      )}
    </div>
  );
}
