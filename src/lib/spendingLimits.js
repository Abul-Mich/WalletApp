import { supabase } from '../supabaseClient'

// Returns the start of the current period (week or month) as an ISO timestamp.
export function periodStart(period) {
  const now = new Date()
  if (period === 'weekly') {
    const day = now.getDay() // 0 = Sunday
    const diff = now.getDate() - day
    const start = new Date(now.getFullYear(), now.getMonth(), diff)
    return start.toISOString()
  }
  // monthly (default)
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

// Sums a member's transactions (in base currency) since the start of their
// configured limit period. Returns null if the member has no limit set.
export async function getMemberSpend(familyId, member) {
  if (!member.spending_limit_amount || !member.spending_limit_period) return null

  const since = periodStart(member.spending_limit_period)

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, exchange_rate_to_base')
    .eq('family_id', familyId)
    .eq('member_id', member.id)
    .gte('created_at', since)

  if (error) throw error

  const spent = (data || []).reduce((sum, t) => sum + t.amount * t.exchange_rate_to_base, 0)

  return {
    spent,
    limit: member.spending_limit_amount,
    period: member.spending_limit_period,
    percentUsed: spent / member.spending_limit_amount,
    isNearLimit: spent / member.spending_limit_amount >= 0.8 && spent / member.spending_limit_amount < 1,
    isOverLimit: spent / member.spending_limit_amount >= 1
  }
}
