import { useState } from "react";
import { createCard, fmtMoney } from "../lib/wallets";
import CardDetailModal from "./CardDetailModal";

export default function CardsSection({
  familyId, memberId, cards, accounts, members, categories, amAdmin, amSuperadmin, onChanged,
}) {
  const [selectedCardId, setSelectedCardId] = useState(null);
  const selectedCard = cards.find((c) => c.id === selectedCardId) || null;
  const [showNewCard, setShowNewCard] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const activeCards = cards.filter((c) => !c.archived);
  const archivedCards = cards.filter((c) => c.archived);
  const visibleCards = showArchived ? cards : activeCards;

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createCard({ familyId, name: name.trim(), currency });
      setName("");
      setShowNewCard(false);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Cards</h2>
        {amAdmin && (
          <button type="button" className="link-button" onClick={() => setShowNewCard((v) => !v)}>
            {showNewCard ? "Cancel" : "New card"}
          </button>
        )}
      </div>

      {showNewCard && (
        <form onSubmit={handleCreate} className="inline-form">
          <input placeholder="Card name (e.g. Fuel Card)" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD card</option>
            <option value="LBP">LBP card</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Creating..." : "Create card"}</button>
          {error && <p className="status error">{error}</p>}
        </form>
      )}

      {activeCards.length === 0 && !showNewCard && <p className="hint">No shared cards yet.</p>}

      <ul className="card-list">
        {visibleCards.map((c) => {
          const a = accounts.cards[c.id];
          return (
            <li key={c.id}>
              <button type="button" className={`card-list-item ${c.archived ? "archived" : ""}`} onClick={() => setSelectedCardId(c.id)}>
                <span>
                  {c.name}
                  {c.archived && <span className="pill-archived">Archived</span>}
                </span>
                <span className="balance-inline">{a ? fmtMoney(a.balance_cache, a.currency) : "—"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {archivedCards.length > 0 && (
        <button type="button" className="link-button" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived cards" : `Show ${archivedCards.length} archived card${archivedCards.length > 1 ? "s" : ""}`}
        </button>
      )}

      {selectedCard && accounts.cards[selectedCard.id] && (
        <CardDetailModal
          familyId={familyId}
          memberId={memberId}
          card={selectedCard}
          cardAccount={accounts.cards[selectedCard.id]}
          poolAccounts={accounts.pool}
          members={members}
          categories={categories}
          amAdmin={amAdmin}
          amSuperadmin={amSuperadmin}
          onClose={() => setSelectedCardId(null)}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}
