import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../AuthContext";
import DepositForm from "./DepositForm";
import TransactionRow from "./TransactionRow";
import ExchangeRateOverride from "./ExchangeRateOverride";
import AdminSettings from "./AdminSettings";
import LimitWarningBanner from "./LimitWarningBanner";
import PlannedPayments from "./PlannedPayments";
import ActivityFeed from "./ActivityFeed";
import NotificationBell from "./NotificationBell";
import CardsSection from "./CardsSection";
import CommonExpenses from "./CommonExpenses";
import BottomNav from "./BottomNav";
import AddActionSheet from "./AddActionSheet";
import TransactionHistoryModal from "./TransactionHistoryModal";
import MeProfileCard from "./MeProfileCard";
import BalanceTransfersAdmin from "./BalanceTransfersAdmin";
import FamilyBalanceCard from "./FamilyBalanceCard";
import FamilyBalanceHistoryAdmin from "./FamilyBalanceHistoryAdmin";
import Statistics from "./Statistics";
import { getMemberSpend, loadAccounts, groupAccounts, latestLbpRate, createInvite, bal } from "../lib/wallets";
import { getFamilyBudgetSpend } from "../lib/budgets";
import { isAdmin, isSuperadmin } from "../lib/roles";
import { formatUsd, formatLbp, formatTime } from "../lib/format";

const PAGE_SIZE = 20; // FR13 — load 20 at a time, not the full history
const ACTIVITY_LIMIT = 10;

function ProfileMenuButton({
  myMember,
  myRole,
  amAdmin,
  showSettings,
  onOpenSettings,
  onSignOut,
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  if (!myMember) return null;

  const initials =
    (myMember.display_name || "U")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U";

  return (
    <div className="profile-menu-wrap" ref={menuRef}>
      <button
        type="button"
        className={`profile-trigger role-${myRole || myMember.role}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="profile-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="profile-trigger-text">
          <span className="profile-name">{myMember.display_name}</span>
          <span className={`profile-role ${myMember.role}`}>
            {myMember.role}
          </span>
        </span>
      </button>

      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-menu-header">
            <span className="profile-menu-name">{myMember.display_name}</span>
            <span className={`profile-role ${myMember.role}`}>
              {myMember.role}
            </span>
          </div>
          {showSettings && amAdmin && (
            <button
              type="button"
              className="profile-menu-action"
              onClick={() => {
                setOpen(false);
                onOpenSettings?.();
              }}
            >
              Settings
            </button>
          )}
          <button
            type="button"
            className="profile-menu-action"
            onClick={() => {
              setOpen(false);
              onSignOut?.();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ familyId }) {
  const { session } = useAuth();
  const [family, setFamily] = useState(null);
  const [members, setMembers] = useState([]);
  const [myMember, setMyMember] = useState(null);
  const [invite, setInvite] = useState(null);
  const [rawAccounts, setRawAccounts] = useState([]);
  const [rate, setRate] = useState(null);
  const [allMembers, setAllMembers] = useState([]);
  const [cards, setCards] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [txnPage, setTxnPage] = useState(0);
  const [hasMoreTxns, setHasMoreTxns] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mySpend, setMySpend] = useState(null);
  const [memberSpends, setMemberSpends] = useState({}); // memberId -> spend result, for admin view
  const [familyBudgetSpend, setFamilyBudgetSpend] = useState(null);
  const [breakdown, setBreakdown] = useState([]);
  const [plannedPayments, setPlannedPayments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [view, setView] = useState("home"); // 'home' | 'settings' | 'family' | 'me'
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showMyHistoryModal, setShowMyHistoryModal] = useState(false);
  const [showFamilyHistoryModal, setShowFamilyHistoryModal] = useState(false);
  const [myRecentTransactions, setMyRecentTransactions] = useState([]);
  const [commonReloadCounter, setCommonReloadCounter] = useState(0);
  const [balanceTransfersReloadCounter, setBalanceTransfersReloadCounter] =
    useState(0);

  function handleNavChange(key) {
    if (key === "family") setView("family");
    else if (key === "dashboard") setView("home");
    else if (key === "me") setView("me");
    else if (key === "statistics") setView("statistics");
  }
  const [showMyHistory, setShowMyHistory] = useState(false);

  // Kept in refs so the realtime callback (registered once) can look up
  // current names without re-subscribing every time members/categories change.
  const membersRef = useRef(members);
  const categoriesRef = useRef(categories);
  const myMemberRef = useRef(myMember);
  membersRef.current = members;
  categoriesRef.current = categories;
  myMemberRef.current = myMember;

  async function loadFamilyAndMembers() {
    const { data: fam } = await supabase
      .from("families")
      .select("*")
      .eq("id", familyId)
      .single();
    const { data: mem } = await supabase
      .from("members")
      .select("*")
      .eq("family_id", familyId);
    const { data: inv } = await supabase
      .from("family_invites")
      .select("*")
      .eq("family_id", familyId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const active = (mem || []).filter((m) => !m.removed_at);
    const resolvedMember = active.find((m) => m.user_id === session.user.id);

    setFamily(fam);
    setAllMembers(mem || []);
    setMembers(active);
    setMyMember(resolvedMember);
    setInvite(inv);

    loadMySpend(resolvedMember);
    loadAllMemberSpends(active);
    if (fam) loadFamilyBudget(fam);

    return resolvedMember;
  }

  async function loadWallet() {
    const [accts, r] = await Promise.all([loadAccounts(familyId), latestLbpRate(familyId)]);
    setRawAccounts(accts);
    setRate(r);
  }

  async function newInvite() {
    try {
      const inv = await createInvite(familyId);
      setInvite(inv);
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadCards() {
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("family_id", familyId)
      .order("created_at");
    setCards(data || []);
  }

  async function loadCategories() {
    const { data } = await supabase
      .from("categories")
      .select("*")
      .eq("family_id", familyId)
      .order("name");
    setCategories(data || []);
  }

  // reset=true reloads from page 0 (used on realtime updates / initial load).
  // reset=false appends the next page (used by "Load More", FR13).
  async function loadTransactions(reset = true) {
    const nextPage = reset ? 0 : txnPage + 1;
    const from = nextPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    if (!reset) setLoadingMore(true);

    const [{ data: normalRows }, { data: cardRows }] = await Promise.all([
      supabase
        .from("transactions")
        .select("*")
        .eq("family_id", familyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("card_transactions")
        .select("*")
        .eq("family_id", familyId)
        .order("created_at", { ascending: false }),
    ]);

    const normal = (normalRows || []).map((t) => ({
      ...t,
      kind: "transaction",
    }));
    const cards = (cardRows || []).map((t) => ({ ...t, kind: "card" }));
    const merged = [...normal, ...cards].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    const page = merged.slice(from, to + 1);
    setTransactions((prev) => (reset ? page : [...prev, ...page]));
    setHasMoreTxns(merged.length > to + 1);
    setTxnPage(nextPage);
    if (!reset) setLoadingMore(false);
  }

  // Dashboard "Last Records" preview: just the current member's 5 most
  // recent transactions, fetched independently of the family-wide,
  // paginated transactions list above so it's always correct regardless
  // of that list's current page.
  async function loadMyRecentTransactions(memberId) {
    if (!memberId) return;

    const [{ data: normalRows }, { data: cardRows }] = await Promise.all([
      supabase
        .from("transactions")
        .select("*")
        .eq("family_id", familyId)
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("card_transactions")
        .select("*")
        .eq("family_id", familyId)
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const rows = [
      ...(normalRows || []).map((t) => ({ ...t, kind: "transaction" })),
      ...(cardRows || []).map((t) => ({ ...t, kind: "card" })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    setMyRecentTransactions(rows.slice(0, 5));
  }

  async function loadBreakdown() {
    // Full-history aggregation for the category breakdown (FR21). At family
    // scale this is a small dataset; pagination above is only for the
    // transaction list, not this summary.
    const { data } = await supabase
      .from("transactions")
      .select("net_usd, amount, exchange_rate_to_base, categories(name)")
      .eq("family_id", familyId);

    const totals = {};
    for (const t of data || []) {
      const name = t.categories?.name ?? "Uncategorized";
      totals[name] =
        (totals[name] || 0) +
        (t.net_usd != null ? Number(t.net_usd) : t.amount * t.exchange_rate_to_base);
    }
    const { data: common } = await supabase
      .from("common_expenses")
      .select("net_usd, categories(name)")
      .eq("family_id", familyId);
    for (const c of common || []) {
      const name = c.categories?.name ?? "Common expenses";
      totals[name] = (totals[name] || 0) + Number(c.net_usd);
    }
    setBreakdown(Object.entries(totals).sort((a, b) => b[1] - a[1]));
  }

  async function loadMySpend(currentMember) {
    if (!currentMember) return;
    const spend = await getMemberSpend(familyId, currentMember);
    setMySpend(spend);
  }

  async function loadAllMemberSpends(currentMembers) {
    const entries = await Promise.all(
      (currentMembers || []).map(async (m) => [
        m.id,
        await getMemberSpend(familyId, m),
      ]),
    );
    setMemberSpends(Object.fromEntries(entries));
  }

  async function loadFamilyBudget(currentFamily) {
    const spend = await getFamilyBudgetSpend(familyId, currentFamily);
    setFamilyBudgetSpend(spend);
  }

  async function loadPlannedPayments() {
    const { data } = await supabase
      .from("planned_payments")
      .select("*")
      .eq("family_id", familyId)
      .eq("is_active", true);
    setPlannedPayments(data || []);
  }

  // Only admins/superadmins can actually read rows here (RLS) — for a
  // regular member this just resolves to an empty list, which is fine since
  // only admins render the NotificationBell.
  async function loadNotifications() {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifications(data || []);
  }

  useEffect(() => {
    if (myMember?.id) loadMyRecentTransactions(myMember.id);
  }, [myMember?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      await Promise.all([
        loadFamilyAndMembers(),
        loadWallet(),
        loadCards(),
        loadCategories(),
        loadTransactions(),
        loadBreakdown(),
        loadPlannedPayments(),
        loadNotifications(),
      ]);
    }
    if (!cancelled) loadAll();

    // Realtime: members joining, wallet balance changing, new transactions/deposits (FR9, FR22)
    const channel = supabase
      .channel(`family-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "members",
          filter: `family_id=eq.${familyId}`,
        },
        loadFamilyAndMembers,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cards",
          filter: `family_id=eq.${familyId}`,
        },
        loadCards,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wallet_accounts",
          filter: `family_id=eq.${familyId}`,
        },
        loadWallet,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transactions",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          loadTransactions();
          loadBreakdown();
          loadFamilyAndMembers(); // also refreshes mySpend + memberSpends + family budget spend
          if (myMemberRef.current?.id) {
            loadMyRecentTransactions(myMemberRef.current.id);
          }

          // In-app "notify me when someone spends" — no push infra, rides
          // this same realtime channel. Only new spends generate an entry.
          if (payload.eventType === "INSERT") {
            const row = payload.new;
            const member = membersRef.current.find(
              (m) => m.id === row.member_id,
            );
            const category = categoriesRef.current.find(
              (c) => c.id === row.category_id,
            );
            setActivity((prev) =>
              [
                {
                  id: row.id,
                  memberName: member?.display_name ?? "Someone",
                  amount: row.net_usd ?? row.amount,
                  currency: row.net_usd != null ? "USD" : row.currency,
                  categoryName: category?.name ?? null,
                  timeLabel: formatTime(row.created_at),
                },
                ...prev,
              ].slice(0, ACTIVITY_LIMIT),
            );
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "card_transactions",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          loadTransactions();
          loadCards();
          loadFamilyAndMembers();
          if (myMemberRef.current?.id) {
            loadMyRecentTransactions(myMemberRef.current.id);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deposits",
          filter: `family_id=eq.${familyId}`,
        },
        loadTransactions,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "planned_payments",
          filter: `family_id=eq.${familyId}`,
        },
        loadPlannedPayments,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `family_id=eq.${familyId}`,
        },
        loadNotifications,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transfers",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          loadWallet();
          loadTransactions();
          setBalanceTransfersReloadCounter((current) => current + 1);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "exchanges",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          loadWallet();
          setBalanceTransfersReloadCounter((current) => current + 1);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "common_expenses", filter: `family_id=eq.${familyId}` },
        () => {
          loadWallet();
          loadBreakdown();
          setCommonReloadCounter((c) => c + 1);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "common_bills", filter: `family_id=eq.${familyId}` },
        () => setCommonReloadCounter((c) => c + 1),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [familyId, session.user.id]);

  if (!family) {
    return (
      <div className="loading-screen">
        <p className="status">Loading family...</p>
        <button
          type="button"
          className="link-btn"
          onClick={() => supabase.auth.signOut()}
        >
          Sign out
        </button>
      </div>
    );
  }

  const myRole = myMember?.role;
  const amAdmin = isAdmin(myRole);
  const amSuperadmin = isSuperadmin(myRole);

  const accounts = groupAccounts(rawAccounts);
  const myWallets = myMember ? accounts.members[myMember.id] || {} : {};

  if (view === "settings" && amAdmin) {
    return (
      <div className="dashboard">
        <header>
          <button
            type="button"
            className="back-btn"
            onClick={() => setView("home")}
          >
            &larr;
          </button>
          <h1>Settings</h1>
          <ProfileMenuButton
            myMember={myMember}
            myRole={myRole}
            amAdmin={amAdmin}
            showSettings={false}
            onSignOut={() => supabase.auth.signOut()}
          />
        </header>

        <section className="card">
          <h2>Exchange rate</h2>
          <p className="hint">
            For informal/parallel-market currencies (e.g. LBP). Enter one
            direction — the reverse rate is derived and stored automatically.
            Stays in effect until you set a new rate (doesn't reset daily).
          </p>
          <ExchangeRateOverride
            familyId={familyId}
            memberId={myMember.id}
            baseCurrency="USD"
          />
        </section>

        <section className="card">
          <h2>Budgets &amp; limits</h2>
          <AdminSettings
            familyId={familyId}
            family={family}
            members={members}
            categories={categories}
            memberSpends={memberSpends}
            amSuperadmin={amSuperadmin}
            myMemberId={myMember.id}
            onDone={() => {
              loadFamilyAndMembers();
              loadCategories();
            }}
          />
        </section>

        <section className="card">
          <h2>Money movements</h2>
          <p className="hint">
            Every transfer between the pool, members and cards, and every
            exchange. Fix a mistake by deleting it and entering it again.
          </p>
          <BalanceTransfersAdmin
            familyId={familyId}
            rawAccounts={rawAccounts}
            members={allMembers}
            cards={cards}
            reloadTrigger={balanceTransfersReloadCounter}
            onChanged={() => {
              loadFamilyAndMembers();
              if (myMember?.id) loadMyRecentTransactions(myMember.id);
            }}
          />
        </section>

        <section className="card">
          <h2>Family balance history</h2>
          <p className="hint">
            Every deposit into the family pool. Admins can delete a deposit that
            was entered by mistake.
          </p>
          <FamilyBalanceHistoryAdmin
            familyId={familyId}
            onChanged={() => {
              loadWallet();
              loadFamilyAndMembers();
            }}
          />
        </section>

        <BottomNav
          active="dashboard"
          onChange={handleNavChange}
          onAddClick={() => setShowAddSheet(true)}
        />
        {showAddSheet && (
          <AddActionSheet
            familyId={familyId}
            memberId={myMember.id}
            categories={categories}
            accounts={accounts}
            amAdmin={amAdmin}
            onClose={() => setShowAddSheet(false)}
            onDone={() => {
              loadFamilyAndMembers();
              loadTransactions();
              loadMyRecentTransactions(myMember.id);
              setBalanceTransfersReloadCounter((current) => current + 1);
            }}
          />
        )}
      </div>
    );
  }

  if (view === "family") {
    return (
      <div className="dashboard">
        <header>
          <div>
            <h1>Family</h1>
            <p className="subtitle">{family.name}</p>
          </div>
          <div className="header-actions">
            {amAdmin && (
              <NotificationBell
                familyId={familyId}
                userId={session.user.id}
                notifications={notifications}
                cards={cards}
                members={members}
                role={myRole}
              />
            )}
            <ProfileMenuButton
              myMember={myMember}
              myRole={myRole}
              amAdmin={amAdmin}
              showSettings={amAdmin}
              onOpenSettings={() => setView("settings")}
              onSignOut={() => supabase.auth.signOut()}
            />
          </div>
        </header>

        <FamilyBalanceCard accounts={accounts} rate={rate || 0} />

        {familyBudgetSpend && (
          <section className="card">
            <h2>Family Budget ({familyBudgetSpend.period})</h2>
            <div className="breakdown-row">
              <span>Used</span>
              <span>
                {formatUsd(familyBudgetSpend.spent)} / {formatUsd(familyBudgetSpend.limit)}
              </span>
            </div>
            <div className="breakdown-bar-track">
              <div
                className={`breakdown-bar ${
                  familyBudgetSpend.isOverLimit
                    ? "over"
                    : familyBudgetSpend.isNearLimit
                      ? "near"
                      : ""
                }`}
                style={{
                  width: `${Math.min(familyBudgetSpend.percentUsed * 100, 100)}%`,
                }}
              />
            </div>
            <p className="hint">
              This is a target the admin set, separate from actual cash above.
            </p>
          </section>
        )}

        <section className="card">
          <h2>Members ({members.length})</h2>
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.id}>
                <span>{m.display_name}</span>
                <span className="member-list-right">
                  <span className="member-balance">
                    {formatUsd(bal(accounts.members[m.id]?.USD))} ·{" "}
                    {formatLbp(bal(accounts.members[m.id]?.LBP))}
                  </span>
                  <span className={`badge ${m.role}`}>{m.role}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {amAdmin && invite && (
          <section className="card">
            <h2>Invite code</h2>
            <p className="invite-code">{invite.code}</p>
            <p className="hint">
              Share this with family members so they can join. A code works once.
            </p>
            <button type="button" className="link-button" onClick={newInvite}>New code</button>
          </section>
        )}
        {amAdmin && !invite && (
          <section className="card">
            <h2>Invite code</h2>
            <button type="button" onClick={newInvite}>Create invite code</button>
          </section>
        )}

        <CardsSection
          familyId={familyId}
          memberId={myMember?.id}
          cards={cards}
          accounts={accounts}
          members={members}
          amAdmin={amAdmin}
          amSuperadmin={amSuperadmin}
          onChanged={() => {
            loadCards();
            loadFamilyAndMembers();
          }}
        />

        <CommonExpenses
          familyId={familyId}
          members={members}
          categories={categories}
          amAdmin={amAdmin}
          accounts={accounts}
          cards={cards}
          reloadTrigger={commonReloadCounter}
          onChanged={loadWallet}
        />

        {amAdmin && (
          <section className="card">
            <h2>Add funds</h2>
            <DepositForm
              familyId={familyId}
              accounts={accounts}
              onDone={loadWallet}
            />
          </section>
        )}

        <section className="card">
          <div className="card-header-row">
            <h2>Family expenses</h2>
            {transactions.length > 0 && (
              <button
                type="button"
                className="link-button"
                onClick={() => setShowFamilyHistoryModal(true)}
              >
                More
              </button>
            )}
          </div>
          {transactions.length === 0 && (
            <p className="hint">No transactions yet.</p>
          )}
          <ul className="txn-list">
            {transactions.slice(0, 8).map((t) => (
              <TransactionRow
                key={t.id}
                t={t}
                categories={categories}
                members={allMembers}
                canManage={t.member_id === myMember?.id || amAdmin}
                onChanged={() => {
                  loadTransactions();
                  loadBreakdown();
                  loadFamilyAndMembers();
                  if (myMember?.id) loadMyRecentTransactions(myMember.id);
                }}
              />
            ))}
          </ul>
        </section>

        {showFamilyHistoryModal && (
          <TransactionHistoryModal
            familyId={familyId}
            viewerId={myMember?.id}
            categories={categories}
            members={allMembers}
            amAdmin={amAdmin}
            onClose={() => setShowFamilyHistoryModal(false)}
          />
        )}

        <section className="card">
          <h2>Recent activity</h2>
          <ActivityFeed events={activity} />
        </section>

        <BottomNav
          active="family"
          onChange={handleNavChange}
          onAddClick={() => setShowAddSheet(true)}
        />
        {showAddSheet && myMember && (
          <AddActionSheet
            familyId={familyId}
            memberId={myMember.id}
            categories={categories}
            accounts={accounts}
            amAdmin={amAdmin}
            onClose={() => setShowAddSheet(false)}
            onDone={() => {
              loadFamilyAndMembers();
              loadTransactions();
              loadMyRecentTransactions(myMember.id);
            }}
          />
        )}
      </div>
    );
  }

  if (view === "me") {
    return (
      <div className="dashboard">
        <header>
          <div>
            <h1>Me</h1>
            <p className="subtitle">{myMember?.display_name}</p>
          </div>
          <div className="header-actions">
            <ProfileMenuButton
              myMember={myMember}
              myRole={myRole}
              amAdmin={amAdmin}
              showSettings={amAdmin}
              onOpenSettings={() => setView("settings")}
              onSignOut={() => supabase.auth.signOut()}
            />
          </div>
        </header>

        <MeProfileCard
          myMember={myMember}
          session={session}
          family={family}
          myRole={myRole}
          onSaved={loadFamilyAndMembers}
        />

        <section className="card">
          <h2>My transactions</h2>
          <p className="hint">
            Your full expense history, with filters by category, date, or note.
          </p>
          <button
            type="button"
            className="link-button"
            onClick={() => setShowMyHistoryModal(true)}
          >
            View My Transaction History
          </button>
        </section>

        <button className="signout" onClick={() => supabase.auth.signOut()}>
          Sign Out
        </button>

        <BottomNav
          active="me"
          onChange={handleNavChange}
          onAddClick={() => setShowAddSheet(true)}
        />
        {showAddSheet && myMember && (
          <AddActionSheet
            familyId={familyId}
            memberId={myMember.id}
            categories={categories}
            accounts={accounts}
            amAdmin={amAdmin}
            onClose={() => setShowAddSheet(false)}
            onDone={() => {
              loadFamilyAndMembers();
              loadTransactions();
              loadMyRecentTransactions(myMember.id);
            }}
          />
        )}

        {showMyHistoryModal && myMember && (
          <TransactionHistoryModal
            familyId={familyId}
            memberId={myMember.id}
            viewerId={myMember.id}
            categories={categories}
            members={allMembers}
            amAdmin={amAdmin}
            onClose={() => setShowMyHistoryModal(false)}
          />
        )}
      </div>
    );
  }

  if (view === "statistics") {
    return (
      <div className="dashboard">
        <header>
          <button
            type="button"
            className="back-btn"
            onClick={() => setView("home")}
          >
            &larr;
          </button>
          <h1>Statistics</h1>
          <ProfileMenuButton
            myMember={myMember}
            myRole={myRole}
            amAdmin={amAdmin}
            showSettings={amAdmin}
            onOpenSettings={() => setView("settings")}
            onSignOut={() => supabase.auth.signOut()}
          />
        </header>

        <Statistics familyId={familyId} />

        <BottomNav
          active="statistics"
          onChange={handleNavChange}
          onAddClick={() => setShowAddSheet(true)}
        />
        {showAddSheet && myMember && (
          <AddActionSheet
            familyId={familyId}
            memberId={myMember.id}
            categories={categories}
            accounts={accounts}
            amAdmin={amAdmin}
            onClose={() => setShowAddSheet(false)}
            onDone={() => {
              loadFamilyAndMembers();
              loadTransactions();
              loadMyRecentTransactions(myMember.id);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header>
        <div>
          <h1>{family.name}</h1>
          <p className="subtitle">Wallets in USD and LBP</p>
        </div>
        <div className="header-actions">
          {amAdmin && (
            <NotificationBell
              familyId={familyId}
              userId={session.user.id}
              notifications={notifications}
              members={members}
              cards={cards}
              role={myRole}
            />
          )}
          <ProfileMenuButton
            myMember={myMember}
            myRole={myRole}
            amAdmin={amAdmin}
            showSettings={amAdmin}
            onOpenSettings={() => setView("settings")}
            onSignOut={() => supabase.auth.signOut()}
          />
        </div>
      </header>

      <LimitWarningBanner spend={mySpend} />

      {myMember && (
        <section className="card">
          <h2>My wallets</h2>
          <p className="balance">{formatUsd(bal(myWallets.USD))}</p>
          <p className="balance">{formatLbp(bal(myWallets.LBP))}</p>
          <p className="hint">
            Your own money, taken from the family pool. Expenses draw from
            these two wallets.
          </p>
        </section>
      )}

      {mySpend && (
        <section className="card">
          <h2>My spending this period ({mySpend.period})</h2>
          <p className="balance">
            {formatUsd(mySpend.spent)} / {formatUsd(mySpend.limit)}
          </p>
          <p className="hint">
            How much you've drawn from the family budget so far this period.
          </p>
        </section>
      )}

      {myMember && categories.length > 0 && (
        <section className="card">
          <h2>Upcoming bills</h2>
          <PlannedPayments
            familyId={familyId}
            memberId={myMember.id}
            categories={categories}
            payments={plannedPayments}
            onDone={() => {
              loadPlannedPayments();
              loadTransactions();
              loadBreakdown();
              loadFamilyAndMembers();
            }}
          />
        </section>
      )}

      <section className="card">
        <div className="card-header-row">
          <h2>Recent expenses</h2>
          {myRecentTransactions.length > 0 && (
            <button
              type="button"
              className="link-button"
              onClick={() => setShowMyHistoryModal(true)}
            >
              More
            </button>
          )}
        </div>
        {myRecentTransactions.length === 0 && (
          <p className="hint">No transactions yet.</p>
        )}
        <ul className="txn-list">
          {myRecentTransactions.map((t) => (
            <TransactionRow
              key={t.id}
              t={t}
              categories={categories}
              members={allMembers}
              canManage={t.member_id === myMember?.id || amAdmin}
              onChanged={() => {
                loadTransactions();
                loadBreakdown();
                loadFamilyAndMembers();
                if (myMember?.id) loadMyRecentTransactions(myMember.id);
              }}
            />
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Category breakdown</h2>
        {breakdown.length === 0 && <p className="hint">No spending yet.</p>}
        <ul className="breakdown-list">
          {breakdown.map(([name, total]) => {
            const max = breakdown[0]?.[1] || 1;
            return (
              <li key={name}>
                <div className="breakdown-row">
                  <span>{name}</span>
                  <span>
                    {formatUsd(total)}
                  </span>
                </div>
                <div className="breakdown-bar-track">
                  <div
                    className="breakdown-bar"
                    style={{ width: `${(total / max) * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <BottomNav
        active="dashboard"
        onChange={handleNavChange}
        onAddClick={() => setShowAddSheet(true)}
      />
      {showAddSheet && myMember && (
        <AddActionSheet
          familyId={familyId}
          memberId={myMember.id}
          categories={categories}
          accounts={accounts}
          amAdmin={amAdmin}
          onClose={() => setShowAddSheet(false)}
          onDone={() => {
            loadFamilyAndMembers();
            loadTransactions();
            loadMyRecentTransactions(myMember.id);
          }}
        />
      )}

      {showMyHistoryModal && myMember && (
        <TransactionHistoryModal
          familyId={familyId}
          memberId={myMember.id}
          viewerId={myMember.id}
          categories={categories}
          members={allMembers}
          amAdmin={amAdmin}
          onClose={() => setShowMyHistoryModal(false)}
        />
      )}
    </div>
  );
}
