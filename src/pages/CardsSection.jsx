import { useState } from "react";
import { createCard, fmtMoney } from "../lib/wallets";
import CardDetailModal from "./CardDetailModal";
import { EditSheet } from "../components/RecordFields";
import { TextInput } from "../components/Field";

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
        <EditSheet title="New card" onClose={busy ? undefined : () => setShowNewCard(false)}>
          <form onSubmit={handleCreate} className="spend-form">
            <div className="sf-scroll">
              <TextInput label="Card name" value={name} onChange={setName} placeholder="Fuel Card, Trip Card..." required />
              <div className="sf-block">
                <span className="sf-label">Currency</span>
                <div className="sf-seg" role="group" aria-label="Card currency">
                  {["USD", "LBP"].map((c) => (
                    <button key={c} type="button" className={currency === c ? "on" : ""} aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c} card</button>
                  ))}
                </div>
                <span className="sf-muted sf-small" style={{ marginTop: 8 }}>A card holds one currency. You cannot change it later. Top it up from the pool or a wallet after creating it.</span>
              </div>
              {error && <p className="status error" role="alert">{error}</p>}
            </div>
            <div className="sf-footer">
              <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !name.trim()}>
                {busy ? "Creating..." : name.trim() ? `Create ${name.trim()} (${currency})` : "Enter a card name"}
              </button>
            </div>
          </form>
        </EditSheet>
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
          memberAccounts={accounts.members}
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
