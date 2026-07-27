import { supabase } from '../supabaseClient'

// Free, no-API-key exchange rate API (per spec Section 7).
const RATE_API_BASE = 'https://api.frankfurter.dev/v1'

function todayStr() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function cacheKey(from, to, date) {
  return `rate:${from}_${to}:${date}`
}

function readCache(from, to, date) {
  const raw = localStorage.getItem(cacheKey(from, to, date))
  return raw ? JSON.parse(raw).rate : null
}

function writeCache(from, to, date, rate) {
  localStorage.setItem(cacheKey(from, to, date), JSON.stringify({ rate, cachedAt: Date.now() }))
}

// Finds the most recent cached rate for this pair, regardless of date —
// used as a last resort if the live API is unreachable (NFR6).
function readMostRecentCache(from, to) {
  const prefix = `rate:${from}_${to}:`
  let best = null
  let bestDate = null
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(prefix)) {
      const date = key.slice(prefix.length)
      if (!bestDate || date > bestDate) {
        bestDate = date
        best = JSON.parse(localStorage.getItem(key)).rate
      }
    }
  }
  return best
}

async function fetchLiveRate(from, to) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${RATE_API_BASE}/latest?base=${from}&symbols=${to}`, {
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`Rate API returned ${res.status}`)
    const data = await res.json()
    const rate = data.rates?.[to]
    if (!rate) throw new Error(`No rate returned for ${from}->${to}`)
    return rate
  } finally {
    clearTimeout(timeout)
  }
}

// Checks for an admin-set manual override for today first (relevant for
// informal-market currencies like LBP — FR19). Falls back to live API,
// then same-day cache, then most-recent cache on outage (NFR6).
export async function getExchangeRate(familyId, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1

  const date = todayStr()

  const { data: override } = await supabase
    .from('exchange_rate_overrides')
    .select('rate')
    .eq('family_id', familyId)
    .eq('currency_pair', `${fromCurrency}_${toCurrency}`)
    .eq('effective_date', date)
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (override) return override.rate

  const cached = readCache(fromCurrency, toCurrency, date)
  if (cached) return cached

  try {
    const rate = await fetchLiveRate(fromCurrency, toCurrency)
    writeCache(fromCurrency, toCurrency, date, rate)
    return rate
  } catch (err) {
    const fallback = readMostRecentCache(fromCurrency, toCurrency)
    if (fallback) return fallback
    throw new Error(
      `Could not get an exchange rate for ${fromCurrency}->${toCurrency} (API unreachable and no cached rate available).`
    )
  }
}

export async function setManualOverride(familyId, memberId, fromCurrency, toCurrency, rate) {
  const { error } = await supabase.from('exchange_rate_overrides').insert({
    family_id: familyId,
    currency_pair: `${fromCurrency}_${toCurrency}`,
    rate,
    set_by_member_id: memberId,
    effective_date: todayStr()
  })
  if (error) throw error
}

// Fixed list for this build (Section 10, open decision #2 — can be extended later).
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'LBP', 'GBP']
