import { useEffect, useRef, useState } from 'react'

// "Unread" is tracked client-side (localStorage, per family+user) rather
// than server-side, since these are admin-only FYI notifications with no
// per-recipient row to mark read — good enough for a badge count without
// needing a read-state table.
function lastSeenKey(familyId, userId) {
  return `wallet:notifications-last-seen:${familyId}:${userId}`
}

export default function NotificationBell({ familyId, userId, notifications, members, cards = [], role }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const [lastSeen, setLastSeen] = useState(() => {
    return localStorage.getItem(lastSeenKey(familyId, userId)) || '1970-01-01T00:00:00.000Z'
  })

  const unreadCount = notifications.filter((n) => n.created_at > lastSeen).length

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next) {
      const now = new Date().toISOString()
      localStorage.setItem(lastSeenKey(familyId, userId), now)
      setLastSeen(now)
    }
  }

  function memberName(memberId) {
    return members.find((m) => m.id === memberId)?.display_name ?? 'Someone'
  }

  function cardName(cardId) {
    return cards.find((c) => c.id === cardId)?.name ?? 'a card'
  }

  return (
    <div className="notification-bell" ref={ref}>
      <button
        type="button"
        className={`icon-btn role-${role}`}
        aria-label="Notifications"
        title="Notifications"
        onClick={toggleOpen}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M18 16v-5a6 6 0 1 0-12 0v5l-1.6 2.4a1 1 0 0 0 .83 1.6h13.54a1 1 0 0 0 .83-1.6L18 16Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M9.5 20.5a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 && <span className="bell-badge">{unreadCount}</span>}
      </button>
      {open && (
        <div className="bell-dropdown">
          {notifications.length === 0 && <p className="hint">No notifications yet.</p>}
          <ul className="activity-list">
            {notifications.slice(0, 10).map((n) => (
              <li key={n.id}>
                <span>
                  <strong>{memberName(n.member_id)}</strong>{' '}
                  {n.type === 'member_return' && (
                    <>returned {Number(Math.abs(n.amount)).toFixed(2)} to the family balance</>
                  )}
                  {n.type === 'member_topup' && (
                    <>added {Number(n.amount).toFixed(2)} to their balance</>
                  )}
                  {n.type === 'card_topup' && (
                    <>topped up {cardName(n.card_id)} by {Number(n.amount).toFixed(2)}</>
                  )}
                  {n.type === 'card_withdraw' && (
                    <>spent {Number(n.amount).toFixed(2)} from {cardName(n.card_id)}</>
                  )}
                </span>
                <span className="txn-meta">
                  {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
