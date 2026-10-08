// Shared form pieces: a visible label above every field, optional unit tag
// inside the box, helper text below.

export function Field({ label, help, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

// A text box for money. Uses a decimal keyboard on phones and accepts both
// "10.5" and "10,5" (the form calls parseNumber on the value).
export function MoneyInput({ label, help, unit, value, onChange, placeholder, required, autoFocus }) {
  return (
    <Field label={label} help={help}>
      <div className={`input ${unit ? "has-unit" : ""}`}>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          required={required}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </Field>
  );
}

export function TextInput({ label, help, value, onChange, placeholder, type = "text", required, max }) {
  return (
    <Field label={label} help={help}>
      <div className="input">
        <input type={type} placeholder={placeholder} value={value} required={required} max={max} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

export function SelectInput({ label, help, value, onChange, children, required }) {
  return (
    <Field label={label} help={help}>
      <div className="input">
        <select value={value} required={required} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
      </div>
    </Field>
  );
}

export function FormGroup({ title, children }) {
  return (
    <div className="group">
      {title && <h4>{title}</h4>}
      <div className="grid">{children}</div>
    </div>
  );
}
