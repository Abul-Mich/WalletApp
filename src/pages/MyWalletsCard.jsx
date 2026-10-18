import { useState } from "react";
import { bal } from "../lib/wallets";
import { formatUsd, formatLbp } from "../lib/format";
import MemberBalanceTransfer from "./MemberBalanceTransfer";
import AddToMainBalanceForm from "./AddToMainBalanceForm";

// The member's own two wallets. The + button moves money between the family pool and these wallets.
export default function MyWalletsCard({ memberId, accounts, wallets, onChanged }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("take");

  function done() {
    setOpen(false);
    onChanged?.();
  }

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>My wallets</h2>
        <button type="button" className="icon-btn" aria-label="Move money between the pool and my wallets" title="Take from or return to the pool" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      <p className="balance">{formatUsd(bal(wallets.USD))}</p>
      <p className="balance">{formatLbp(bal(wallets.LBP))}</p>
      <p className="hint">
        Your own money, taken from the family pool. Expenses draw from these two wallets.
      </p>

      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sf-sheet-head">
              <div className="sf-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "take"} className={tab === "take" ? "on" : ""} onClick={() => setTab("take")}>Take from pool</button>
                <button type="button" role="tab" aria-selected={tab === "return"} className={tab === "return" ? "on" : ""} onClick={() => setTab("return")}>Return to pool</button>
              </div>
              <button type="button" className="sheet-close" aria-label="Close" onClick={() => setOpen(false)}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="sheet-body">
              {tab === "take" && <MemberBalanceTransfer memberId={memberId} accounts={accounts} onDone={done} />}
              {tab === "return" && <AddToMainBalanceForm memberId={memberId} accounts={accounts} onDone={done} />}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
