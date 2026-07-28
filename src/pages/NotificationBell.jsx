import { useEffect, useRef, useState } from 'react'

// "Unread" is tracked client-side (localStorage, per family+user) rather
// than server-side, since these are admin-only FYI notifications with no
// per-recipient row to mark read — good enough for a badge count without
// needing a read-state table.
function lastSeenKey(familyId, userId) {
  return `wallet:notifications-last-seen:${familyId}:${userId}`
}

export default function NotificationBell({ familyId, userId, notifications, members }) {
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

  return (
    <div className="notification-bell" ref={ref}>
      <button type="button" className="bell-btn" aria-label="Notifications" onClick={toggleOpen}>
        Notifications
        {unreadCount > 0 && <span className="bell-badge">{unreadCount}</span>}
      </button>
      {open && (
        <div className="bell-dropdown">
          {notifications.length === 0 && <p className="hint">No notifications yet.</p>}
          <ul className="activity-list">
            {notifications.slice(0, 10).map((n) => (
              <li key={n.id}>
                <span>
                  <strong>{memberName(n.member_id)}</strong> added {Number(n.amount).toFixed(2)} to
                  their balance
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
