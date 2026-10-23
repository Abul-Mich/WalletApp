import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

// Two small banners at the top of the app:
//  - "A new version is ready": the update waits until the person taps Reload.
//  - "You're offline": money actions are paused (see .is-offline in the CSS) until the connection returns.
export default function PwaStatus() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // Look for a new version every 30 minutes, and whenever the app comes back to the foreground.
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    },
  });

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("is-offline", !online);
  }, [online]);

  if (online && !needRefresh) return null;
  return (
    <div className="pwa-bar" role="status" aria-live="polite">
      {!online ? (
        <span>You're offline. You can look around, but adding or changing money is paused until you're back online.</span>
      ) : (
        <>
          <span>A new version is ready.</span>
          <button type="button" onClick={() => updateServiceWorker(true)}>Reload</button>
        </>
      )}
    </div>
  );
}
