import { formatMoney } from '../lib/format'

export default function ActivityFeed({ events }) {
  if (events.length === 0) {
    return <p className="hint">No recent activity yet.</p>
  }

  return (
    <ul className="activity-list">
      {events.map((e) => (
        <li key={e.id}>
          <span>
            <strong>{e.memberName}</strong> spent {formatMoney(e.amount, e.currency)}
            {e.categoryName ? ` on ${e.categoryName}` : ''}
          </span>
          <span className="txn-meta">{e.timeLabel}</span>
        </li>
      ))}
    </ul>
  )
}
