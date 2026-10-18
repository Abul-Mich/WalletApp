import { periodStart, periodSpend } from "./wallets";

function summarize(spent, limit, period) {
  const pct = limit > 0 ? spent / limit : 0;
  return {
    spent,
    limit,
    period,
    percentUsed: pct,
    isNearLimit: pct >= 0.8 && pct < 1,
    isOverLimit: pct >= 1,
  };
}

// Family budget: a target the admin sets, counted in net USD (expenses + card spending).
export async function getFamilyBudgetSpend(familyId, family) {
  if (!family.budget_amount || !family.budget_period) return null;
  const from = await periodStart(family.budget_period);
  const spent = Number((await periodSpend({ familyId, from })) || 0);
  return summarize(spent, Number(family.budget_amount), family.budget_period);
}

// Category budget: total net USD for one category.
export async function getCategorySpend(familyId, category) {
  if (!category.budget_amount || !category.budget_period) return null;
  const from = await periodStart(category.budget_period);
  const spent = Number((await periodSpend({ familyId, categoryId: category.id, from })) || 0);
  return summarize(spent, Number(category.budget_amount), category.budget_period);
}
