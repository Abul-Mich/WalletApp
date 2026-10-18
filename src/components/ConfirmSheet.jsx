import { useCallback, useState } from "react";

// A styled replacement for window.confirm(). Usage:
//   const { ask, dialog } = useConfirm();
//   ask({ title, detail, effect, confirmLabel, danger, icon, onConfirm: async () => {...} });
//   ...render {dialog} somewhere in the component.
// If onConfirm throws, the message is shown in the sheet and it stays open.
const ICONS = {
  trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12",
  person: "M15 8a3 3 0 11-6 0 3 3 0 016 0zM4 20c0-3.3 3.6-5 8-5s8 1.7 8 5M17 4l4 4m0-4l-4 4",
  archive: "M4 7h16v3H4zM6 10v9h12v-9M10 14h4",
};

export function useConfirm() {
  const [req, setReq] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ask = useCallback((r) => { setError(null); setReq(r); }, []);
  const close = () => { if (!busy) setReq(null); };

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await req.onConfirm();
      setReq(null);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const danger = req?.danger !== false;
  const dialog = req ? (
    <div className="cf-backdrop" onClick={(e) => { e.stopPropagation(); close(); }} role="presentation">
      <div className="cf-sheet" role="alertdialog" aria-modal="true" aria-labelledby="cf-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="cf-head">
          <div className={`cf-icon ${danger ? "danger" : ""}`}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
              <path d={ICONS[req.icon] || ICONS.trash} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="cf-text">
            <h2 id="cf-title">{req.title}</h2>
            {req.detail && <p>{req.detail}</p>}
          </div>
        </div>
        {req.effect && (
          <div className="cf-effect">
            <span>What happens</span>
            <p>{req.effect}</p>
          </div>
        )}
        {error && <p className="status error" role="alert">{error}</p>}
        <div className="cf-actions">
          <button type="button" className={`cf-confirm ${danger ? "danger" : ""}`} disabled={busy} onClick={go} autoFocus>
            {busy ? "Working..." : req.confirmLabel || "Confirm"}
          </button>
          <button type="button" className="cf-cancel" disabled={busy} onClick={close}>{req.cancelLabel || "Cancel"}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dialog };
}
