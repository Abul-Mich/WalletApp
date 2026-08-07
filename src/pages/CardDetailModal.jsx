import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import CardTopUpForm from './CardTopUpForm'
import CardWithdrawForm from './CardWithdrawForm'

const PAGE_SIZE = 20

export default function CardDetailModal({ familyId, memberId, card, baseCurrency, onClose, onChanged }) {
  const [tab, setTab] = useState('topup')
  const [history, setHistory] = useState([])
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  async function loadHistory(nextLimit) {
    setLoading(true)
    const [{ data: transfers }, { data: withdrawals }] = await Promise.all([
      supabase
        .from('card_transfers')
        .select('*, members(display_name)')
        .eq('card_id', card.id)
        .order('created_at', { ascending: false })
        .limit(nextLimit),
      supabase
        .from('card_transactions')
        .select('*, members(display_name)')
        .eq('card_id', card.id)
        .order('created_at', { ascending: false })
        .limit(nextLimit)
    ])

    const combined = [
      ...(transfers || []).map((r) => ({ ...r, kind: 'topup' })),
      ...(withdrawals || []).map((r) => ({ ...r, kind: 'withdraw' }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    setHistory(combined.slice(0, nextLimit))
    setHasMore((transfers?.length === nextLimit) || (withdrawals?.length === nextLimit))
    setLoading(false)
  }

  useEffect(() => {
    loadHistory(limit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, limit])

  function handleDone() {
    onChanged?.()
    setLimit(PAGE_SIZE)
    loadHistory(PAGE_SIZE)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>{card.name}</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <p className="balance">
          {Number(card.balance_cache).toFixed(2)} {baseCurrency}
        </p>

        <div className="sheet-tabs">
          <button
            type="button"
            className={`sheet-tab ${tab === 'topup' ? 'active' : ''}`}
            onClick={() => setTab('topup')}
          >
            Top Up
          </button>
          <button
            type="button"
            className={`sheet-tab ${tab === 'withdraw' ? 'active' : ''}`}
            onClick={() => setTab('withdraw')}
          >
            Withdraw
          </button>
        </div>

        <div className="sheet-body">
          {tab === 'topup' && (
            <CardTopUpForm
              familyId={familyId}
              memberId={memberId}
              cardId={card.id}
              baseCurrency={baseCurrency}
              onDone={handleDone}
            />
          )}
          {tab === 'withdraw' && (
            <CardWithdrawForm
              familyId={familyId}
              memberId={memberId}
              cardId={card.id}
              baseCurrency={baseCurrency}
              currentBalance={Number(card.balance_cache)}
              onDone={handleDone}
            />
          )}

          <h3 className="sheet-subheading">History</h3>
          {loading && <p className="hint">Loading...</p>}
          {!loading && history.length === 0 && <p className="hint">No activity yet.</p>}
          <ul className="txn-list">
            {history.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <div>
                  <span className="txn-amount">
                    {r.kind === 'topup' ? '+' : '-'}
                    {Number(r.amount).toFixed(2)} {r.currency}
                    {r.currency !== baseCurrency && (
                      <span className="txn-converted">
                        {' '}
                        (≈{(r.amount * r.exchange_rate_to_base).toFixed(2)} {baseCurrency})
                      </span>
                    )}
                  </span>
                  <span className="txn-meta">
                    {r.kind === 'topup' ? 'Top up' : 'Withdraw'} · {r.members?.display_name}
                  </span>
                </div>
                {r.note && <p className="txn-note">{r.note}</p>}
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
              {loading ? 'Loading...' : 'Load 20 More'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
