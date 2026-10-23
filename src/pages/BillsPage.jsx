import { useMemo, useState } from "react";
import { formatUsd } from "../lib/format";
import { summarize, monthName, shortDay } from "../lib/bills";
import { totalUsd } from "../lib/wallets";
import { BillLine } from "./BillsCard";

const GROUPS = [
  { key: "late", title: "Overdue", tone: "late" },
  { key: "soon", title: "This week", tone: "soon" },
  { key: "later", title: "Later", tone: "later" },
];

// The Bills screen: what is left to pay this month, then every bill grouped by urgency.
export default function BillsPage({ items, paid, loaded, rate, amAdmin, accounts, memberId, onPay, onAdd }) {
  const [tab, setTab] = useState("all");
  const keep = (x) => tab === "all" || x.scope === tab;
  const list = useMemo(() => items.filter(keep), [items, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const paidList = useMemo(() => paid.filter(keep), [paid, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = summarize(list, paidList);
  const pct = s.monthTotalUsd > 0 ? Math.round((s.paidUsd / s.monthTotalUsd) * 100) : 0;
  const mine = totalUsd(accounts?.members?.[memberId] || {}, rate || 0);
  const pool = totalUsd(accounts?.pool || {}, rate || 0);
  const sum = (arr) => arr.reduce((a, b) => a + (b.usd || 0), 0);

  if (!loaded) return <p className="hint">Loading...</p>;

  return (
    <div className="bl-page">
      <div className="bl-title-row">
        <span>Everything you and the family need to pay</span>
        <button type="button" className="link-button" onClick={() => onAdd(tab === "family" ? "family" : "mine")}>Add a bill</button>
      </div>
      <div className="bl-summary">
        <div className="bl-sum-top"><span>{monthName()} bills</span><span>paid {formatUsd(s.paidUsd)} of {formatUsd(s.monthTotalUsd)}</span></div>
        <div className="bl-sum-main"><strong>{formatUsd(s.monthLeftUsd)}</strong><span>still to pay this month</span></div>
        <div className="bl-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        <span className="bl-sum-foot">
          Available: your wallet {formatUsd(mine)}{amAdmin && <> · family pool {formatUsd(pool)}</>}
        </span>
      </div>

      <div className="sf-seg bl-tabs" role="group" aria-label="Show">
        {[["all", "All"], ["mine", "Mine"], ["family", "Family"]].map(([k, l]) => (
          <button key={k} type="button" className={tab === k ? "on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {list.length === 0 && (
        <div className="empty-state">
          <p>{tab === "family" && !amAdmin ? "No family bills yet. An admin can add them." : "No bills here yet."}</p>
          {(tab !== "family" || amAdmin) && <button type="button" className="btn btn-primary" onClick={() => onAdd(tab === "family" ? "family" : "mine")}>Add a bill</button>}
        </div>
      )}

      {GROUPS.map((g) => {
        const rows = list.filter((b) => b.bucket === g.key);
        if (!rows.length) return null;
        return (
          <section key={g.key} className="bl-group">
            <div className={`bl-group-head ${g.tone}`}><span>{g.title}</span><span>{formatUsd(sum(rows))}</span></div>
            <div className="bl-list">{rows.map((b) => <BillLine key={b.key} bill={b} onClick={() => onPay(b)} />)}</div>
          </section>
        );
      })}

      {paidList.length > 0 && (
        <section className="bl-group">
          <div className="bl-group-head paid"><span>Paid in {monthName()}</span><span>{formatUsd(s.paidUsd)}</span></div>
          <div className="bl-list">
            {paidList.map((p) => (
              <div key={p.key} className="bl-row bl-paid">
                <span className={`bl-dot ${p.scope}`} aria-hidden="true" />
                <span className="bl-main"><span className="bl-name">{p.name}</span><span className="bl-sub">{p.scope === "family" ? "Family" : "Mine"}</span></span>
                <span className="bl-side"><span className="bl-amt">{formatUsd(p.usd)}</span><span className="bl-chip paid">Paid {shortDay(p.date)}</span></span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
