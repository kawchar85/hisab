import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSettlement,
  mealsForMember,
  mealsForMemberOnDate,
  personalMealCountOnDate,
  totalRent,
  sumFinalPayable
} from '../public/js/calculations.js';

const month = {
  id: '2026-09',
  status: 'closed',
  activeMemberIds: ['lubon', 'kabbo', 'sohan', 'abir', 'kawchar'],
  rentByMember: {
    lubon: 7300,
    kabbo: 12300,
    sohan: 7800,
    abir: 5800,
    kawchar: 6800
  },
  weekdayDefault: 1,
  fridayDefault: 2,
  saturdayDefault: 2
};

const members = [
  { id: 'lubon', name: 'Lubon' },
  { id: 'kabbo', name: 'Kabbo' },
  { id: 'sohan', name: 'Sohan' },
  { id: 'abir', name: 'Abir' },
  { id: 'kawchar', name: 'Kawchar' }
];

test('September 2026 has 38 default meals per member', () => {
  assert.equal(mealsForMember('kawchar', month), 38);
  assert.equal(mealsForMember('lubon', month), 38);
});

test('absolute override replaces the default count', () => {
  const overrides = [{ memberId: 'kawchar', date: '2026-09-04', count: 0 }];
  assert.equal(personalMealCountOnDate('kawchar', '2026-09-04', month, overrides), 0);
  assert.equal(mealsForMemberOnDate('kawchar', '2026-09-04', month, overrides), 0);
  assert.equal(mealsForMember('kawchar', month, overrides), 36);
});

test('global mess off overrides personal count without destroying it', () => {
  const overrides = [{ memberId: 'kawchar', date: '2026-09-04', count: 3 }];
  const mealDays = [{ date: '2026-09-04', messOff: true }];
  assert.equal(personalMealCountOnDate('kawchar', '2026-09-04', month, overrides), 3);
  assert.equal(mealsForMemberOnDate('kawchar', '2026-09-04', month, overrides, mealDays), 0);
});

test('legacy adjustment data remains compatible', () => {
  const adjustments = [
    { memberId: 'kawchar', date: '2026-09-04', adjustment: -1 },
    { memberId: 'kawchar', date: '2026-09-10', adjustment: 1 }
  ];
  assert.equal(mealsForMemberOnDate('kawchar', '2026-09-04', month, [], [], adjustments), 1);
  assert.equal(mealsForMemberOnDate('kawchar', '2026-09-10', month, [], [], adjustments), 2);
  assert.equal(mealsForMember('kawchar', month, [], [], adjustments), 38);
});

test('settlement conserves rent total without per-user rounding drift', () => {
  const expenses = [
    { memberId: 'lubon', type: 'bazar', amount: 2000, date: '2026-09-03' },
    { memberId: 'kawchar', type: 'bazar', amount: 1000, date: '2026-09-07' },
    { memberId: 'abir', type: 'utility', amount: 1500, date: '2026-09-09' },
    { memberId: 'kawchar', type: 'utility', amount: 1000, date: '2026-09-10' }
  ];
  const overrides = [
    { memberId: 'abir', date: '2026-09-10', count: 0 },
    { memberId: 'kawchar', date: '2026-09-11', count: 2 }
  ];
  const settlement = buildSettlement({ month, members, expenses, overrides });
  assert.ok(Math.abs(sumFinalPayable(settlement) - totalRent(settlement)) < 1e-9);
  assert.equal(totalRent(settlement), 40000);
});
