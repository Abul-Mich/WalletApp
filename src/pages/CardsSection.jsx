import { useState } from 'react'
import { supabase } from '../supabaseClient'
import CardDetailModal from './CardDetailModal'

export default function CardsSection({ familyId, memberId, baseCurrency, cards, amAdmin, onChanged }) {
  const [selectedCardId, setSelectedCardId] = useState(null)
  const selectedCard = cards.find((c) => c.id === selectedCardId) || null
  const [showNewCard, setShowNewCard] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const activeCards = cards.filter((c) => !c.archived)
  const archivedCards = cards.filter((c) => c.archived)
  const visibleCards = showArchived ? cards : activeCards

  async function handleCreate(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.from('cards').insert({
        family_id: familyId,
        name: name.trim(),
        created_by: memberId
      })
      if (err) throw err
      setName('')
      setShowNewCard(false)
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Cards</h2>
        {amAdmin && (
          <button
            type="button"
            className="link-button"
            onClick={() => setShowNewCard((v) => !v)}
          >
            {showNewCard ? 'Cancel' : 'New Card'}
          </button>
        )}
      </div>

      {showNewCard && (
        <form onSubmit={handleCreate} className="inline-form">
          <input
            placeholder="Card name (e.g. Fuel Card)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Creating...' : 'Create Card'}
          </button>
          {error && <p className="status error">{error}</p>}
        </form>
      )}

      {activeCards.length === 0 && !showNewCard && (
        <p className="hint">No shared cards yet.</p>
      )}

      <ul className="card-list">
        {visibleCards.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`card-list-item ${c.archived ? 'archived' : ''}`}
              onClick={() => setSelectedCardId(c.id)}
            >
              <span>
                {c.name}
                {c.archived && <span className="pill-archived">Archived</span>}
              </span>
              <span className="balance-inline">
                {Number(c.balance_cache).toFixed(2)} {baseCurrency}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {archivedCards.length > 0 && (
        <button
          type="button"
          className="link-button"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Hide archived cards' : `Show ${archivedCards.length} archived card${archivedCards.length > 1 ? 's' : ''}`}
        </button>
      )}

      {selectedCard && (
        <CardDetailModal
          familyId={familyId}
          memberId={memberId}
          card={selectedCard}
          baseCurrency={baseCurrency}
          amAdmin={amAdmin}
          onClose={() => setSelectedCardId(null)}
          onChanged={onChanged}
        />
      )}
    </section>
  )
}
