// Start of the current week (Monday) or month in Asia/Beirut, computed in the browser so the
// Home screen does not need a round trip to the database for it. Same result as the SQL
// function period_start.
const TZ = "Asia/Beirut";
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const addDays = (key, n) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function offsetMin(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}
function midnight(key) {
  const guess = new Date(`${key}T00:00:00Z`);
  let t = guess.getTime() - offsetMin(guess) * 60000;
  t = guess.getTime() - offsetMin(new Date(t)) * 60000;
  return new Date(t);
}

// "weekly" | "monthly" -> ISO timestamp
export function periodStartIso(period) {
  const today = keyFmt.format(new Date());
  if (period === "weekly") {
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    return midnight(addDays(today, -dow)).toISOString();
  }
  return midnight(`${today.slice(0, 8)}01`).toISOString();
}
