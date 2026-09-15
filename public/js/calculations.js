import { datesBetween, lastDateOfMonth, monthStartISO, weekdayOfISO } from './date.js';

export function defaultMealsForDate(isoDate, month) {
  const weekday = weekdayOfISO(isoDate);
  if (weekday === 5) return Number(month.fridayDefault ?? 2);
  if (weekday === 6) return Number(month.saturdayDefault ?? 2);
  return Number(month.weekdayDefault ?? 1);
}

function legacyAdjustmentForDate(adjustments, memberId, date) {
  return adjustments
    .filter(item => item.memberId === memberId && item.date === date)
    .reduce((sum, item) => sum + Number(item.adjustment || 0), 0);
}

export function baselineMealCount(memberId, date, month, adjustments = []) {
  if (!month || !month.activeMemberIds?.includes(memberId)) return 0;
  return Math.max(0, defaultMealsForDate(date, month) + legacyAdjustmentForDate(adjustments, memberId, date));
}

export function personalMealCountOnDate(memberId, date, month, overrides = [], adjustments = []) {
  if (!month || !month.activeMemberIds?.includes(memberId)) return 0;
  const override = overrides.find(item => item.memberId === memberId && item.date === date);
  if (override) return Math.max(0, Number(override.count || 0));
  return baselineMealCount(memberId, date, month, adjustments);
}

export function isMessOff(date, mealDays = []) {
  return mealDays.some(item => item.date === date && item.messOff === true);
}

export function mealsForMemberOnDate(memberId, date, month, overrides = [], mealDays = [], adjustments = []) {
  if (isMessOff(date, mealDays)) return 0;
  return personalMealCountOnDate(memberId, date, month, overrides, adjustments);
}

export function mealsForMember(memberId, month, overrides = [], mealDays = [], adjustments = []) {
  if (!month) return 0;
  const start = monthStartISO(month.id);
  const end = lastDateOfMonth(month.id);
  let total = 0;
  for (const date of datesBetween(start, end)) {
    total += mealsForMemberOnDate(memberId, date, month, overrides, mealDays, adjustments);
  }
  return total;
}

export function buildSettlement({ month, members, expenses = [], overrides = [], mealDays = [], adjustments = [] }) {
  if (!month) {
    return {
      totalBazar: 0,
      totalUtility: 0,
      totalMeals: 0,
      mealRate: 0,
      utilityShare: 0,
      rows: []
    };
  }

  const activeIds = month.activeMemberIds || [];
  const totalBazar = expenses
    .filter(item => item.type === 'bazar')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalUtility = expenses
    .filter(item => item.type === 'utility')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const rows = activeIds.map(memberId => {
    const member = members.find(item => item.id === memberId) || { id: memberId, name: memberId };
    const finalMeals = mealsForMember(memberId, month, overrides, mealDays, adjustments);
    const bazarPaid = expenses
      .filter(item => item.type === 'bazar' && item.memberId === memberId)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const utilityPaid = expenses
      .filter(item => item.type === 'utility' && item.memberId === memberId)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    return {
      memberId,
      name: member.name,
      finalMeals,
      bazarPaid,
      utilityPaid,
      rent: Number(month.rentByMember?.[memberId] || 0)
    };
  });

  const totalMeals = rows.reduce((sum, row) => sum + row.finalMeals, 0);
  const mealRate = totalMeals > 0 ? totalBazar / totalMeals : 0;
  const utilityShare = rows.length > 0 ? totalUtility / rows.length : 0;

  for (const row of rows) {
    row.foodCost = row.finalMeals * mealRate;
    row.foodBalance = row.foodCost - row.bazarPaid;
    row.utilityShare = utilityShare;
    row.finalPayable = row.rent + row.foodBalance + row.utilityShare - row.utilityPaid;
  }

  return { totalBazar, totalUtility, totalMeals, mealRate, utilityShare, rows };
}

export function sumFinalPayable(settlement) {
  return settlement.rows.reduce((sum, row) => sum + row.finalPayable, 0);
}

export function totalRent(settlement) {
  return settlement.rows.reduce((sum, row) => sum + row.rent, 0);
}
