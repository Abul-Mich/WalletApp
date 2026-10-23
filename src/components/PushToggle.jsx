import { useEffect, useState } from "react";
import { pushConfigured, pushStatus, enablePush, disablePush, sendTestPush } from "../lib/push";

// Profile card: turn bill alerts on or off for this phone.
export default function PushToggle() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const refresh = () => pushStatus().then(setStatus).catch(() => setStatus("unsupported"));
  useEffect(() => { if (pushConfigured()) refresh(); }, []);

  if (!pushConfigured() || status === null || status === "unsupported") return null;

  async function run(fn, ok) {
    setBusy(true); setError(null); setMsg(null);
    try { await fn(); if (ok) setMsg(ok); } catch (e) { setError(e.message); } finally { setBusy(false); refresh(); }
  }

  return (
    <div className="install-card push-card">
      <div>
        <strong>Bill alerts</strong>
        {status === "needs-install" && <span>Add the app to your home screen first (see above). Then you can turn alerts on.</span>}
        {status === "blocked" && <span>Alerts are blocked for this app. Allow notifications in your phone's settings, then come back.</span>}
        {status === "off" && <span>A reminder at 9:00 each morning when a bill is due within 3 days or overdue.</span>}
        {status === "on" && <span>On for this phone. You get a reminder at 9:00 when a bill is due within 3 days or overdue.</span>}
        {msg && <span className="push-ok">{msg}</span>}
        {error && <span className="push-err" role="alert">{error}</span>}
      </div>
      {status === "off" && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(enablePush, "Alerts are on.")}>{busy ? "..." : "Turn on"}</button>}
      {status === "on" && (
        <div className="push-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(sendTestPush, "Test sent. It should arrive in a few seconds.")}>Send a test</button>
          <button type="button" className="link-button" disabled={busy} onClick={() => run(disablePush)}>Turn off</button>
        </div>
      )}
    </div>
  );
}
