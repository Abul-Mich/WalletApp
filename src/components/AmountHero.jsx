// The big centered amount used by the money forms: symbol + number, optional USD/LBP pills,
// optional line underneath. The box grows with what you type so the number stays centered.
export default function AmountHero({ value, onChange, currency, onCurrency, fixedNote, children, autoFocus = true }) {
  return (
    <div className="sf-hero">
      <div className="sf-hero-input">
        {currency === "USD" && <span className="sf-symbol">$</span>}
        <input
          type="text" inputMode="decimal" autoComplete="off" autoFocus={autoFocus} aria-label={`Amount in ${currency}`}
          placeholder="0" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width: `${Math.max(2, String(value).length + 1)}ch` }}
        />
        {currency === "LBP" && <span className="sf-symbol sf-symbol-small">LBP</span>}
      </div>
      {onCurrency && (
        <div className="sf-pills" role="group" aria-label="Currency">
          {["USD", "LBP"].map((c) => (
            <button key={c} type="button" className={`sf-pill ${currency === c ? "on" : ""}`} aria-pressed={currency === c} onClick={() => onCurrency(c)}>{c}</button>
          ))}
        </div>
      )}
      {fixedNote && <span className="sf-muted sf-small">{fixedNote}</span>}
      {children}
    </div>
  );
}
