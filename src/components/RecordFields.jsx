import { useMemo, useState } from "react";
import { makeColorFor } from "../lib/categoryColors";
import { TextInput } from "./Field";

const SHOWN = 5;

// Category chips with the same colors as Statistics. Shows the first few plus the chosen one,
// "More..." reveals the rest. allowNone adds a "No category" chip.
export function CategoryChips({ categories, value, onChange, allowNone = false, label = "Category" }) {
  const [all, setAll] = useState(false);
  const colorFor = useMemo(() => makeColorFor(categories), [categories]);
  const visible = all || categories.length <= SHOWN + 1 ? categories : categories.filter((c, i) => i < SHOWN || c.id === value);
  const hidden = categories.length - visible.length;
  return (
    <div className="sf-block">
      <span className="sf-label">{label}</span>
      <div className="sf-chips">
        {visible.map((c) => (
          <button key={c.id} type="button" className={`sf-chip ${value === c.id ? "on" : ""}`} aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
            <i className="sf-dot" style={{ background: colorFor(c.name) }} />{c.name}
          </button>
        ))}
        {hidden > 0 && <button type="button" className="sf-chip sf-chip-more" onClick={() => setAll(true)}>More...</button>}
        {allowNone && (
          <button type="button" className={`sf-chip ${value === "" ? "on" : ""}`} aria-pressed={value === ""} onClick={() => onChange("")}>No category</button>
        )}
      </div>
    </div>
  );
}

// One-of-many person chips. options = [{ value, label }].
export function PersonChips({ options, value, onChange, label, hint }) {
  return (
    <div className="sf-block">
      <span className="sf-label">{label}{hint && <> <span className="sf-muted">{hint}</span></>}</span>
      <div className="sf-chips">
        {options.map((o) => (
          <button key={o.value} type="button" className={`sf-chip ${value === o.value ? "on" : ""}`} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

// Date and note side by side, in a quiet box.
export function DateNote({ when, onWhen, note, onNote, max }) {
  return (
    <div className="sf-more sf-datenote">
      <span className="sf-label" style={{ margin: 0 }}>Date and note</span>
      <div className="sf-two">
        <TextInput label="Date and time" type="datetime-local" value={when} onChange={onWhen} max={max} />
        <TextInput label="Note" value={note} onChange={onNote} placeholder="Optional" />
      </div>
    </div>
  );
}

// A grey card listing what a change will do, line by line: rows = [{ name, value }].
export function ImpactCard({ rows, emptyText = "Nothing yet. Change the amount, person or category." }) {
  return (
    <div className="sf-limit">
      <span className="sf-label" style={{ margin: 0 }}>What this changes</span>
      {rows.length === 0 ? (
        <p className="sf-limit-note">{emptyText}</p>
      ) : (
        rows.map((r) => (
          <div key={r.name} className="sf-limit-row"><span>{r.name}</span><strong>{r.value}</strong></div>
        ))
      )}
    </div>
  );
}

// Sheet shell for editing a record: title + close, scrolling body.
export function EditSheet({ title, onClose, children }) {
  return (
    <div className="sheet-backdrop" onClick={(e) => { e.stopPropagation(); onClose?.(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sf-sheet-head">
          <h2 className="sf-sheet-title">{title}</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const signed = (n, fmt) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n))}`;
