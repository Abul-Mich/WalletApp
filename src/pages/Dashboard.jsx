import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import DepositForm from './DepositForm'
import TransactionForm from './TransactionForm'
import ExchangeRateOverride from './ExchangeRateOverride'
import AdminSettings from './AdminSettings'
import LimitWarningBanner from './LimitWarningBanner'
import { getMemberSpend } from '../lib/spendingLimits'

const PAGE_SIZE = 20 // FR13 — load 20 at a time, not the full history

export default function Dashboard({ familyId }) {
  const { session } = useAuth()
  const [family, setFamily] = useState(null)
  const [members, setMembers] = useState([])
  const [myMember, setMyMember] = useState(null)
  const [invite, setInvite] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState([])
  const [txnPage, setTxnPage] = useState(0)
  const [hasMoreTxns, setHasMoreTxns] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [mySpend, setMySpend] = useState(null)
  const [memberSpends, setMemberSpends] = useState({}) // memberId -> spend result, for admin view
  const [breakdown, setBreakdown] = useState([])

  async function loadFamilyAndMembers() {
    const { data: fam } = await supabase.from('families').select('*').eq('id', familyId).single()
    const { data: mem } = await supabase.from('members').select('*').eq('family_id', familyId)
    const { data: inv } = await supabase
      .from('family_invites')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const resolvedMember = (mem || []).find((m) => m.user_id === session.user.id)

    setFamily(fam)
    setMembers(mem || [])
    setMyMember(resolvedMember)
    setInvite(inv)

    loadMySpend(resolvedMember)
    loadAllMemberSpends(mem)

    return resolvedMember
  }

  async function loadWallet() {
    const { data } = await supabase.from('wallets').select('*').eq('family_id', familyId).single()
    setWallet(data)
  }

  async function loadCategories() {
    const { data } = await supabase.from('categories').select('*').eq('family_id', familyId).order('name')
    setCategories(data || [])
  }

  // reset=true reloads from page 0 (used on realtime updates / initial load).
  // reset=false appends the next page (used by "Load More", FR13).
  async function loadTransactions(reset = true) {
    const nextPage = reset ? 0 : txnPage + 1
    const from = nextPage * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    if (!reset) setLoadingMore(true)
    const { data } = await supabase
      .from('transactions')
      .select('*, categories(name), members(display_name)')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false })
      .range(from, to)

    const page = data || []
    setTransactions((prev) => (reset ? page : [...prev, ...page]))
    setHasMoreTxns(page.length === PAGE_SIZE)
    setTxnPage(nextPage)
    if (!reset) setLoadingMore(false)
  }

  async function loadBreakdown() {
    // Full-history aggregation for the category breakdown (FR21). At family
    // scale this is a small dataset; Day 5 pagination is only for the
    // recent-transactions list, not this summary.
    const { data } = await supabase
      .from('transactions')
      .select('amount, exchange_rate_to_base, categories(name)')
      .eq('family_id', familyId)

    const totals = {}
    for (const t of data || []) {
      const name = t.categories?.name ?? 'Uncategorized'
      totals[name] = (totals[name] || 0) + t.amount * t.exchange_rate_to_base
    }
    setBreakdown(Object.entries(totals).sort((a, b) => b[1] - a[1]))
  }

  async function loadMySpend(currentMember) {
    if (!currentMember) return
    const spend = await getMemberSpend(familyId, currentMember)
    setMySpend(spend)
  }

  async function loadAllMemberSpends(currentMembers) {
    const entries = await Promise.all(
      (currentMembers || []).map(async (m) => [m.id, await getMemberSpend(familyId, m)])
    )
    setMemberSpends(Object.fromEntries(entries))
  }

  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      await Promise.all([
        loadFamilyAndMembers(),
        loadWallet(),
        loadCategories(),
        loadTransactions(),
        loadBreakdown()
      ])
    }
    if (!cancelled) loadAll()

    // Realtime: members joining, wallet balance changing, new transactions/deposits (FR9, FR22)
    const channel = supabase
      .channel(`family-${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members', filter: `family_id=eq.${familyId}` },
        loadFamilyAndMembers
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallets', filter: `family_id=eq.${familyId}` },
        loadWallet
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `family_id=eq.${familyId}` },
        () => {
          loadTransactions()
          loadBreakdown()
          loadFamilyAndMembers() // also refreshes mySpend + memberSpends, since limits are spend-dependent
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deposits', filter: `family_id=eq.${familyId}` },
        loadTransactions
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [familyId, session.user.id])

  if (!family) return <p className="status">Loading family...</p>

  return (
    <div className="dashboard">
      <header>
        <h1>{family.name}</h1>
        <p className="subtitle">Base currency: {family.base_currency}</p>
      </header>

      <LimitWarningBanner spend={mySpend} baseCurrency={family.base_currency} />

      <section className="card">
        <h2>Family Balance</h2>
        <p className="balance">
          {wallet ? Number(wallet.balance_cache).toFixed(2) : '--'} {family.base_currency}
        </p>
        <p className="hint">Total deposited minus total spent, live-synced across the family.</p>
      </section>

      {myMember?.role === 'admin' && (
        <section className="card">
          <h2>Add Funds</h2>
          <DepositForm
            familyId={familyId}
            memberId={myMember.id}
            baseCurrency={family.base_currency}
          />
        </section>
      )}

      {myMember?.role === 'admin' && (
        <section className="card">
          <h2>Manual Exchange Rate Override</h2>
          <p className="hint">
            For informal/parallel-market currencies (e.g. LBP) where the live rate
            doesn't reflect what your family actually uses. Applies to today's date only.
          </p>
          <ExchangeRateOverride
            familyId={familyId}
            memberId={myMember.id}
            baseCurrency={family.base_currency}
          />
        </section>
      )}

      {myMember && categories.length > 0 && (
        <section className="card">
          <h2>Log an Expense</h2>
          <TransactionForm
            familyId={familyId}
            memberId={myMember.id}
            baseCurrency={family.base_currency}
            categories={categories}
          />
        </section>
      )}

      <section className="card">
        <h2>Transaction History</h2>
        {transactions.length === 0 && <p className="hint">No transactions yet.</p>}
        <ul className="txn-list">
          {transactions.map((t) => (
            <li key={t.id}>
              <div>
                <span className="txn-amount">
                  -{Number(t.amount).toFixed(2)} {t.currency}
                  {t.currency !== family.base_currency && (
                    <span className="txn-converted">
                      {' '}
                      (≈{(t.amount * t.exchange_rate_to_base).toFixed(2)} {family.base_currency})
                    </span>
                  )}
                </span>
                <span className="txn-meta">
                  {t.categories?.name ?? 'Uncategorized'} · {t.members?.display_name}
                </span>
              </div>
              {t.note && <p className="txn-note">{t.note}</p>}
            </li>
          ))}
        </ul>
        {hasMoreTxns && (
          <button
            type="button"
            className="load-more"
            disabled={loadingMore}
            onClick={() => loadTransactions(false)}
          >
            {loadingMore ? 'Loading...' : 'Load 20 More'}
          </button>
        )}
      </section>

      <section className="card">
        <h2>Category Breakdown</h2>
        {breakdown.length === 0 && <p className="hint">No spending yet.</p>}
        <ul className="breakdown-list">
          {breakdown.map(([name, total]) => {
            const max = breakdown[0]?.[1] || 1
            return (
              <li key={name}>
                <div className="breakdown-row">
                  <span>{name}</span>
                  <span>
                    {total.toFixed(2)} {family.base_currency}
                  </span>
                </div>
                <div className="breakdown-bar-track">
                  <div className="breakdown-bar" style={{ width: `${(total / max) * 100}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="card">
        <h2>Members ({members.length})</h2>
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.id}>
              <span>{m.display_name}</span>
              <span className={`badge ${m.role}`}>{m.role}</span>
            </li>
          ))}
        </ul>
      </section>

      {myMember?.role === 'admin' && (
        <section className="card">
          <h2>Admin Settings</h2>
          <AdminSettings
            familyId={familyId}
            members={members}
            categories={categories}
            baseCurrency={family.base_currency}
            memberSpends={memberSpends}
            onDone={() => {
              loadFamilyAndMembers()
              loadCategories()
            }}
          />
        </section>
      )}

      {myMember?.role === 'admin' && invite && (
        <section className="card">
          <h2>Invite Code</h2>
          <p className="invite-code">{invite.code}</p>
          <p className="hint">Share this with family members so they can join.</p>
        </section>
      )}

      <button className="signout" onClick={() => supabase.auth.signOut()}>
        Sign Out
      </button>
    </div>
  )
}
