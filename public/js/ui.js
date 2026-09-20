import {
  currentMonthId,
  datesBetween,
  lastDateOfMonth,
  monthLabel,
  monthStartISO,
  prettyDate,
  todayISO,
  weekdayOfISO
} from './date.js';
import {
  baselineMealCount,
  buildSettlement,
  defaultMealsForDate,
  isMessOff,
  mealsForMemberOnDate,
  personalMealCountOnDate,
  totalRent
} from './calculations.js';

export function money(value) {
  const n = Number(value || 0);
  return `৳${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name) {
  const icons = {
    home: '<path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    expense: '<path d="M4 5h16v14H4z"/><path d="M4 9h16M8 14h4"/>',
    meal: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M17 3v18M17 3c3 2 4 5 4 8h-4"/>',
    settle: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    admin: '<path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    edit: '<path d="m4 20 4.5-1 9.8-9.8-3.5-3.5L5 15.5zM13.8 6.7l3.5 3.5"/>',
    calendar: '<path d="M5 5h14v15H5zM8 3v4M16 3v4M5 10h14"/>',
    range: '<path d="M4 7h16M4 17h16M7 4 4 7l3 3M17 14l3 3-3 3"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    logout: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
}

function loadingScreen(message = 'Loading Mess Manager…') {
  return `<div class="full-center"><div class="brand-mark">MM</div><div class="spinner"></div><p>${escapeHtml(message)}</p></div>`;
}

function errorScreen(message) {
  return `<div class="full-center pad"><div class="brand-mark">!</div><h1>Something went wrong</h1><p class="muted center">${escapeHtml(message)}</p><button class="btn primary" data-action="reload">Reload</button></div>`;
}

function signInScreen() {
  return `<main class="auth-page"><section class="auth-card"><div class="brand-mark large">MM</div><h1>Mess Manager</h1><p>Meals, bazar, utilities, rent and settlement in one place.</p><button class="btn google" data-action="sign-in"><span class="google-g">G</span>Continue with Google</button><p class="tiny muted">Private app for your mess members.</p></section></main>`;
}

function claimScreen(state) {
  const available = state.claimSlots.filter(slot => slot.active && !slot.claimedByUid && !slot.claimedByEmail);
  return `<main class="auth-page"><section class="auth-card wide"><div class="eyebrow">ONE-TIME SETUP</div><h1>Choose your name</h1><p>Signed in as <strong>${escapeHtml(state.user.email)}</strong>. Pick your nickname once.</p><div class="claim-grid">${available.length ? available.map(slot => `<button class="claim-card" data-action="claim" data-member-id="${escapeHtml(slot.id)}"><span class="avatar">${escapeHtml(slot.name.slice(0, 1))}</span><span>${escapeHtml(slot.name)}</span><small>Claim this name</small></button>`).join('') : `<div class="empty-state"><strong>No unclaimed names remain.</strong><span>Ask the Admin if your name was claimed incorrectly.</span></div>`}</div><button class="btn ghost" data-action="sign-out">Use another Google account</button></section></main>`;
}

function navItem(route, label, iconName, active) {
  return `<button class="nav-item ${active ? 'active' : ''}" data-route="${route}">${icon(iconName)}<span>${label}</span></button>`;
}

function bottomNav(state) {
  return `<nav class="bottom-nav">${navItem('home', 'Home', 'home', state.route === 'home')}${navItem('expenses', 'Expenses', 'expense', state.route === 'expenses')}${navItem('meals', 'Meals', 'meal', state.route === 'meals')}${navItem('settlement', 'Settlement', 'settle', state.route === 'settlement')}${state.profile.role === 'admin' ? navItem('admin', 'Admin', 'admin', state.route === 'admin') : ''}</nav>`;
}

function currentMonth(state) {
  return state.months.find(m => m.id === currentMonthId()) || null;
}

function currentMember(state) {
  return state.members.find(m => m.id === state.profile.memberId) || null;
}

function emptyMonthData() {
  return { expenses: [], overrides: [], mealDays: [] };
}

function monthDataFor(state, monthId) {
  if (monthId === currentMonthId()) return state.currentMonthData || emptyMonthData();
  return state.loadedMonthData[monthId] || emptyMonthData();
}

function balanceText(value) {
  const n = Number(value || 0);
  if (Math.abs(n) < 0.005) return 'Settled';
  return n > 0 ? `Pay ${money(n)}` : `Receive ${money(n)}`;
}

function simpleSummary(rows) {
  return `<div class="summary-list">${rows.map(([label, value, cls = '']) => `<div><span>${escapeHtml(label)}</span><strong class="${cls}">${escapeHtml(value)}</strong></div>`).join('')}</div>`;
}

function todayMealSummary(state, month, data, date) {
  const rows = (month.activeMemberIds || []).map(memberId => {
    const member = state.members.find(item => item.id === memberId);
    return {
      memberId,
      name: member?.name || memberId,
      count: mealsForMemberOnDate(memberId, date, month, data.overrides, data.mealDays)
    };
  });
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return `<div class="today-meal-summary">
    <div class="today-total-row"><span>Today's total</span><strong>${total}</strong></div>
    <div class="today-member-grid">${rows.map(row => `<div class="today-member-item ${row.memberId === state.profile.memberId ? 'mine' : ''} ${row.count === 0 ? 'zero' : ''}"><span>${escapeHtml(row.name)}</span><strong>${row.count}</strong></div>`).join('')}</div>
  </div>`;
}

function homePage(state) {
  const month = currentMonth(state);
  const member = currentMember(state);
  if (!month) return `<section class="page"><div class="empty-state"><strong>${escapeHtml(monthLabel(currentMonthId()))} is not ready yet.</strong><span>The Admin needs to open the app once for this month.</span></div></section>`;

  const data = state.currentMonthData;
  const settlement = buildSettlement({ month, members: state.members, ...data });
  const myRow = settlement.rows.find(row => row.memberId === state.profile.memberId);
  const today = todayISO();
  const offToday = isMessOff(today, data.mealDays);
  const todayMeals = mealsForMemberOnDate(state.profile.memberId, today, month, data.overrides, data.mealDays);
  const isOpen = month.status === 'open';

  return `<section class="page home-page">
    <div class="home-heading">
      <div><div class="eyebrow">${escapeHtml(monthLabel(month.id).toUpperCase())}</div><h1>Hello, ${escapeHtml(member?.name || 'Member')}</h1></div>
      <button class="signout-button" data-action="sign-out" title="Sign out" aria-label="Sign out">${icon('logout')}<span>Sign out</span></button>
    </div>

    <section class="clean-card meal-focus">
      <div class="meal-focus-top"><div><span class="label">Today's meal</span><small>${escapeHtml(prettyDate(today, { withWeekday: true }))}</small></div>${offToday ? '<span class="subtle-badge">Mess off</span>' : ''}</div>
      <div class="meal-control">
        <button class="count-button" data-action="quick-meal" data-delta="-1" ${!isOpen || offToday || todayMeals <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
        <strong>${todayMeals}</strong>
        <button class="count-button" data-action="quick-meal" data-delta="1" ${!isOpen || offToday ? 'disabled' : ''}>${icon('plus')}</button>
      </div>
      ${todayMealSummary(state, month, data, today)}
      <div class="meal-action-row">
        <button class="meal-action-button" data-action="open-meal-set" ${!isOpen ? 'disabled' : ''}>${icon('calendar')}<span>Change date</span></button>
        <button class="meal-action-button" data-action="open-meal-range" ${!isOpen ? 'disabled' : ''}>${icon('range')}<span>Set range</span></button>
      </div>
    </section>

    <div class="quick-grid">
      <button class="quick-card" data-action="open-expense" data-type="bazar" data-lock-type="true" ${!isOpen ? 'disabled' : ''}><span class="quick-icon">${icon('plus')}</span><strong>Add Bazar</strong></button>
      <button class="quick-card" data-action="open-expense" data-type="utility" data-lock-type="true" ${!isOpen ? 'disabled' : ''}><span class="quick-icon">${icon('plus')}</span><strong>Add Utility</strong></button>
    </div>

    <div class="section-head"><div><span class="eyebrow">THIS MONTH</span><h2>My Summary</h2></div></div>
    ${simpleSummary([
      ['Meals', String(myRow?.finalMeals || 0)],
      ['Bazar paid', money(myRow?.bazarPaid || 0)],
      ['Utility paid', money(myRow?.utilityPaid || 0)],
      ['Current balance', balanceText(myRow?.finalPayable || 0), 'balance-value']
    ])}

    <div class="section-head"><div><span class="eyebrow">MESS SUMMARY</span><h2>Overall</h2></div></div>
    ${simpleSummary([
      ['Total meals', String(settlement.totalMeals)],
      ['Total bazar', money(settlement.totalBazar)],
      ['Total utility', money(settlement.totalUtility)],
      ['Meal rate', money(settlement.mealRate)]
    ])}
    ${!isOpen ? '<p class="info-note">This month is finalized. Changes are disabled unless the Admin reopens it.</p>' : ''}
  </section>`;
}

function monthSelector(state, selectedId, actionName) {
  return `<select class="select" data-action="${actionName}">${state.months.map(month => `<option value="${escapeHtml(month.id)}" ${month.id === selectedId ? 'selected' : ''}>${escapeHtml(monthLabel(month.id))}${month.status === 'closed' ? ' · Finalized' : ''}</option>`).join('')}</select>`;
}

function expenseRow(state, expense, month) {
  const member = state.members.find(m => m.id === expense.memberId);
  const canEdit = month?.status === 'open' && (state.profile.role === 'admin' || expense.ownerUid === state.profile.uid);
  const typeLabel = expense.type === 'bazar' ? 'Bazar' : 'Utility';
  const title = expense.note?.trim() || typeLabel;
  return `<article class="activity-row"><div class="activity-main"><div class="activity-top"><strong>${escapeHtml(title)}</strong><strong>${money(expense.amount)}</strong></div><div class="activity-meta">${escapeHtml(member?.name || expense.memberId)} · ${escapeHtml(prettyDate(expense.date, { withYear: false }))} · ${typeLabel}</div></div>${canEdit ? `<button class="icon-button" data-action="edit-expense" data-expense-id="${escapeHtml(expense.id)}" aria-label="Edit">${icon('edit')}</button>` : ''}</article>`;
}

function expensesPage(state) {
  const monthId = state.expenseMonthId || state.months[0]?.id || currentMonthId();
  const month = state.months.find(m => m.id === monthId);
  const data = monthDataFor(state, monthId);
  const isLoading = state.monthLoading === monthId && monthId !== currentMonthId();
  const canAdd = month?.status === 'open';
  const filtered = data.expenses.filter(item => {
    if (state.expenseFilter === 'mine') return item.ownerUid === state.profile.uid;
    if (state.expenseFilter === 'bazar' || state.expenseFilter === 'utility') return item.type === state.expenseFilter;
    return true;
  });

  return `<section class="page"><div class="page-title-row"><div><span class="eyebrow">TRANSACTIONS</span><h1>Expenses</h1></div></div>${monthSelector(state, monthId, 'expense-month')}${canAdd ? `<div class="page-actions"><button class="btn secondary" data-action="open-expense" data-type="bazar" data-month-id="${monthId}" data-lock-type="true">+ Bazar</button><button class="btn secondary" data-action="open-expense" data-type="utility" data-month-id="${monthId}" data-lock-type="true">+ Utility</button></div>` : '<p class="info-note">This month is finalized and read-only.</p>'}<div class="filter-tabs"><button class="filter-tab ${state.expenseFilter === 'all' ? 'active' : ''}" data-action="expense-filter" data-filter="all">All</button><button class="filter-tab ${state.expenseFilter === 'mine' ? 'active' : ''}" data-action="expense-filter" data-filter="mine">Mine</button><button class="filter-tab ${state.expenseFilter === 'bazar' ? 'active' : ''}" data-action="expense-filter" data-filter="bazar">Bazar</button><button class="filter-tab ${state.expenseFilter === 'utility' ? 'active' : ''}" data-action="expense-filter" data-filter="utility">Utility</button></div><div class="activity-list">${isLoading ? '<div class="inline-loading"><div class="spinner"></div></div>' : filtered.length ? filtered.map(item => expenseRow(state, item, month)).join('') : '<div class="empty-state"><strong>No expenses yet.</strong><span>No transactions match this view.</span></div>'}</div></section>`;
}

function calendarCells(state, month, data) {
  const memberId = state.profile.memberId;
  const daysCount = Number(lastDateOfMonth(month.id).slice(8, 10));
  const firstWeekday = weekdayOfISO(`${month.id}-01`);
  const leading = Array.from({ length: firstWeekday }, () => '<div class="day-cell blank"></div>').join('');
  const today = todayISO();
  const days = Array.from({ length: daysCount }, (_, idx) => `${month.id}-${String(idx + 1).padStart(2, '0')}`);
  return leading + days.map(date => {
    const off = isMessOff(date, data.mealDays);
    const count = mealsForMemberOnDate(memberId, date, month, data.overrides, data.mealDays);
    const base = baselineMealCount(memberId, date, month);
    const personal = personalMealCountOnDate(memberId, date, month, data.overrides);
    const custom = personal !== base;
    return `<button class="day-cell ${date === today ? 'today' : ''} ${off ? 'off' : ''}" data-action="adjust-date" data-date="${date}" data-month-id="${month.id}" ${month.status !== 'open' ? 'disabled' : ''}><span>${Number(date.slice(8))}</span><strong>${off ? 'OFF' : count}</strong>${custom && !off ? '<small>set</small>' : '<small>&nbsp;</small>'}</button>`;
  }).join('');
}

function mealsPage(state) {
  const monthId = state.mealMonthId || state.months[0]?.id || currentMonthId();
  const month = state.months.find(m => m.id === monthId);
  if (!month) return `<section class="page"><div class="empty-state"><strong>No month available.</strong></div></section>`;
  const data = monthDataFor(state, monthId);
  const loading = state.monthLoading === monthId && monthId !== currentMonthId();
  return `<section class="page"><div class="page-title-row"><div><span class="eyebrow">MEALS</span><h1>Meal Calendar</h1></div></div>${monthSelector(state, monthId, 'meal-month')}${month.status === 'open' ? `<div class="page-actions"><button class="btn secondary" data-action="open-meal-set" data-month-id="${month.id}">Set my meal</button><button class="btn secondary" data-action="open-mess-off" data-month-id="${month.id}">Mess off for a date</button></div>` : '<p class="info-note">This month is finalized and read-only.</p>'}${loading ? '<div class="inline-loading"><div class="spinner"></div></div>' : `<div class="calendar-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="calendar-grid">${calendarCells(state, month, data)}</div><p class="calendar-help">Tap a date to set your absolute meal count. “OFF” means meals are off for everyone that day.</p>`}</section>`;
}

function settlementPage(state) {
  const monthId = state.settlementMonthId || state.months[0]?.id || currentMonthId();
  const month = state.months.find(m => m.id === monthId);
  const data = monthDataFor(state, monthId);
  const settlement = buildSettlement({ month, members: state.members, ...data });
  const loading = state.monthLoading === monthId && monthId !== currentMonthId();
  return `<section class="page"><div class="page-title-row"><div><span class="eyebrow">SETTLEMENT</span><h1>Monthly Settlement</h1></div>${month?.status === 'closed' ? '<span class="subtle-badge">Finalized</span>' : ''}</div>${monthSelector(state, monthId, 'settlement-month')}${loading ? '<div class="inline-loading"><div class="spinner"></div></div>' : `${simpleSummary([['Total bazar', money(settlement.totalBazar)], ['Total utility', money(settlement.totalUtility)], ['Total meals', String(settlement.totalMeals)], ['Meal rate', money(settlement.mealRate)]])}<div class="section-head"><div><span class="eyebrow">MEMBERS</span><h2>Breakdown</h2></div></div><div class="settlement-cards">${settlement.rows.map(row => `<article class="settlement-card ${row.memberId === state.profile.memberId ? 'mine' : ''}"><div class="settlement-head"><div><strong>${escapeHtml(row.name)}</strong>${row.memberId === state.profile.memberId ? '<span class="you-pill">You</span>' : ''}</div><strong>${escapeHtml(balanceText(row.finalPayable))}</strong></div><div class="settlement-grid"><span>Meals <b>${row.finalMeals}</b></span><span>Rent <b>${money(row.rent)}</b></span><span>Bazar paid <b>${money(row.bazarPaid)}</b></span><span>Utility paid <b>${money(row.utilityPaid)}</b></span><span>Food cost <b>${money(row.foodCost)}</b></span><span>Utility share <b>${money(row.utilityShare)}</b></span></div></article>`).join('')}</div>${simpleSummary([['Total rent', money(totalRent(settlement))], ['Settlement check', money(settlement.rows.reduce((sum, row) => sum + row.finalPayable, 0))]])}${trendsSection(state)}`}</section>`;
}

function sparkline(points, formatValue) {
  if (points.length < 2) return '';
  const values = points.map(p => Number(p.value || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 320, height = 110, pad = 12;
  const coords = values.map((value, i) => {
    const x = pad + (i * (width - pad * 2)) / (values.length - 1);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y];
  });
  const poly = coords.map(([x, y]) => `${x},${y}`).join(' ');
  return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img"><polyline points="${poly}" fill="none" vector-effect="non-scaling-stroke"/><g>${coords.map(([x,y], i) => `<circle cx="${x}" cy="${y}" r="3"><title>${escapeHtml(points[i].label)}: ${escapeHtml(formatValue(points[i].value))}</title></circle>`).join('')}</g></svg><div class="trend-labels">${points.map(p => `<span>${escapeHtml(p.short)}</span>`).join('')}</div>`;
}

function trendsSection(state) {
  if (state.months.length < 2) return '';
  const points = state.months.slice().reverse().map(month => {
    const data = monthDataFor(state, month.id);
    if (!data._loaded && month.id !== currentMonthId() && !state.loadedMonthData[month.id]) return null;
    const s = buildSettlement({ month, members: state.members, ...data });
    return { id: month.id, label: monthLabel(month.id), short: monthLabel(month.id).slice(0, 3), mealRate: s.mealRate, utility: s.totalUtility };
  }).filter(Boolean);
  if (points.length < 2) return state.trendsLoading ? '<div class="section-head"><div><span class="eyebrow">TRENDS</span><h2>Loading…</h2></div></div>' : '';
  return `<div class="section-head"><div><span class="eyebrow">TRENDS</span><h2>Month to month</h2></div></div><div class="trend-card"><div class="trend-title"><strong>Meal rate</strong><span>${money(points.at(-1).mealRate)}</span></div>${sparkline(points.map(p => ({ value: p.mealRate, label: p.label, short: p.short })), money)}</div><div class="trend-card"><div class="trend-title"><strong>Utility total</strong><span>${money(points.at(-1).utility)}</span></div>${sparkline(points.map(p => ({ value: p.utility, label: p.label, short: p.short })), money)}</div>`;
}

function adminPage(state) {
  if (state.profile.role !== 'admin') return `<section class="page"><div class="empty-state"><strong>Admin only.</strong></div></section>`;
  const month = currentMonth(state);
  const slotsById = Object.fromEntries(state.claimSlots.map(slot => [slot.id, slot]));
  return `<section class="page"><div class="page-title-row"><div><span class="eyebrow">ADMIN</span><h1>Administration</h1></div></div>
    <div class="section-head"><div><span class="eyebrow">MONTHS</span><h2>Locking</h2></div></div>
    <div class="admin-list">${state.months.map(m => `<div class="admin-row"><div><strong>${escapeHtml(monthLabel(m.id))}</strong><small>${m.status === 'open' ? 'Changes allowed' : 'Finalized · read-only'}</small></div><button class="btn compact secondary" data-action="toggle-month" data-month-id="${m.id}">${m.status === 'open' ? 'Close' : 'Reopen'}</button></div>`).join('')}</div>

    <div class="section-head"><div><span class="eyebrow">MEMBERS</span><h2>Manage members</h2></div></div>
    <form class="admin-correction" data-form="add-member"><div class="two-col"><label>Nickname<input class="input" name="name" placeholder="Nickname" required></label><label>Monthly rent<input class="input" type="number" min="0" step="1" name="rent" placeholder="0" required></label></div><button class="btn secondary" type="submit">Add member</button><p class="helper">New members are included automatically when the next month is created.</p></form>
    <div class="admin-list member-admin-list">${state.members.map(member => { const slot = slotsById[member.id] || {}; return `<div class="member-admin-card"><form data-form="member" data-member-id="${escapeHtml(member.id)}"><div class="two-col"><label>Nickname<input class="input" name="name" value="${escapeHtml(member.name)}" required></label><label>Monthly rent<input class="input" type="number" min="0" step="1" name="rent" value="${Number(member.currentRent || 0)}" required></label></div><div class="member-actions"><button class="btn compact secondary" type="submit">Save</button>${member.id !== 'kawchar' ? `<button class="btn compact ghost-border" type="button" data-action="toggle-member" data-member-id="${escapeHtml(member.id)}" data-active="${member.active ? 'false' : 'true'}">${member.active ? 'Remove' : 'Restore'}</button>` : ''}${slot.claimedByEmail && member.id !== 'kawchar' ? `<button class="btn compact ghost-border" type="button" data-action="unclaim" data-member-id="${escapeHtml(member.id)}">Unclaim</button>` : ''}</div><small class="muted">${member.active ? 'Active' : 'Removed'} · ${slot.claimedByEmail ? escapeHtml(slot.claimedByEmail) : 'Not claimed'}</small></form></div>`; }).join('')}</div>
    <p class="tiny muted">“Remove” archives a member for future months. Historical settlements remain intact.</p>

    <div class="section-head"><div><span class="eyebrow">MEAL CORRECTION</span><h2>Set any member's meal</h2></div></div>
    <form class="admin-correction" data-form="admin-meal"><label>Member<select class="input" name="memberId" required>${state.members.filter(m => month?.activeMemberIds?.includes(m.id)).map(member => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)}</option>`).join('')}</select></label><div class="two-col"><label>Date<input class="input" type="date" name="date" min="${month ? monthStartISO(month.id) : todayISO()}" max="${month ? lastDateOfMonth(month.id) : todayISO()}" value="${todayISO()}" required></label><label>Meal count<input class="input" type="number" name="count" min="0" max="20" step="1" value="1" required></label></div><button class="btn secondary" type="submit" ${!month || month.status !== 'open' ? 'disabled' : ''}>Save meal count</button></form>

    <div class="section-head"><div><span class="eyebrow">ACCOUNT</span><h2>Session</h2></div></div><button class="btn ghost-border full" data-action="sign-out">${icon('logout')} Sign out</button>
  </section>`;
}

function expenseModal(state) {
  const modal = state.modal;
  if (!modal || modal.type !== 'expense') return '';
  const value = modal.value;
  const month = state.months.find(m => m.id === modal.monthId);
  return `<div class="modal-backdrop" data-modal-backdrop><section class="modal-card" role="dialog" aria-modal="true"><div class="modal-head"><div><span class="eyebrow">${modal.editingId ? 'EDIT' : 'ADD'}</span><h2>${value.type === 'bazar' ? 'Bazar' : 'Utility'}</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">×</button></div><form data-form="expense"><label>Date<input class="input" type="date" name="date" min="${monthStartISO(modal.monthId)}" max="${lastDateOfMonth(modal.monthId)}" value="${escapeHtml(value.date)}" required></label>${modal.lockType ? `<input type="hidden" name="type" value="${escapeHtml(value.type)}">` : `<div class="segmented"><label><input type="radio" name="type" value="bazar" ${value.type === 'bazar' ? 'checked' : ''}><span>Bazar</span></label><label><input type="radio" name="type" value="utility" ${value.type === 'utility' ? 'checked' : ''}><span>Utility</span></label></div>`}<label>Amount<input class="input amount-input" type="number" min="0.01" step="0.01" inputmode="decimal" name="amount" value="${escapeHtml(value.amount)}" placeholder="0" required></label><label>Note (optional)<input class="input" type="text" name="note" value="${escapeHtml(value.note)}" placeholder="e.g. Rice and chicken"></label><button class="btn full primary" type="submit" ${month?.status !== 'open' ? 'disabled' : ''}>${modal.editingId ? 'Save changes' : 'Add expense'}</button>${modal.editingId ? `<button class="btn full ghost-border" type="button" data-action="delete-expense" data-expense-id="${escapeHtml(modal.editingId)}" ${month?.status !== 'open' ? 'disabled' : ''}>Delete transaction</button>` : ''}</form></section></div>`;
}

function mealModal(state) {
  const modal = state.modal;
  if (!modal || modal.type !== 'meal') return '';
  const month = state.months.find(m => m.id === modal.monthId);
  return `<div class="modal-backdrop" data-modal-backdrop><section class="modal-card" role="dialog" aria-modal="true"><div class="modal-head"><div><span class="eyebrow">MY MEAL</span><h2>Set meal count</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">×</button></div><form data-form="meal"><label>Date<input class="input" type="date" name="date" data-action="meal-modal-date" min="${monthStartISO(modal.monthId)}" max="${lastDateOfMonth(modal.monthId)}" value="${escapeHtml(modal.date)}" required></label>${modal.messOff ? '<div class="info-note">Meals are off for everyone on this date. Your personal setting is preserved but the effective count is 0 until Mess Off is cancelled.</div>' : ''}<div class="modal-counter"><button type="button" class="count-button" data-action="modal-meal-step" data-delta="-1" ${modal.count <= 0 ? 'disabled' : ''}>${icon('minus')}</button><strong>${modal.count}</strong><button type="button" class="count-button" data-action="modal-meal-step" data-delta="1">${icon('plus')}</button></div><input type="hidden" name="count" value="${modal.count}"><button class="btn full primary" type="submit" ${month?.status !== 'open' ? 'disabled' : ''}>Save</button></form></section></div>`;
}

function mealRangeModal(state) {
  const modal = state.modal;
  if (!modal || modal.type !== 'meal-range') return '';
  const month = state.months.find(m => m.id === modal.monthId);
  const rangeDates = datesBetween(modal.startDate, modal.endDate);
  const dayCount = rangeDates.length;
  const dayLabel = `${dayCount} ${dayCount === 1 ? 'day' : 'days'}`;

  return `<div class="modal-backdrop" data-modal-backdrop><section class="modal-card" role="dialog" aria-modal="true"><div class="modal-head"><div><span class="eyebrow">MY MEAL</span><h2>Set meal range</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">×</button></div><form data-form="meal-range"><div class="two-col range-date-grid"><label>From<input class="input" type="date" name="startDate" data-action="meal-range-start" min="${monthStartISO(modal.monthId)}" max="${lastDateOfMonth(modal.monthId)}" value="${escapeHtml(modal.startDate)}" required></label><label>To<input class="input" type="date" name="endDate" data-action="meal-range-end" min="${escapeHtml(modal.startDate)}" max="${lastDateOfMonth(modal.monthId)}" value="${escapeHtml(modal.endDate)}" required></label></div><div class="range-count-label">Meal count</div><div class="modal-counter"><button type="button" class="count-button" data-action="modal-meal-step" data-delta="-1" ${modal.count <= 0 ? 'disabled' : ''}>${icon('minus')}</button><strong>${modal.count}</strong><button type="button" class="count-button" data-action="modal-meal-step" data-delta="1">${icon('plus')}</button></div><input type="hidden" name="count" value="${modal.count}"><div class="range-day-count">${dayCount ? `Applies to <strong>${dayLabel}</strong>` : 'Choose an end date on or after the start date.'}</div><button class="btn full primary" type="submit" ${!dayCount || month?.status !== 'open' ? 'disabled' : ''}>${dayCount ? `Apply to ${dayLabel}` : 'Apply'}</button></form></section></div>`;
}

function messOffModal(state) {
  const modal = state.modal;
  if (!modal || modal.type !== 'mess-off') return '';
  const month = state.months.find(m => m.id === modal.monthId);
  return `<div class="modal-backdrop" data-modal-backdrop><section class="modal-card" role="dialog" aria-modal="true"><div class="modal-head"><div><span class="eyebrow">ALL MEMBERS</span><h2>Mess meal status</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Close">×</button></div><form data-form="mess-off"><label>Date<input class="input" type="date" name="date" data-action="mess-off-date" min="${monthStartISO(modal.monthId)}" max="${lastDateOfMonth(modal.monthId)}" value="${escapeHtml(modal.date)}" required></label><div class="status-panel"><span>Current status</span><strong>${modal.messOff ? 'Meals off for everyone' : 'Meals on'}</strong></div><button class="btn full ${modal.messOff ? 'secondary' : 'primary'}" type="submit" ${month?.status !== 'open' ? 'disabled' : ''}>${modal.messOff ? 'Turn meals back on' : 'Turn meals off for everyone'}</button></form></section></div>`;
}

function appContent(state) {
  const pages = { home: homePage, expenses: expensesPage, meals: mealsPage, settlement: settlementPage, admin: adminPage };
  const renderer = pages[state.route] || homePage;
  return `<main class="content">${renderer(state)}</main>${bottomNav(state)}${expenseModal(state)}${mealModal(state)}${mealRangeModal(state)}${messOffModal(state)}`;
}

export function render(state) {
  if (state.fatalError) return errorScreen(state.fatalError);
  if (!state.authReady) return loadingScreen();
  if (!state.user) return signInScreen();
  if (state.profileLoading) return loadingScreen('Preparing your account…');
  if (!state.profile) return claimScreen(state);
  if (!state.dataReady) return loadingScreen('Loading mess data…');
  return appContent(state);
}

export function showToast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2600);
}