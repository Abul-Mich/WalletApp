import { useEffect, useState } from "react";

// "Install the app" card for the Profile section. Android/Chrome: a real install button.
// iPhone/iPad: there is no install prompt, so we show the Share -> Add to Home Screen steps.
const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export default function InstallApp() {
  const [evt, setEvt] = useState(null);
  const [installed, setInstalled] = useState(standalone());

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setEvt(e); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (installed) return null;
  if (evt) {
    return (
      <div className="install-card">
        <div><strong>Install Family Wallet</strong><span>Opens full-screen from your home screen, like any app.</span></div>
        <button type="button" className="btn btn-primary" onClick={async () => { evt.prompt(); await evt.userChoice.catch(() => {}); setEvt(null); }}>Install</button>
      </div>
    );
  }
  if (isIos()) {
    return (
      <div className="install-card">
        <div>
          <strong>Add to your home screen</strong>
          <span>In Safari, tap the Share button, then "Add to Home Screen". It then opens full-screen like an app.</span>
        </div>
      </div>
    );
  }
  return null;
}
