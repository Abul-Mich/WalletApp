import { useState } from 'react'

const TABS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: (active) => (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
        <path
          d="M4 11.5 12 5l8 6.5"
          stroke={active ? '#3b82f6' : '#94a3b8'}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6 10.5V19a1 1 0 0 0 1 1h3v-4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3a1 1 0 0 0 1-1v-8.5"
          stroke={active ? '#3b82f6' : '#94a3b8'}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  },
  {
    key: 'family',
    label: 'Family',
    icon: (active) => (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
        <circle cx="9" cy="8" r="2.6" stroke={active ? '#3b82f6' : '#94a3b8'} strokeWidth="1.8" />
        <circle cx="16.5" cy="9.5" r="2.1" stroke={active ? '#3b82f6' : '#94a3b8'} strokeWidth="1.8" />
        <path
          d="M4 19c0-2.6 2.2-4.5 5-4.5s5 1.9 5 4.5"
          stroke={active ? '#3b82f6' : '#94a3b8'}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M14.2 15.2c2.3.3 3.8 2 3.8 3.8"
          stroke={active ? '#3b82f6' : '#94a3b8'}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    )
  },
  { key: 'add', label: '', icon: null },
  {
    key: 'statistics',
    label: 'Statistics',
    icon: (active) => (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
        <path
          d="M5 19V10M12 19V5M19 19v-6"
          stroke={active ? '#3b82f6' : '#94a3b8'}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  },
  {
    key: 'me',
    label: 'Me',
    icon: (active) => (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
        <circle cx="12" cy="8.2" r="3.2" stroke={active ? '#3b82f6' : '#94a3b8'} strokeWidth="1.8" />
        <path
          d="M5.5 19.2c0-3.4 2.9-6.1 6.5-6.1s6.5 2.7 6.5 6.1"
          stroke={active ? '#3b82f6' : '#94a3b8'}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    )
  }
]

export default function BottomNav({ active = 'dashboard', onChange }) {
  const [internalActive, setInternalActive] = useState(active)
  const current = onChange ? active : internalActive

  function handleSelect(key) {
    if (onChange) onChange(key)
    else setInternalActive(key)
  }

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-glass">
        {TABS.map((tab) =>
          tab.key === 'add' ? (
            <button
              key={tab.key}
              type="button"
              className="bottom-nav-add"
              aria-label="Add"
              onClick={() => handleSelect(tab.key)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                <path
                  d="M12 5v14M5 12h14"
                  stroke="#fff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : (
            <button
              key={tab.key}
              type="button"
              className={`bottom-nav-item ${current === tab.key ? 'active' : ''}`}
              onClick={() => handleSelect(tab.key)}
            >
              {tab.icon(current === tab.key)}
              <span>{tab.label}</span>
            </button>
          )
        )}
      </div>
    </nav>
  )
}
