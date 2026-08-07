import { useState } from 'react'
import { supabase } from '../supabaseClient'
import CardDetailModal from './CardDetailModal'

export default function CardsSection({ familyId, memberId, baseCurrency, cards, amAdmin, onChanged }) {
  const [selectedCardId, setSelectedCardId] = useState(null)
  const selectedCard = cards.find((c) => c.id === selectedCardId) || null
  const [showNewCard, setShowNewCard] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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

      {cards.length === 0 && !showNewCard && (
        <p className="hint">No shared cards yet.</p>
      )}

      <ul className="card-list">
        {cards.map((c) => (
          <li key={c.id}>
            <button type="button" className="card-list-item" onClick={() => setSelectedCardId(c.id)}>
              <span>{c.name}</span>
              <span className="balance-inline">
                {Number(c.balance_cache).toFixed(2)} {baseCurrency}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selectedCard && (
        <CardDetailModal
          familyId={familyId}
          memberId={memberId}
          card={selectedCard}
          baseCurrency={baseCurrency}
          onClose={() => setSelectedCardId(null)}
          onChanged={onChanged}
        />
      )}
    </section>
  )
}
