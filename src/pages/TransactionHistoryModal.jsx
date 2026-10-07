import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import TransactionRow from "./TransactionRow";

const PAGE_SIZE = 20;

// Paginated popup of transaction history. Scoped to a single member when
// `memberId` is passed (used from the Dashboard's "Last Records"); shows
// the whole family's transactions, tagged by member, when it's omitted
// (used from the Family page's "Records"). Self-contained pagination,
// independent of Dashboard.jsx's own page-0 `transactions` state.
//
// Filters (category, member, date range, note search) are all applied
// server-side via the Supabase query so pagination stays correct against
// the filtered set, not just whatever page happened to already be loaded.
export default function TransactionHistoryModal({
  familyId,
  memberId,
  viewerId,
  categories,
  members,
  amAdmin,
  onClose,
}) {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [showFilters, setShowFilters] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [filterMemberId, setFilterMemberId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const filtersActive =
    categoryId || filterMemberId || dateFrom || dateTo || search.trim();
  const effectiveViewerId = viewerId ?? memberId;

  function buildTransactionQuery(from, to) {
    let query = supabase
      .from("transactions")
      .select("*")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (memberId) query = query.eq("member_id", memberId);
    if (categoryId) query = query.eq("category_id", categoryId);
    if (!memberId && filterMemberId)
      query = query.eq("member_id", filterMemberId);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);
    if (search.trim()) query = query.ilike("note", `%${search.trim()}%`);

    return query;
  }

  function buildCardQuery(from, to) {
    let query = supabase
      .from("card_transactions")
      .select("*")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (memberId) query = query.eq("member_id", memberId);
    if (!memberId && filterMemberId)
      query = query.eq("member_id", filterMemberId);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);
    if (search.trim()) query = query.ilike("note", `%${search.trim()}%`);

    return query;
  }

  async function load(reset = true) {
    const nextPage = reset ? 0 : page + 1;
    const from = nextPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    if (reset) setLoading(true);
    else setLoadingMore(true);

    const [{ data: normalRows }, { data: cardRows }] = await Promise.all([
      buildTransactionQuery(from, to),
      buildCardQuery(from, to),
    ]);

    const normal = (normalRows || []).map((t) => ({
      ...t,
      kind: "transaction",
    }));
    const cards = (cardRows || []).map((t) => ({ ...t, kind: "card" }));
    const chunk = [...normal, ...cards].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    setRows((prev) => (reset ? chunk : [...prev, ...chunk]));
    setHasMore(chunk.length === PAGE_SIZE);
    setPage(nextPage);
    setLoading(false);
    setLoadingMore(false);
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, categoryId, filterMemberId, dateFrom, dateTo, search]);

  function handleChanged() {
    load(true);
  }

  function clearFilters() {
    setCategoryId("");
    setFilterMemberId("");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>{memberId ? "My transactions" : "Family transactions"}</h2>
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
          <button
            type="button"
            className="link-button filter-toggle"
            onClick={() => setShowFilters((v) => !v)}
          >
            {showFilters ? "Hide filters" : "Filters"}
            {filtersActive && !showFilters ? " •" : ""}
          </button>

          {showFilters && (
            <div className="filter-bar">
              <input
                type="text"
                placeholder="Search notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {!memberId && members && members.length > 0 && (
                <select
                  value={filterMemberId}
                  onChange={(e) => setFilterMemberId(e.target.value)}
                >
                  <option value="">All members</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              )}
              <div className="filter-date-row">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="From date"
                />
                <span className="filter-date-sep">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="To date"
                />
              </div>
              {filtersActive && (
                <button
                  type="button"
                  className="link-button"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {loading && <p className="hint">Loading...</p>}
          {!loading && rows.length === 0 && (
            <p className="hint">
              {filtersActive
                ? "No transactions match these filters."
                : "No transactions yet."}
            </p>
          )}
          <ul className="txn-list">
            {rows.map((t) => (
              <TransactionRow
                key={t.id}
                t={t}
                categories={categories}
                members={members}
                canManage={amAdmin || t.member_id === effectiveViewerId}
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
              {loadingMore ? "Loading..." : "Load 20 more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
