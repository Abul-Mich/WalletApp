import { supabase } from "../supabaseClient";

// Phone alerts (Web Push). The app registers this device with the browser's push service, then saves
// the device address in Supabase so the morning job can reach it. Turning off removes it again.

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export const pushConfigured = () => !!PUBLIC_KEY;
export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function keyBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// "unsupported" | "needs-install" | "blocked" | "off" | "on"
export async function pushStatus() {
  if (!pushSupported()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  if (isIos() && !isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "granted" && (await currentSubscription())) return "on";
  return "off";
}

export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Alerts were not allowed. You can allow them in your phone's settings for this app.");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) }));
  const j = sub.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_user_agent: navigator.userAgent,
  });
  if (error) { await sub.unsubscribe().catch(() => {}); throw new Error(error.message); }
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.rpc("remove_push_subscription", { p_endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
}

export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke("send-bill-alerts", { body: { test: true } });
  if (error) throw new Error("Could not send the test alert. Check that the alert function is deployed.");
  if (!data?.sent) throw new Error("No device received it. Turn alerts off and on again.");
  return data.sent;
}
