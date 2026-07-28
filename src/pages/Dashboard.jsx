import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import DepositForm from './DepositForm'
import TransactionForm from './TransactionForm'
import TransactionRow from './TransactionRow'
import ExchangeRateOverride from './ExchangeRateOverride'
import AdminSettings from './AdminSettings'
import LimitWarningBanner from './LimitWarningBanner'
import PlannedPayments from './PlannedPayments'
import ActivityFeed from './ActivityFeed'
import { getMemberSpend } from '../lib/spendingLimits'
import { getFamilyBudgetSpend } from '../lib/budgets'
import { isAdmin, isSuperadmin } from '../lib/roles'

const PAGE_SIZE = 20 // FR13 — load 20 at a time, not the full history
const ACTIVITY_LIMIT = 10

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
  const [familyBudgetSpend, setFamilyBudgetSpend] = useState(null)
  const [breakdown, setBreakdown] = useState([])
  const [plannedPayments, setPlannedPayments] = useState([])
  const [activity, setActivity] = useState([])

  // Kept in refs so the realtime callback (registered once) can look up
  // current names without re-subscribing every time members/categories change.
  const membersRef = useRef(members)
  const categoriesRef = useRef(categories)
  membersRef.current = members
  categoriesRef.current = categories

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
    if (fam) loadFamilyBudget(fam)

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
    // scale this is a small dataset; pagination above is only for the
    // transaction list, not this summary.
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

  async function loadFamilyBudget(currentFamily) {
    const spend = await getFamilyBudgetSpend(familyId, currentFamily)
    setFamilyBudgetSpend(spend)
  }

  async function loadPlannedPayments() {
    const { data } = await supabase
      .from('planned_payments')
      .select('*')
      .eq('family_id', familyId)
      .eq('is_active', true)
    setPlannedPayments(data || [])
  }

  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      await Promise.all([
        loadFamilyAndMembers(),
        loadWallet(),
        loadCategories(),
        loadTransactions(),
        loadBreakdown(),
        loadPlannedPayments()
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
        (payload) => {
          loadTransactions()
          loadBreakdown()
          loadFamilyAndMembers() // also refreshes mySpend + memberSpends + family budget spend

          // In-app "notify me when someone spends" — no push infra, rides
          // this same realtime channel. Only new spends generate an entry.
          if (payload.eventType === 'INSERT') {
            const row = payload.new
            const member = membersRef.current.find((m) => m.id === row.member_id)
            const category = categoriesRef.current.find((c) => c.id === row.category_id)
            setActivity((prev) =>
              [
                {
                  id: row.id,
                  memberName: member?.display_name ?? 'Someone',
                  amount: row.amount,
                  currency: row.currency,
                  categoryName: category?.name ?? null,
                  timeLabel: new Date(row.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                },
                ...prev
              ].slice(0, ACTIVITY_LIMIT)
            )
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deposits', filter: `family_id=eq.${familyId}` },
        loadTransactions
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'planned_payments', filter: `family_id=eq.${familyId}` },
        loadPlannedPayments
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [familyId, session.user.id])

  if (!family) return <p className="status">Loading family...</p>

  const myRole = myMember?.role
  const amAdmin = isAdmin(myRole)
  const amSuperadmin = isSuperadmin(myRole)

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
        <p className="hint">Actual cash: total deposited minus total spent, live-synced.</p>
      </section>

      {familyBudgetSpend && (
        <section className="card">
          <h2>Family Budget ({familyBudgetSpend.period})</h2>
          <div className="breakdown-row">
            <span>Used</span>
            <span>
              {familyBudgetSpend.spent.toFixed(2)} / {familyBudgetSpend.limit.toFixed(2)}{' '}
              {family.base_currency}
            </span>
          </div>
          <div className="breakdown-bar-track">
            <div
              className={`breakdown-bar ${
                familyBudgetSpend.isOverLimit ? 'over' : familyBudgetSpend.isNearLimit ? 'near' : ''
              }`}
              style={{ width: `${Math.min(familyBudgetSpend.percentUsed * 100, 100)}%` }}
            />
          </div>
          <p className="hint">This is a target the admin set, separate from actual cash above.</p>
        </section>
      )}

      {mySpend && (
        <section className="card">
          <h2>My Balance This Period ({mySpend.period})</h2>
          <p className="balance">
            {mySpend.spent.toFixed(2)} / {mySpend.limit.toFixed(2)} {family.base_currency}
          </p>
          <p className="hint">How much you've drawn from the family budget so far this period.</p>
        </section>
      )}

      {amAdmin && (
        <section className="card">
          <h2>Add Funds</h2>
          <DepositForm familyId={familyId} memberId={myMember.id} baseCurrency={family.base_currency} />
        </section>
      )}

      {amAdmin && (
        <section className="card">
          <h2>Manual Exchange Rate Override</h2>
          <p className="hint">
            For informal/parallel-market currencies (e.g. LBP). Enter one direction — the
            reverse rate is derived and stored automatically. Stays in effect until you
            set a new rate (doesn't reset daily).
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

      {myMember && categories.length > 0 && (
        <section className="card">
          <h2>Upcoming Bills</h2>
          <PlannedPayments
            familyId={familyId}
            memberId={myMember.id}
            baseCurrency={family.base_currency}
            categories={categories}
            payments={plannedPayments}
            onDone={() => {
              loadPlannedPayments()
              loadTransactions()
              loadBreakdown()
              loadFamilyAndMembers()
            }}
          />
        </section>
      )}

      <section className="card">
        <h2>Recent Activity</h2>
        <ActivityFeed events={activity} />
      </section>

      <section className="card">
        <h2>Transaction History</h2>
        {transactions.length === 0 && <p className="hint">No transactions yet.</p>}
        <ul className="txn-list">
          {transactions.map((t) => (
            <TransactionRow
              key={t.id}
              t={t}
              familyId={familyId}
              baseCurrency={family.base_currency}
              categories={categories}
              canManage={t.member_id === myMember?.id || amAdmin}
              onChanged={() => {
                loadTransactions()
                loadBreakdown()
                loadFamilyAndMembers()
              }}
            />
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

      {amAdmin && (
        <section className="card">
          <h2>Admin Settings</h2>
          <AdminSettings
            familyId={familyId}
            family={family}
            members={members}
            categories={categories}
            baseCurrency={family.base_currency}
            memberSpends={memberSpends}
            amSuperadmin={amSuperadmin}
            myMemberId={myMember.id}
            onDone={() => {
              loadFamilyAndMembers()
              loadCategories()
            }}
          />
        </section>
      )}

      {amAdmin && invite && (
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
