// Edge Function: send-bill-alerts
// Two ways in:
//  1. Every morning (a scheduled job calls it with the x-cron-secret header): sends each person ONE alert listing
//     the bills that are due in the next 3 days or overdue (up to 7 days late). Family bills go to the admins,
//     who pay them; a personal bill goes to the person who made it. It only acts when it is 09:00 in Beirut,
//     so the job can run at two UTC hours and still send once, summer and winter. Pass {"force": true} to skip that check.
//  2. A signed-in person sending themselves a test alert: {"test": true} with their normal login token.
// Needs the secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), CRON_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. Turn "Verify JWT" OFF for this function.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const TZ = "Asia/Beirut";
const SEND_HOUR = 9;
const SOON_DAYS = 3;
const LATE_DAYS = 7;

// ------------------------------------------------------------ pure logic --

export type Bill = { name: string; amount: number; currency: string; next_due_date: string };
export type Alert = { title: string; body: string; url: string; tag: string };

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
export const todayKey = (d = new Date()) => dayFmt.format(d);
export const beirutHour = (d = new Date()) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d));
const toUtc = (k: string) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const daysUntil = (due: string, today: string) => Math.round((toUtc(due) - toUtc(today)) / 86400000);

export function money(amount: number, currency: string) {
  return currency === "LBP"
    ? `${Math.round(amount).toLocaleString("en-US")} LBP`
    : `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function when(days: number) {
  if (days < 0) return days === -1 ? "1 day late" : `${-days} days late`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

// The alert for one person, or null when nothing needs their attention.
export function buildAlert(bills: Bill[], today: string): Alert | null {
  const rows = bills
    .map((b) => ({ ...b, days: daysUntil(b.next_due_date, today) }))
    .filter((b) => b.days <= SOON_DAYS && b.days >= -LATE_DAYS)
    .sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  if (rows.length === 0) return null;
  const late = rows.filter((b) => b.days < 0).length;
  if (rows.length === 1) {
    const b = rows[0];
    return {
      title: late ? "Bill overdue" : "Bill to pay",
      body: `${b.name}: ${money(b.amount, b.currency)}, ${when(b.days)}.`,
      url: "/?view=bills", tag: "bills-digest",
    };
  }
  const names = rows.slice(0, 3).map((b) => b.name).join(", ") + (rows.length > 3 ? `, +${rows.length - 3} more` : "");
  return {
    title: `${rows.length} bills to pay`,
    body: `${late ? `${late} overdue. ` : ""}${names}.`,
    url: "/?view=bills", tag: "bills-digest",
  };
}

// ----------------------------------------------------------------- server --

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function sendTo(admin: ReturnType<typeof createClient>, subs: any[], alert: Alert) {
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(alert), { TTL: 12 * 3600, urgency: "normal" },
      );
      sent++;
    } catch (e: any) {
      // The phone says this address is gone (app removed, alerts switched off): forget it.
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("push failed", e?.statusCode, e?.body);
    }
  }
  return sent;
}

if (typeof Deno !== "undefined") {
  Deno.serve(async (req) => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
    const body = await req.json().catch(() => ({}));

    // 2. a person testing their own device
    if (body.test) {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data } = await admin.auth.getUser(token);
      if (!data?.user) return json({ error: "Not signed in" }, 401);
      const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", data.user.id);
      const sent = await sendTo(admin, subs || [], { title: "Family Wallet", body: "Alerts are working on this phone.", url: "/", tag: "test" });
      return json({ sent });
    }

    // 1. the morning job
    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "Not allowed" }, 401);
    if (!body.force && beirutHour() !== SEND_HOUR) return json({ skipped: "not 09:00 in Beirut" });

    const today = todayKey();
    const [{ data: subs }, { data: members }, { data: famBills }, { data: myBills }] = await Promise.all([
      admin.from("push_subscriptions").select("*"),
      admin.from("members").select("id, family_id, role").is("removed_at", null),
      admin.from("common_bills").select("family_id, name, amount, currency, next_due_date").eq("is_active", true),
      admin.from("planned_payments").select("created_by_member_id, name, amount, currency, next_due_date").eq("is_active", true),
    ]);
    const roleOf = new Map((members || []).map((m: any) => [m.id, m]));
    const byMember = new Map<string, any[]>();
    for (const s of subs || []) { if (roleOf.has(s.member_id)) byMember.set(s.member_id, [...(byMember.get(s.member_id) || []), s]); }

    let people = 0, sent = 0;
    for (const [memberId, devices] of byMember) {
      const m = roleOf.get(memberId);
      const bills: Bill[] = [
        ...(["admin", "superadmin"].includes(m.role) ? (famBills || []).filter((b: any) => b.family_id === m.family_id) : []),
        ...(myBills || []).filter((b: any) => b.created_by_member_id === memberId),
      ];
      const alert = buildAlert(bills, today);
      if (!alert) continue;
      people++;
      sent += await sendTo(admin, devices, alert);
    }
    return json({ people, sent });
  });
}
