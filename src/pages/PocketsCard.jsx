import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { bal, deleteIncome, INCOME_TYPES, loadPockets, createPocket, renamePocket, setPocketArchived, createTransfer, friendlyError } from "../lib/wallets";
import { formatMoney, formatUsd, formatLbp, formatShortDate, parseNumber } from "../lib/format";
import MoveMoneyView from "../components/MoveMoneyView";
import MemberBalanceTransfer from "./MemberBalanceTransfer";
import AddToMainBalanceForm from "./AddToMainBalanceForm";
import { useConfirm } from "../components/ConfirmSheet";

// "Your money": the main wallet (cash in hand) and the member's pockets as one swipeable,
// looping carousel. Tap the front card to open it. Pockets are named buckets carved out of the
// member's own money; spending still comes from the main wallet, and moving money between the
// two is neutral (never income, never spending).

export const POCKET_COLORS = ["#3ecf8e", "#eab04d", "#b58df2", "#ef8f5f", "#5bc0de"];
const MAIN_COLOR = "#5b8def";
const colorOf = (p) => p?.color || POCKET_COLORS[0];

// Same tint the prototype uses: the pocket colour mixed into the surface colour.
function mix(hex, k) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const base = [23, 26, 32];
  return `rgb(${[r, g, b].map((v, i) => Math.round(base[i] * (1 - k) + v * k)).join(",")})`;
}

const Icon = ({ d, extra }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    {extra}
  </svg>
);
const ICONS = {
  in: <Icon d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" />,
  out: <Icon d="M12 20V8m0 0l-4 4m4-4l4 4M5 4h14" />,
  plus: <Icon d="M12 5v14M5 12h14" />,
  clock: <Icon d="M12 8v4l3 2" extra={<circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />} />,
  swap: <Icon d="M7 7h11m0 0l-3-3m3 3l-3 3M17 17H6m0 0l3-3m-3 3l3 3" />,
  money: <Icon d="M4 8h16v9H4zM4 12h16M8 5.5l4-2.5 4 2.5" />,
};

// ---------- sheets ----------

function Sheet({ title, onClose, tall, children }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet pk-sheet ${tall ? "pk-tall" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="pk-sheet-head">
          <h2 className="pk-sheet-title">{title}</h2>
          <button type="button" className="pk-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="pk-sheet-body">{children}</div>
      </div>
    </div>
  );
}

function Swatches({ value, onChange }) {
  return (
    <div className="pk-swatches" role="group" aria-label="Colour">
      {POCKET_COLORS.map((c, i) => (
        <button key={c} type="button" className="pk-swatch-hit" aria-label={`Colour ${i + 1}`} aria-pressed={value === c} onClick={() => onChange(c)}>
          <span className={`pk-swatch ${value === c ? "on" : ""}`} style={{ background: c }} />
        </button>
      ))}
    </div>
  );
}

function PocketPreview({ name, currency, amount, color }) {
  return (
    <div className="pk-preview" style={{ background: mix(color, 0.22), borderColor: mix(color, 0.6) }}>
      <span className="pk-card-top">
        <span className="pk-card-name"><span className="pk-dot" style={{ background: color }} />{name || "New pocket"}</span>
        <span className="pk-card-tag">{currency}</span>
      </span>
      <span className="pk-preview-amt">{amount}</span>
    </div>
  );
}

function CreatePocketSheet({ familyId, wallets, taken = [], onClose, onCreated }) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [color, setColor] = useState(POCKET_COLORS[0]);
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const main = bal(wallets[currency]);
  const startNum = start.trim() ? parseNumber(start) : 0;
  const startBad = !Number.isFinite(startNum) || startNum < 0;
  const over = !startBad && startNum > main + 1e-9;
  const duplicate = taken.includes(name.trim().toLowerCase());
  const valid = name.trim().length > 0 && !startBad && !over && !duplicate;
  const shown = formatMoney(startBad ? 0 : startNum, currency);

  async function submit(e) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPocket({ familyId, name: name.trim(), currency, color, startAmount: startNum > 0 ? startNum : null });
      onCreated(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="New pocket" onClose={onClose} tall>
      <form onSubmit={submit} className="pk-form">
        <div className="pk-form-scroll">
          <PocketPreview name={name.trim()} currency={currency} amount={shown} color={color} />
          <label className="pk-field">
            <span className="pk-label">Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Emergency fund, Trip, Home reserve" maxLength={40} autoFocus aria-invalid={duplicate} />
            {duplicate && <span className="pk-err" role="alert">You already have a pocket called "{name.trim()}". Choose another name.</span>}
          </label>
          <div className="pk-field">
            <span className="pk-label">Currency</span>
            <div className="pk-seg" role="group" aria-label="Currency">
              {["USD", "LBP"].map((c) => (
                <button key={c} type="button" className={currency === c ? "on" : ""} aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c}</button>
              ))}
            </div>
          </div>
          <div className="pk-field">
            <span className="pk-label">Color</span>
            <Swatches value={color} onChange={setColor} />
          </div>
          <div className="pk-field">
            <span className="pk-label">Starting amount (optional)</span>
            <div className="pk-amount">
              <input type="text" inputMode="decimal" autoComplete="off" placeholder="0" value={start} onChange={(e) => setStart(e.target.value)} aria-label={`Starting amount in ${currency}`} />
              <button type="button" className="pk-max" onClick={() => setStart(String(Math.round(main * 100) / 100))}>Max</button>
            </div>
            <div className="pk-after">
              <span>Main wallet after</span>
              <strong className={over ? "bad" : ""}>{over ? `Only ${formatMoney(main, currency)} available` : formatMoney(main - (startBad ? 0 : startNum), currency)}</strong>
            </div>
            <span className="pk-note">Taken from your main wallet. This moves your money, it does not add any.</span>
          </div>
          {error && <p className="status error" role="alert">{error}</p>}
        </div>
        <div className="pk-foot">
          <button type="submit" className="pk-cta" disabled={busy || !valid}>{busy ? "Working..." : "Create pocket"}</button>
        </div>
      </form>
    </Sheet>
  );
}

function EditPocketSheet({ pocket, acct, taken = [], onClose, onDone }) {
  const [name, setName] = useState(pocket.name);
  const [color, setColor] = useState(colorOf(pocket));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const empty = bal(acct) === 0;
  const duplicate = name.trim().toLowerCase() !== pocket.name.toLowerCase() && taken.includes(name.trim().toLowerCase());
  const changed = name.trim() !== pocket.name || color !== colorOf(pocket);

  async function save(e) {
    e.preventDefault();
    if (!name.trim() || !changed) return;
    setBusy(true);
    setError(null);
    try {
      await renamePocket({ id: pocket.id, name: name.trim(), color });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await setPocketArchived({ id: pocket.id, archived: true });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Edit pocket" onClose={onClose} tall>
      <form onSubmit={save} className="pk-form">
        <div className="pk-form-scroll">
          <PocketPreview name={name.trim()} currency={pocket.currency} amount={formatMoney(bal(acct), pocket.currency)} color={color} />
          <label className="pk-field">
            <span className="pk-label">Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-invalid={duplicate} />
            {duplicate && <span className="pk-err" role="alert">You already have a pocket called "{name.trim()}". Choose another name.</span>}
          </label>
          <div className="pk-field">
            <span className="pk-label">Color</span>
            <Swatches value={color} onChange={setColor} />
          </div>
          {error && <p className="status error" role="alert">{error}</p>}
          <div className="pk-field">
            <button type="button" className="btn btn-danger btn-sm pk-archive" disabled={busy || !empty} onClick={archive}>Archive pocket</button>
            <span className="pk-note">{empty ? "It is empty, so it can be archived." : "Move the money out first, then you can archive it."}</span>
          </div>
        </div>
        <div className="pk-foot">
          <button type="submit" className="pk-cta" disabled={busy || !changed || !name.trim() || duplicate}>{busy ? "Working..." : "Save"}</button>
        </div>
      </form>
    </Sheet>
  );
}

// "Move to a pocket" / "From main wallet" / "To main wallet" -- one amount screen, destination list on top for the first.
function MoveSheet({ dir, pocketId, pockets, accounts, wallets, familyId, onPick, onNew, onClose, onDone }) {
  const pocket = pockets.find((p) => p.id === pocketId) || null;
  const acct = pocket ? accounts.pockets?.[pocket.id] : null;
  const main = pocket ? wallets[pocket.currency] : null;
  const submit = ({ from, to, amount }) => createTransfer({ from: from.id, to: to.id, amount });
  const title = dir === "toPocket" ? "Move to a pocket" : dir === "fromMain" ? `Move to ${pocket?.name}` : "Move to main wallet";

  const resolve = () =>
    dir === "toMain"
      ? { sources: acct ? [{ key: "p", label: pocket.name, acct }] : [], to: { label: "Main wallet", acct: main } }
      : { sources: main ? [{ key: "m", label: "Main wallet", acct: main }] : [], to: { label: pocket?.name, acct } };

  return (
    <Sheet title={title} onClose={onClose} tall>
      {dir === "toPocket" && (
        <div className="pk-dest">
          <span className="pk-label">To</span>
          {pockets.map((p) => (
            <button key={p.id} type="button" className={`pk-dest-row ${p.id === pocketId ? "on" : ""}`} onClick={() => onPick(p.id)}>
              <span className="pk-card-name"><span className="pk-dot" style={{ background: colorOf(p) }} />{p.name}</span>
              <span className="pk-dest-bal">{formatMoney(bal(accounts.pockets?.[p.id]), p.currency)}</span>
            </button>
          ))}
          <button type="button" className="pk-dest-new" onClick={onNew}>+ New pocket</button>
        </div>
      )}
      {pocket && (
        <MoveMoneyView
          key={`${dir}-${pocket.id}`} familyId={familyId} resolve={resolve} fixedCurrency={pocket.currency} fixedNoun="pocket"
          verb={(a) => (dir === "toMain" ? `Move ${a} to main wallet` : `Move ${a} to ${pocket.name}`)}
          note="Moving money is not spending. Your limit does not change."
          submit={submit} onDone={onDone}
        />
      )}
    </Sheet>
  );
}

function PoolSheet({ memberId, accounts, onClose, onDone }) {
  const [tab, setTab] = useState("take");
  return (
    <Sheet title="Family pool" onClose={onClose}>
      <div className="sf-tabs" role="tablist" style={{ marginBottom: 12 }}>
        <button type="button" role="tab" aria-selected={tab === "take"} className={tab === "take" ? "on" : ""} onClick={() => setTab("take")}>Take from pool</button>
        <button type="button" role="tab" aria-selected={tab === "return"} className={tab === "return" ? "on" : ""} onClick={() => setTab("return")}>Return to pool</button>
      </div>
      {tab === "take" ? <MemberBalanceTransfer memberId={memberId} accounts={accounts} onDone={onDone} /> : <AddToMainBalanceForm memberId={memberId} accounts={accounts} onDone={onDone} />}
    </Sheet>
  );
}

// The sheet that opens from the front card: balance, actions, recent movements.
function OpenSheet({ item, pockets, rawAccounts, cards, accounts, acct, onClose, onAction, onChangedInside, reloadKey }) {
  const [moves, setMoves] = useState(null);
  const [all, setAll] = useState(false);
  const isMain = item.kind === "main";
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    let live = true;
    const ids = isMain ? [item.accts.USD?.id, item.accts.LBP?.id].filter(Boolean) : [acct?.id].filter(Boolean);
    if (!ids.length) { setMoves([]); return; }
    const mine = new Set(ids);
    const label = (accId) => {
      const a = rawAccounts.find((x) => x.id === accId);
      if (!a) return "another wallet";
      if (a.owner_kind === "pool") return "Family pool";
      if (a.owner_kind === "member") return "main wallet";
      if (a.owner_kind === "pocket") return pockets.find((p) => p.id === a.pocket_id)?.name || "a pocket";
      return cards.find((c) => c.id === a.card_id)?.name || "a card";
    };
    Promise.all([
      supabase.from("transfers").select("*")
        .or(ids.map((id) => `from_account_id.eq.${id},to_account_id.eq.${id}`).join(","))
        .order("created_at", { ascending: false }).limit(30),
      supabase.from("deposits").select("*")
        .in("account_id", ids).order("created_at", { ascending: false }).limit(30),
    ]).then(([tr, dp]) => {
      if (!live) return;
      const rows = [];
      for (const t of tr.data || []) {
        const incoming = mine.has(t.to_account_id);
        const other = label(incoming ? t.from_account_id : t.to_account_id);
        const cur = rawAccounts.find((x) => x.id === t.to_account_id)?.currency;
        rows.push({ id: `t${t.id}`, at: t.created_at, title: incoming ? `Moved in from ${other}` : `Moved to ${other}`, amount: formatMoney(t.amount, cur) });
      }
      for (const d of dp.data || []) {
        const cur = d.currency || rawAccounts.find((x) => x.id === d.account_id)?.currency;
        const name = INCOME_TYPES.find((x) => x.key === d.kind)?.label;
        rows.push({
          id: `d${d.id}`, at: d.created_at, income: true, depositId: d.kind === "deposit" ? null : d.id,
          title: name ? `${name}, from outside` : "From outside", note: d.note, amount: `+${formatMoney(d.amount, cur)}`,
        });
      }
      rows.sort((a, b) => new Date(b.at) - new Date(a.at));
      setMoves(rows.slice(0, 30).map((r) => ({ ...r, date: formatShortDate(r.at) })));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key, acct?.balance_cache, reloadKey]);

  const actions = isMain
    ? [["plus", "Add expense", "expense"], ["money", "Add money", "income"], ["out", "To a pocket", "toPocket"], ["swap", "Pool", "pool"], ["clock", "History", "history"]]
    : [["in", "From main", "fromMain"], ["out", "To main", "toMain"], ["money", "Add money", "income"], ["clock", "History", "history"]];
  const shown = (moves || []).slice(0, all ? 30 : 3);

  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="pk-open-bal">{item.bal}{item.sub && <span>{item.sub}</span>}</div>
      <div className="pk-actions">
        {actions.map(([icon, label, key]) => (
          <button key={key} type="button" className={`pk-action ${key === "income" ? "pk-action-in" : ""}`} aria-label={label} onClick={() => (key === "history" && !isMain ? setAll(true) : onAction(key))}>
            <span className="pk-action-ico">{ICONS[icon]}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="pk-moves">
        <span className="pk-moves-title">{all ? "All movements" : "Recent movements"}</span>
        {moves === null && <p className="hint">Loading...</p>}
        {moves && moves.length === 0 && <p className="hint">Nothing yet. Money you move here shows up in this list.</p>}
        {shown.map((m) => (
          <div key={m.id} className="pk-move">
            <span><span className="pk-move-t">{m.title}</span><span className="pk-move-d">{m.date}{m.note ? ` · ${m.note}` : ""}</span></span>
            <span className={`pk-move-a ${m.income ? "pk-in" : ""}`}>
              {m.amount}
              {m.depositId && (
                <button type="button" className="pk-move-x" aria-label="Delete this entry" onClick={() => ask({
                  title: "Delete this entry?", detail: `${m.title} · ${m.amount}`, effect: "The money is taken out of this wallet again.", confirmLabel: "Delete",
                  onConfirm: async () => { await deleteIncome(m.depositId); onChangedInside(); },
                })}>×</button>
              )}
            </span>
          </div>
        ))}
        {!all && moves && moves.length > 3 && <button type="button" className="pk-more" onClick={() => setAll(true)}>Show more</button>}
      </div>
      {!isMain && <button type="button" className="pk-edit-link" onClick={() => onAction("edit")}>Rename or archive this pocket</button>}
      {dialog}
    </Sheet>
  );
}

// ---------- the carousel ----------

export default function PocketsCard({ familyId, memberId, accounts, rawAccounts = [], cards = [], wallets, rate, onChanged, onAddExpense, onAddMoney, onHistory }) {
  const [pockets, setPockets] = useState(null);
  const [sel, setSel] = useState(0);
  const [sheet, setSheet] = useState(null); // {type, ...}
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const start = useRef(null);
  const moved = useRef(false);

  async function reload() {
    try {
      setPockets(await loadPockets(memberId));
      setLoadError(null);
    } catch (err) {
      setLoadError(friendlyError(err));
      setPockets((p) => p || []);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [memberId]);

  // The pockets table has no currency; it lives on the pocket's wallet account.
  const list = (pockets || []).filter((p) => !p.archived).map((p) => ({ ...p, currency: accounts.pockets?.[p.id]?.currency || "USD" }));
  const acctOf = (p) => accounts.pockets?.[p.id];

  const items = [
    { key: "main", kind: "main", name: "Main wallet", tag: "Cash in hand", color: MAIN_COLOR, accts: wallets,
      bal: formatUsd(bal(wallets.USD)), sub: formatLbp(bal(wallets.LBP)) },
    ...list.map((p) => ({ key: p.id, kind: "pocket", pocket: p, name: p.name, tag: p.currency, color: colorOf(p), bal: formatMoney(bal(acctOf(p)), p.currency), sub: `${p.currency} pocket` })),
    { key: "new", kind: "new", name: list.length ? "New pocket" : "Create your first pocket", sub: list.length ? "Set money aside, like a reserve or a trip fund" : "Set money aside for a trip, a reserve, a gift" },
  ];
  const n = items.length;
  const cur = Math.min(sel, n - 1);
  const rel = (i) => {
    if (n < 3) return i - cur;
    const half = Math.floor(n / 2);
    return ((i - cur + n + half) % n) - half;
  };
  const go = (to) => setSel(n < 3 ? Math.max(0, Math.min(n - 1, to)) : (to + n) % n);

  // "Your money" = main wallet + every pocket
  const tot = { USD: bal(wallets.USD), LBP: bal(wallets.LBP) };
  for (const p of list) tot[p.currency] += bal(acctOf(p));
  const about = rate > 0 ? tot.USD + tot.LBP / rate : null;

  function onDown(e) { start.current = e.clientX; moved.current = false; }
  function onUp(e) {
    if (start.current == null) return;
    const dx = e.clientX - start.current;
    start.current = null;
    if (Math.abs(dx) > 40) { moved.current = true; go(cur + (dx < 0 ? 1 : -1)); }
  }
  function pick(i) {
    if (moved.current) { moved.current = false; return; }
    if (i !== cur) return go(i);
    const it = items[i];
    setSheet(it.kind === "new" ? { type: "new" } : { type: "open", key: it.key });
  }

  function refresh(close = true) {
    if (close) setSheet(null);
    setReloadKey((k) => k + 1);
    reload();
    onChanged?.();
  }

  const openItem = sheet && ["open", "edit"].includes(sheet.type) ? items.find((i) => i.key === sheet.key) : null;
  const moveDir = sheet?.type === "move" ? sheet.dir : null;
  const movePocketId = sheet?.type === "move" ? sheet.pocketId : null;

  function onAction(key) {
    const it = openItem;
    if (key === "expense") { setSheet(null); onAddExpense?.(); }
    else if (key === "income") { setSheet(null); onAddMoney?.(it.kind === "main" ? "main" : `pocket:${it.key}`); }
    else if (key === "history") { setSheet(null); onHistory?.(); }
    else if (key === "pool") setSheet({ type: "pool" });
    else if (key === "toPocket") setSheet({ type: "move", dir: "toPocket", pocketId: list[0]?.id || null });
    else if (key === "fromMain" || key === "toMain") setSheet({ type: "move", dir: key, pocketId: it.key });
    else if (key === "edit") setSheet({ type: "edit", key: it.key });
  }

  return (
    <section className="pk-home" aria-label="Your money">
      <div className="pk-total">
        <span className="pk-total-label">Your money</span>
        <span className="pk-total-usd">{formatUsd(tot.USD)}</span>
        <span className="pk-total-sub">
          {tot.LBP !== 0 && <>+ {formatLbp(tot.LBP)}</>}
          {tot.LBP !== 0 && about !== null && <> · about {formatUsd(about)} at {Math.round(rate).toLocaleString("en-US")}</>}
          {tot.LBP === 0 && "in your main wallet and pockets"}
        </span>
      </div>

      {pockets === null ? (
        <p className="hint">Loading...</p>
      ) : (
        <>
          <div className="pk-stage" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { start.current = null; }}>
            {items.map((it, i) => {
              const d = rel(i);
              const front = d === 0;
              const isNew = it.kind === "new";
              return (
                <button
                  key={it.key} type="button" onClick={() => pick(i)}
                  className={`pk-card ${front ? "front" : ""} ${isNew ? "new" : ""}`}
                  aria-label={isNew ? it.name : `${it.name}, ${it.bal}`} tabIndex={Math.abs(d) <= 1 ? 0 : -1}
                  style={{
                    "--d": d,
                    opacity: Math.abs(d) <= 1 ? (front ? 1 : 0.7) : 0,
                    pointerEvents: Math.abs(d) <= 1 ? "auto" : "none",
                    ...(isNew ? {} : { background: mix(it.color, front ? 0.22 : 0.14), borderColor: mix(it.color, front ? 0.6 : 0.4) }),
                  }}
                >
                  {isNew ? (
                    <>
                      <span className="pk-new-plus">+</span>
                      <span className="pk-card-name">{it.name}</span>
                      <span className="pk-card-sub pk-center">{it.sub}</span>
                    </>
                  ) : (
                    <>
                      <span className="pk-card-top">
                        <span className="pk-card-name"><span className="pk-dot" style={{ background: it.color }} />{it.name}</span>
                        <span className="pk-card-tag">{it.tag}</span>
                      </span>
                      <span className="pk-card-mid">
                        <span className="pk-card-bal">{it.bal}</span>
                        <span className="pk-card-sub">{it.sub}</span>
                      </span>
                      {front && <span className="pk-tap"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>Tap to open</span>}
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="pk-dots">
            {items.map((it, i) => (
              <button key={it.key} type="button" className="pk-dot-hit" aria-label={it.name} onClick={() => go(i)}>
                <span className={`pk-pip ${i === cur ? "on" : ""} ${it.kind === "new" ? "new" : ""}`} />
              </button>
            ))}
          </div>
        </>
      )}
      {loadError && <p className="status error" role="alert">{loadError}</p>}

      {sheet?.type === "open" && openItem && (
        <OpenSheet
          item={openItem} pockets={list} rawAccounts={rawAccounts} cards={cards} accounts={accounts}
          acct={openItem.kind === "pocket" ? acctOf(openItem.pocket) : null}
          onClose={() => setSheet(null)} onAction={onAction} onChangedInside={() => refresh(false)} reloadKey={reloadKey}
        />
      )}
      {sheet?.type === "new" && (
        <CreatePocketSheet
          familyId={familyId} wallets={wallets} taken={list.map((p) => p.name.trim().toLowerCase())} onClose={() => setSheet(null)}
          onCreated={(created) => { refresh(false); setSheet(sheet.back ? { ...sheet.back, pocketId: created?.id || sheet.back.pocketId } : null); }}
        />
      )}
      {sheet?.type === "edit" && openItem?.pocket && (
        <EditPocketSheet pocket={openItem.pocket} acct={acctOf(openItem.pocket)} taken={list.map((p) => p.name.trim().toLowerCase())} onClose={() => setSheet({ type: "open", key: openItem.key })} onDone={() => { setSel(0); refresh(); }} />
      )}
      {moveDir && (
        <MoveSheet
          dir={moveDir} pocketId={movePocketId} pockets={list} accounts={accounts} wallets={wallets} familyId={familyId}
          onPick={(id) => setSheet({ ...sheet, pocketId: id })}
          onNew={() => setSheet({ type: "new", back: sheet })}
          onClose={() => setSheet(null)} onDone={() => refresh()}
        />
      )}
      {sheet?.type === "pool" && <PoolSheet memberId={memberId} accounts={accounts} onClose={() => setSheet(null)} onDone={() => refresh()} />}
    </section>
  );
}
