import { useEffect, useState } from "react";
import IncomeEditSheet from "./IncomeEditSheet";
import { useConfirm } from "../components/ConfirmSheet";
import { supabase } from "../supabaseClient";
import CardSpendEditForm from "./CardSpendEditForm";
import { deleteIncome, INCOME_TYPES, deleteTransfer, deleteCardSpend, deleteCommonExpense, fmtMoney, fmtWhen } from "../lib/wallets";
import CardTopUpForm from "./CardTopUpForm";
import CardWithdrawForm from "./CardWithdrawForm";
import CardToWalletForm from "./CardToWalletForm";
import IncomeForm from "./IncomeForm";

const PAGE_SIZE = 20;

export default function CardDetailModal({
  familyId, memberId, card, cardAccount, poolAccounts, memberAccounts, members, categories, amAdmin, amSuperadmin, onClose, onChanged,
}) {
  const [tab, setTab] = useState(card.archived ? "history" : "topup");
  const [history, setHistory] = useState([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // card spend being edited
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(card.name);
  const [savingCard, setSavingCard] = useState(false);
  const [cardError, setCardError] = useState(null);
  const cur = cardAccount.currency;
  const { ask, dialog } = useConfirm();
  const [editIncome, setEditIncome] = useState(null);

  async function loadHistory(nextLimit) {
    setLoading(true);
    const [{ data: transfers }, { data: spends }, { data: commons }, { data: incomes }] = await Promise.all([
      supabase.from("transfers").select("*")
        .or(`to_account_id.eq.${cardAccount.id},from_account_id.eq.${cardAccount.id}`)
        .order("created_at", { ascending: false }).limit(nextLimit),
      supabase.from("card_transactions").select("*").eq("card_id", card.id)
        .order("created_at", { ascending: false }).limit(nextLimit),
      supabase.from("common_expenses").select("*").eq("account_id", cardAccount.id)
        .order("created_at", { ascending: false }).limit(nextLimit),
      supabase.from("deposits").select("*").eq("account_id", cardAccount.id)
        .order("created_at", { ascending: false }).limit(nextLimit),
    ]);
    const combined = [
      ...(incomes || []).map((r) => ({ ...r, deposit_kind: r.kind, kind: "income", member_id: r.added_by_member_id, sign: 1 })),
      ...(transfers || []).map((r) => ({
        ...r, kind: "topup", member_id: r.created_by,
        sign: r.to_account_id === cardAccount.id ? 1 : -1,
      })),
      ...(spends || []).map((r) => ({ ...r, kind: "spend", sign: -1 })),
      ...(commons || []).map((r) => ({ ...r, kind: "common", member_id: r.created_by, sign: -1 })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    setHistory(combined.slice(0, nextLimit));
    setHasMore((transfers?.length ?? 0) === nextLimit || (spends?.length ?? 0) === nextLimit || (commons?.length ?? 0) === nextLimit || (incomes?.length ?? 0) === nextLimit);
    setLoading(false);
  }

  useEffect(() => {
    loadHistory(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, limit]);

  // Where a top-up came from: "Family pool" or "<name>'s wallet".
  function nameOfAccount(id) {
    if (Object.values(poolAccounts || {}).some((a) => a.id === id)) return "Family pool";
    for (const [mid, pair] of Object.entries(memberAccounts || {})) {
      if (Object.values(pair).some((a) => a.id === id)) {
        const n = members?.find((m) => m.id === mid)?.display_name;
        return n ? `${n}'s wallet` : "a member wallet";
      }
    }
    return null;
  }

  function sourceLabel(r) {
    if (r.kind === "topup" && r.sign < 0) {
      const to = nameOfAccount(r.to_account_id);
      return to ? ` · to ${to}` : "";
    }
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

  // Spends can be edited (their person, category, amount, date, note); top-ups and family costs are deleted and re-entered.
  function canEdit(r) {
    return !card.archived && r.kind !== "topup" && r.kind !== "common" && r.kind !== "income" && (r.member_id === memberId || amAdmin);
  }

  function canDelete(r) {
    if (r.kind === "topup" || r.kind === "common" || r.kind === "income") return amAdmin;
    return r.member_id === memberId || amSuperadmin;
  }

  function removeEntry(r) {
    const what = r.kind === "income" ? "entry" : r.kind === "topup" ? "top-up" : r.kind === "common" ? "family cost" : "spending";
    ask({
      title: `Delete this ${what}?`,
      detail: `${fmtMoney(r.amount, cur)} on ${card.name}`,
      effect: "The card balance is recalculated, and the money goes back to where it came from. This cannot be undone.",
      confirmLabel: `Delete ${what}`, cancelLabel: "Keep it", icon: "trash",
      onConfirm: async () => {
        if (r.kind === "income") await deleteIncome(r.id);
        else if (r.kind === "topup") await deleteTransfer(r.id);
        else if (r.kind === "common") await deleteCommonExpense(r.id);
        else await deleteCardSpend(r.id);
        handleDone();
      },
    });
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

  function toggleArchived() {
    const next = !card.archived;
    if (!next) return applyArchived(false);
    ask({
      title: `Archive ${card.name}?`,
      detail: `Balance ${fmtMoney(cardAccount.balance_cache, cur)}`,
      effect: "No more top-ups or spending on this card. Its balance and history stay visible, and you can unarchive it any time.",
      confirmLabel: "Archive card", cancelLabel: "Cancel", icon: "archive", danger: false,
      onConfirm: () => applyArchived(true, true),
    });
  }

  async function applyArchived(next, rethrow = false) {
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
      if (rethrow) throw err;
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

              <button type="button" className={`sheet-tab ${tab === "towallet" ? "active" : ""}`} onClick={() => setTab("towallet")}>To my wallet</button>
              {amAdmin && <button type="button" className={`sheet-tab ${tab === "income" ? "active" : ""}`} onClick={() => setTab("income")}>Add money</button>}
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
            <CardWithdrawForm familyId={familyId} memberId={memberId} members={(members || []).filter((m) => !m.removed_at)} categories={categories || []} amAdmin={amAdmin} card={card} cards={[card]} accounts={{ pool: poolAccounts, members: memberAccounts, cards: { [card.id]: cardAccount } }} onDone={handleDone} />
          )}

          {!card.archived && tab === "towallet" && (
            <CardToWalletForm cardAccount={cardAccount} memberAccounts={memberAccounts} memberId={memberId} onDone={handleDone} />
          )}

          {!card.archived && amAdmin && tab === "income" && (
            <IncomeForm
              familyId={familyId} memberId={memberId} categories={categories || []} cards={[card]} members={members || []} amAdmin={amAdmin}
              accounts={{ pool: poolAccounts, members: memberAccounts, cards: { [card.id]: cardAccount }, pockets: {} }}
              presetDest={`card:${card.id}`} onDone={handleDone}
            />
          )}

          {tab === "history" && (
            <>
              {loading && <p className="hint">Loading...</p>}
              {!loading && history.length === 0 && <p className="hint">No activity yet.</p>}
              <ul className="txn-list">
                {history.map((r) => editingId === r.id ? (
                  <li key={`${r.kind}-${r.id}`} className="txn-edit-host">
                    <CardSpendEditForm record={r} categories={categories} members={members} cardName={card.name}
                      onSaved={() => { setEditingId(null); handleDone(); }} onCancel={() => setEditingId(null)}
                      onDelete={canDelete(r) ? () => removeEntry(r) : undefined} />
                  </li>
                ) : (
                  <li key={`${r.kind}-${r.id}`}>
                    <div>
                      <span className={`txn-amount ${r.sign > 0 ? "pos" : ""}`}>
                        {r.sign > 0 ? "+" : "-"}{fmtMoney(r.kind === "topup" ? r.amount : r.amount, cur)}
                      </span>
                      <span className="txn-meta">
                        {r.kind === "income" ? `${INCOME_TYPES.find((x) => x.key === r.deposit_kind)?.label || "Money added"}, from outside` : r.kind === "topup" ? (r.sign > 0 ? "Top up" : "Returned") : r.kind === "common" ? `Family cost: ${r.title}` : `Spent${categories?.find((c) => c.id === r.category_id) ? ` on ${categories.find((c) => c.id === r.category_id).name}` : ""}`}{sourceLabel(r)} ·{" "}
                        {members?.find((m) => m.id === r.member_id)?.display_name ?? "Unknown member"}
                        {r.tagged_member_id && r.tagged_member_id !== r.member_id &&
                          ` · for ${members?.find((m) => m.id === r.tagged_member_id)?.display_name ?? "a member"}`} · {fmtWhen(r.created_at)}
                      </span>
                    </div>
                    {r.note && <p className="txn-note">{r.note}</p>}
                    {(canDelete(r) || canEdit(r)) && (
                      <div className="txn-actions">
                        {canEdit(r) && <button type="button" onClick={() => setEditingId(r.id)}>Edit</button>}
                        {r.kind === "income" && canDelete(r) && <button type="button" onClick={() => setEditIncome(r)}>Edit</button>}
                        {canDelete(r) && <button type="button" className="remove-btn" onClick={() => removeEntry(r)}>Delete</button>}
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
      {editIncome && (
        <IncomeEditSheet record={editIncome} kind={editIncome.deposit_kind} categories={categories} members={members} amAdmin={amAdmin}
          onClose={() => setEditIncome(null)} onSaved={() => { setEditIncome(null); handleDone(); }} />
      )}
      {dialog}
    </div>
  );
}
