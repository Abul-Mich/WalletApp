import { useRef, useState } from "react";
import TransactionRow from "./TransactionRow";
import FamilyBalanceCard from "./FamilyBalanceCard";
import CardsSection from "./CardsSection";
import CommonExpenses from "./CommonExpenses";
import { EditSheet } from "../components/RecordFields";
import { bal } from "../lib/wallets";
import { formatUsd, formatLbp } from "../lib/format";

const TABS = [
  { key: "members", label: "Members" },
  { key: "cards", label: "Cards" },
  { key: "shared", label: "Shared" },
  { key: "activity", label: "Activity" },
];

function readTab() {
  try {
    const t = localStorage.getItem("fw:famtab");
    if (TABS.some((x) => x.key === t)) return t;
  } catch { /* ignore */ }
  return "members";
}

// Everything you tap on this page (the tabs and the one main action) lives in a bar just above the bottom
// navigation, so the page works with one thumb. The top of the page is only for reading.
export default function FamilyPage({
  familyId, myMember, members, memberSpends, allMembers, accounts, rate, amAdmin, amSuperadmin, familyBudgetSpend,
  cards, categories, transactions, commonReloadCounter, invite, newInvite,
  loadWallet, loadCards, loadFamilyAndMembers, loadTransactions, loadMyRecentTransactions,
  onOpenBills, onAddSharedCost, onOpenHistory,
}) {
  const [tab, setTabState] = useState(readTab);
  const [newCardSignal, setNewCardSignal] = useState(0);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);

  function setTab(k) {
    setTabState(k);
    try { localStorage.setItem("fw:famtab", k); } catch { /* ignore */ }
  }

  // One button at the end of every section. Members, cards and shared costs are admin actions.
  const action = (() => {
    if (tab === "members" && amAdmin) return { label: "Invite someone", run: () => setShowInvite(true) };
    if (tab === "cards" && amAdmin) return { label: "New card", run: () => setNewCardSignal((n) => n + 1) };
    if (tab === "shared" && amAdmin) return { label: "Add a shared cost", run: onAddSharedCost };
    if (tab === "activity" && transactions.length > 0) return { label: "See all spending", run: onOpenHistory };
    return null;
  })();

  // Swipe sideways to change section (ignored when the finger moves mostly up or down, i.e. scrolling).
  const touch = useRef(null);
  function onTouchStart(e) {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
    const i = TABS.findIndex((x) => x.key === tab);
    const next = TABS[i + (dx < 0 ? 1 : -1)];
    if (next) setTab(next.key);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable: the code is on screen */ }
  }

  return (
    <>
      <FamilyBalanceCard accounts={accounts} rate={rate || 0} familyId={familyId} amAdmin={amAdmin} budget={familyBudgetSpend} onChanged={loadWallet} />

      <div className="fam-tabs" role="tablist" aria-label="Family sections">
        <div className="fam-tabs-seg">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="fam-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {tab === "members" && (
        <section className="fam-members" aria-label="Members">
          {members.map((m) => {
            const sp = memberSpends?.[m.id];
            const state = sp ? (sp.isOverLimit ? "over" : sp.isNearLimit ? "near" : "") : "";
            return (
              <div className="fam-member" key={m.id}>
                <div className="fam-avatar" aria-hidden="true">{(m.display_name || "?").trim().charAt(0).toUpperCase()}</div>
                <div className="fam-member-main">
                  <div className="fam-member-name">
                    <span>{m.display_name}</span>
                    <span className={`badge ${m.role}`}>{m.role}</span>
                  </div>
                  {sp && (
                    <>
                      <div className="fam-limit-track"><div className={`fam-limit-bar ${state}`} style={{ width: `${Math.min(sp.percentUsed * 100, 100)}%` }} /></div>
                      <span className={`fam-limit-text ${state}`}>
                        {formatUsd(sp.spent)} of {formatUsd(sp.limit)} this {sp.period === "weekly" ? "week" : "month"}
                      </span>
                    </>
                  )}
                </div>
                <div className="fam-member-money">
                  <strong>{formatUsd(bal(accounts.members[m.id]?.USD))}</strong>
                  <span>{formatLbp(bal(accounts.members[m.id]?.LBP))}</span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {tab === "cards" && (
        <CardsSection
          familyId={familyId} memberId={myMember?.id} cards={cards} accounts={accounts} members={members}
          categories={categories} amAdmin={amAdmin} amSuperadmin={amSuperadmin}
          newSignal={newCardSignal} dock
          onChanged={() => { loadCards(); loadFamilyAndMembers(); }}
        />
      )}

      {tab === "shared" && (
        <CommonExpenses
          familyId={familyId} members={members} categories={categories} amAdmin={amAdmin} accounts={accounts} cards={cards}
          reloadTrigger={commonReloadCounter} onChanged={loadWallet} onOpenBills={onOpenBills}
        />
      )}

      {tab === "activity" && (
        <section className="fam-list" aria-label="Members' spending">
          <h3 className="fam-section-title">Latest spending</h3>
          {transactions.length === 0 && <p className="fam-empty">Nothing spent yet. New expenses from every member show up here.</p>}
          <ul className="txn-list">
            {transactions.slice(0, 8).map((t) => (
              <TransactionRow
                key={t.id} t={t} categories={categories} members={allMembers}
                canManage={t.member_id === myMember?.id || amAdmin}
                onChanged={() => {
                  loadTransactions();
                  loadFamilyAndMembers();
                  if (myMember?.id) loadMyRecentTransactions(myMember.id);
                }}
              />
            ))}
          </ul>
        </section>
      )}


        {action && <button type="button" className="fam-end" onClick={action.run}>{action.label}</button>}
      </div>

      {showInvite && (
        <EditSheet title="Invite someone" onClose={() => setShowInvite(false)}>
          <div className="spend-form">
            <div className="sf-scroll">
              {invite ? (
                <>
                  <p className="invite-code">{invite.code}</p>
                  <p className="hint">Share this code with the person. A code works once.</p>
                </>
              ) : (
                <p className="hint">No invite code yet. Create one and share it with the person joining.</p>
              )}
            </div>
            <div className="sf-footer fam-invite-actions">
              {invite && <button type="button" className="btn btn-primary btn-block sf-submit" onClick={copyCode}>{copied ? "Copied" : "Copy code"}</button>}
              <button type="button" className={`btn ${invite ? "btn-secondary" : "btn-primary"} btn-block`} onClick={newInvite}>{invite ? "New code" : "Create invite code"}</button>
            </div>
          </div>
        </EditSheet>
      )}
    </>
  );
}
