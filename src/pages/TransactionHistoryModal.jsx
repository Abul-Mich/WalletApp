import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import TransactionRow from "./TransactionRow";

const PAGE_SIZE = 20;

// Paginated popup of transaction history. Scoped to a single member when
// `memberId` is passed (used from the Dashboard's "Last Records"); shows
// the whole family's transactions, tagged by member, when it's omitted
// (used from the Family page's "Records"). Self-contained pagination,
// independent of Dashboard.jsx's own page-0 `transactions` state.
export default function TransactionHistoryModal({
  familyId,
  memberId,
  baseCurrency,
  categories,
  amAdmin,
  onClose,
}) {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(reset = true) {
    const nextPage = reset ? 0 : page + 1;
    const from = nextPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    if (reset) setLoading(true);
    else setLoadingMore(true);

    let query = supabase
      .from("transactions")
      .select("*, categories(name), members(display_name)")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (memberId) query = query.eq("member_id", memberId);

    const { data } = await query;

    const chunk = data || [];
    setRows((prev) => (reset ? chunk : [...prev, ...chunk]));
    setHasMore(chunk.length === PAGE_SIZE);
    setPage(nextPage);
    setLoading(false);
    setLoadingMore(false);
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  function handleChanged() {
    load(true);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>{memberId ? "My Transactions" : "Family Transactions"}</h2>
          <button
            type="button"
            className="sheet-close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="sheet-body">
          {loading && <p className="hint">Loading...</p>}
          {!loading && rows.length === 0 && (
            <p className="hint">No transactions yet.</p>
          )}
          <ul className="txn-list">
            {rows.map((t) => (
              <TransactionRow
                key={t.id}
                t={t}
                familyId={familyId}
                baseCurrency={baseCurrency}
                categories={categories}
                canManage={amAdmin || t.member_id === memberId}
                onChanged={handleChanged}
              />
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              className="load-more"
              disabled={loadingMore}
              onClick={() => load(false)}
            >
              {loadingMore ? "Loading..." : "Load 20 More"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
