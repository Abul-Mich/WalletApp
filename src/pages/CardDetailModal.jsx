import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { deleteTransfer, deleteCardSpend, deleteCommonExpense, fmtMoney, fmtWhen } from "../lib/wallets";
import CardTopUpForm from "./CardTopUpForm";
import CardWithdrawForm from "./CardWithdrawForm";

const PAGE_SIZE = 20;

export default function CardDetailModal({
  familyId, memberId, card, cardAccount, poolAccounts, memberAccounts, members, categories, amAdmin, amSuperadmin, onClose, onChanged,
}) {
  const [tab, setTab] = useState(card.archived ? "history" : "topup");
  const [history, setHistory] = useState([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(card.name);
  const [savingCard, setSavingCard] = useState(false);
  const [cardError, setCardError] = useState(null);
  const cur = cardAccount.currency;

  async function loadHistory(nextLimit) {
    setLoading(true);
    const [{ data: transfers }, { data: spends }, { data: commons }] = await Promise.all([
      supabase.from("transfers").select("*")
        .or(`to_account_id.eq.${cardAccount.id},from_account_id.eq.${cardAccount.id}`)
        .order("created_at", { ascending: false }).limit(nextLimit),
      supabase.from("card_transactions").select("*").eq("card_id", card.id)
        .order("created_at", { ascending: false }).limit(nextLimit),
      supabase.from("common_expenses").select("*").eq("account_id", cardAccount.id)
        .order("created_at", { ascending: false }).limit(nextLimit),
    ]);
    const combined = [
      ...(transfers || []).map((r) => ({
        ...r, kind: "topup", member_id: r.created_by,
        sign: r.to_account_id === cardAccount.id ? 1 : -1,
      })),
      ...(spends || []).map((r) => ({ ...r, kind: "spend", sign: -1 })),
      ...(commons || []).map((r) => ({ ...r, kind: "common", member_id: r.created_by, sign: -1 })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    setHistory(combined.slice(0, nextLimit));
    setHasMore((transfers?.length ?? 0) === nextLimit || (spends?.length ?? 0) === nextLimit || (commons?.length ?? 0) === nextLimit);
    setLoading(false);
  }

  useEffect(() => {
    loadHistory(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, limit]);

  // Where a top-up came from: "Family pool" or "<name>'s wallet".
  function sourceLabel(r) {
    if (r.kind !== "topup" || r.sign < 0) return "";
    if (Object.values(poolAccounts || {}).some((a) => a.id === r.from_account_id)) return " · from Family pool";
    for (const [mid, pair] of Object.entries(memberAccounts || {})) {
      if (Object.values(pair).some((a) => a.id === r.from_account_id)) {
        const n = members?.find((m) => m.id === mid)?.display_name;
        return n ? ` · from ${n}'s wallet` : " · from a member wallet";
      }
    }
    return "";
  }

  function handleDone() {
    onChanged?.();
    setLimit(PAGE_SIZE);
    loadHistory(PAGE_SIZE);
  }

  // Edits are delete + re-enter: the ledger never rewrites a money movement.
  function canDelete(r) {
    if (r.kind === "topup" || r.kind === "common") return amAdmin;
    return r.member_id === memberId || amSuperadmin;
  }

  async function removeEntry(r) {
    if (!confirm("Delete this entry? The card balance will be recalculated.")) return;
    try {
      if (r.kind === "topup") await deleteTransfer(r.id);
      else if (r.kind === "common") await deleteCommonExpense(r.id);
      else await deleteCardSpend(r.id);
      handleDone();
    } catch (err) {
      alert(err.message);
    }
  }

  async function saveRename() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === card.name) return setRenaming(false);
    setSavingCard(true);
    setCardError(null);
    try {
      const { error } = await supabase.from("cards").update({ name: trimmed }).eq("id", card.id);
      if (error) throw error;
      setRenaming(false);
      onChanged?.();
    } catch (err) {
      setCardError(err.message);
    } finally {
      setSavingCard(false);
    }
  }

  async function toggleArchived() {
    const next = !card.archived;
    if (next && !confirm(`Archive "${card.name}"? No more top-ups or spending will be allowed, but its balance and history stay visible.`)) return;
    setSavingCard(true);
    setCardError(null);
    try {
      const { error } = await supabase.from("cards").update({ archived: next }).eq("id", card.id);
      if (error) throw error;
      onChanged?.();
      onClose?.();
    } catch (err) {
      setCardError(err.message);
      setSavingCard(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          {renaming ? (
            <input className="sheet-title-input" value={nameInput} onChange={(e) => setNameInput(e.target.value)}
              onBlur={saveRename} onKeyDown={(e) => e.key === "Enter" && saveRename()} autoFocus disabled={savingCard} />
          ) : (
            <h2>{card.name}{card.archived && <span className="pill-archived">Archived</span>}</h2>
          )}
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>

        <p className="balance">{fmtMoney(cardAccount.balance_cache, cur)}</p>

        {amAdmin && (
          <div className="card-admin-actions">
            {!renaming && <button type="button" className="link-button" onClick={() => setRenaming(true)}>Rename</button>}
            <button type="button" className="link-button" disabled={savingCard} onClick={toggleArchived}>
              {card.archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        )}
        {cardError && <p className="status error">{cardError}</p>}

        <div className="sheet-tabs">
          {!card.archived && (
            <>
              <button type="button" className={`sheet-tab ${tab === "topup" ? "active" : ""}`} onClick={() => setTab("topup")}>Top up</button>
              <button type="button" className={`sheet-tab ${tab === "withdraw" ? "active" : ""}`} onClick={() => setTab("withdraw")}>Spend</button>
            </>
          )}
          <button type="button" className={`sheet-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>History</button>
        </div>

        <div className="sheet-body">
          {card.archived && tab !== "history" && <p className="hint">This card is archived. Unarchive it to use it again.</p>}
          {!card.archived && tab === "topup" && (
            <CardTopUpForm cardAccount={cardAccount} poolAccounts={poolAccounts} memberAccounts={memberAccounts} memberId={memberId} amAdmin={amAdmin} members={members} onDone={handleDone} />
          )}
          {!card.archived && tab === "withdraw" && (
            <CardWithdrawForm familyId={familyId} memberId={memberId} members={members} categories={categories} amAdmin={amAdmin} card={card} cardAccount={cardAccount} onDone={handleDone} />
          )}

          {tab === "history" && (
            <>
              {loading && <p className="hint">Loading...</p>}
              {!loading && history.length === 0 && <p className="hint">No activity yet.</p>}
              <ul className="txn-list">
                {history.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <div>
                      <span className="txn-amount">
                        {r.sign > 0 ? "+" : "-"}{fmtMoney(r.kind === "topup" ? r.amount : r.amount, cur)}
                      </span>
                      <span className="txn-meta">
                        {r.kind === "topup" ? (r.sign > 0 ? "Top up" : "Returned") : r.kind === "common" ? `Family cost: ${r.title}` : "Spent"}{sourceLabel(r)} ·{" "}
                        {members?.find((m) => m.id === r.member_id)?.display_name ?? "Unknown member"}
                        {r.tagged_member_id && r.tagged_member_id !== r.member_id &&
                          ` · for ${members?.find((m) => m.id === r.tagged_member_id)?.display_name ?? "a member"}`} · {fmtWhen(r.created_at)}
                      </span>
                    </div>
                    {r.note && <p className="txn-note">{r.note}</p>}
                    {canDelete(r) && (
                      <div className="txn-actions">
                        <button type="button" className="remove-btn" onClick={() => removeEntry(r)}>Delete</button>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
