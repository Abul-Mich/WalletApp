import { supabase } from '../supabaseClient'
import { periodStart } from './spendingLimits'

// Family Budget: a target the admin sets (families.budget_amount/period),
// separate from the actual cash balance (wallets.balance_cache). Computed
// the same way as a member limit, just summed across the whole family.
export async function getFamilyBudgetSpend(familyId, family) {
  if (!family.budget_amount || !family.budget_period) return null

  const since = periodStart(family.budget_period)

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, exchange_rate_to_base')
    .eq('family_id', familyId)
    .gte('created_at', since)

  if (error) throw error

  const spent = (data || []).reduce((sum, t) => sum + t.amount * t.exchange_rate_to_base, 0)

  return {
    spent,
    limit: family.budget_amount,
    period: family.budget_period,
    percentUsed: spent / family.budget_amount,
    isNearLimit: spent / family.budget_amount >= 0.8 && spent / family.budget_amount < 1,
    isOverLimit: spent / family.budget_amount >= 1
  }
}

// Category Budget: independent of any member's personal limit — tracks
// total spend against a single category's own cap.
export async function getCategorySpend(familyId, category) {
  if (!category.budget_amount || !category.budget_period) return null

  const since = periodStart(category.budget_period)

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, exchange_rate_to_base')
    .eq('family_id', familyId)
    .eq('category_id', category.id)
    .gte('created_at', since)

  if (error) throw error

  const spent = (data || []).reduce((sum, t) => sum + t.amount * t.exchange_rate_to_base, 0)

  return {
    spent,
    limit: category.budget_amount,
    period: category.budget_period,
    percentUsed: spent / category.budget_amount,
    isNearLimit: spent / category.budget_amount >= 0.8 && spent / category.budget_amount < 1,
    isOverLimit: spent / category.budget_amount >= 1
  }
}
