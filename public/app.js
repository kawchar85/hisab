import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { ADMIN_EMAIL } from './js/constants.js';
import { currentMonthId, datesBetween, todayISO } from './js/date.js';
import {
  baselineMealCount,
  isMessOff,
  mealsForMemberOnDate,
  personalMealCountOnDate
} from './js/calculations.js';
import { initFirebase } from './js/firebase.js';
import {
  addExpense,
  addMember,
  adminUnclaimMember,
  bootstrapIfNeeded,
  claimMember,
  ensureCurrentMonthForAdmin,
  ensureMonthExists,
  loadMonthDataOnce,
  newExpenseDefaults,
  removeExpense,
  setMealOverride,
  setMemberActive,
  setMessOff,
  setMonthStatus,
  subscribeClaimSlots,
  subscribeMembers,
  subscribeMonthData,
  subscribeMonths,
  subscribeProfile,
  updateExpense,
  updateMemberDetails
} from './js/data.js';
import { render, showToast } from './js/ui.js';

const root = document.getElementById('app');
let auth;
let db;
let unsubProfile = null;
let unsubClaimSlots = null;
let unsubMembers = null;
let unsubMonths = null;
let unsubCurrentMonthData = null;
let fullDataStartedForUid = null;

const emptyMonthData = () => ({ expenses: [], overrides: [], mealDays: [] });

function parseRouteHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'member-detail') {
    return {
      route: 'member-detail',
      monthId: parts[1] || currentMonthId(),
      memberId: parts[2] ? decodeURIComponent(parts[2]) : null
    };
  }

  const allowed = ['home', 'expenses', 'meals', 'settlement', 'admin'];
  return {
    route: allowed.includes(parts[0]) ? parts[0] : 'home',
    monthId: null,
    memberId: null
  };
}

const initialRoute = parseRouteHash();

const state = {
  authReady: false,
  user: null,
  profile: null,
  profileLoading: false,
  claimSlots: [],
  members: [],
  months: [],
  currentMonthData: emptyMonthData(),
  loadedMonthData: {},
  monthLoading: null,
  trendsLoading: false,
  membersLoaded: false,
  monthsLoaded: false,
  dataReady: false,
  route: initialRoute.route,
  expenseFilter: 'all',
  expenseMonthId: currentMonthId(),
  mealMonthId: currentMonthId(),
  settlementMonthId: initialRoute.monthId || currentMonthId(),
  settlementMemberId: initialRoute.memberId,
  settlementScrollY: 0,
  modal: null,
  fatalError: null
};

function setState(patch = {}) {
  Object.assign(state, patch);
  state.dataReady = state.membersLoaded && state.monthsLoaded;
  root.innerHTML = render(state);
}

function resetDataSubscriptions() {
  for (const unsub of [unsubMembers, unsubMonths, unsubCurrentMonthData]) {
    if (typeof unsub === 'function') unsub();
  }
  unsubMembers = null;
  unsubMonths = null;
  unsubCurrentMonthData = null;
  fullDataStartedForUid = null;
  state.members = [];
  state.months = [];
  state.currentMonthData = emptyMonthData();
  state.loadedMonthData = {};
  state.membersLoaded = false;
  state.monthsLoaded = false;
  state.dataReady = false;
}

function resetAuthSubscriptions() {
  if (typeof unsubProfile === 'function') unsubProfile();
  if (typeof unsubClaimSlots === 'function') unsubClaimSlots();
  unsubProfile = null;
  unsubClaimSlots = null;
  resetDataSubscriptions();
}

function handleDataError(error) {
  console.error(error);
  showToast(error.message || 'Could not load data.', 'error');
}

function normalizeSelectedMonths() {
  if (!state.months.length) return;
  const latest = state.months[0].id;
  for (const key of ['expenseMonthId', 'mealMonthId', 'settlementMonthId']) {
    if (!state.months.some(month => month.id === state[key])) state[key] = latest;
  }
}

function startFullData(profile) {
  if (!profile || fullDataStartedForUid === profile.uid) return;
  resetDataSubscriptions();
  fullDataStartedForUid = profile.uid;

  if (profile.role === 'admin') ensureCurrentMonthForAdmin(db, profile).catch(handleDataError);

  unsubMembers = subscribeMembers(db, members => {
    state.members = members;
    state.membersLoaded = true;
    setState();
  }, handleDataError);

  unsubMonths = subscribeMonths(db, months => {
    state.months = months;
    normalizeSelectedMonths();
    state.monthsLoaded = true;
    setState();
    if (state.route === 'member-detail' && state.settlementMonthId !== currentMonthId()) {
      loadHistoricalMonth(state.settlementMonthId).catch(handleDataError);
    }
  }, handleDataError);

  unsubCurrentMonthData = subscribeMonthData(db, currentMonthId(), data => {
    state.currentMonthData = data;
    setState();
  }, handleDataError);
}

async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      return;
    }
    if (error.code === 'auth/popup-blocked') {
      throw new Error('Google sign-in was blocked by the browser. Allow pop-ups for this site and try again.');
    }
    throw error;
  }
}

async function loadHistoricalMonth(monthId) {
  if (!monthId || monthId === currentMonthId() || state.loadedMonthData[monthId] || state.monthLoading === monthId) return;
  state.monthLoading = monthId;
  setState();
  try {
    const data = await loadMonthDataOnce(db, monthId);
    state.loadedMonthData[monthId] = { ...data, _loaded: true };
  } finally {
    state.monthLoading = null;
    setState();
  }
}

async function loadAllMonthsForTrends() {
  if (state.trendsLoading || state.months.length < 2) return;
  const missing = state.months.filter(month => month.id !== currentMonthId() && !state.loadedMonthData[month.id]);
  if (!missing.length) return;
  state.trendsLoading = true;
  setState();
  try {
    await Promise.all(missing.map(async month => {
      const data = await loadMonthDataOnce(db, month.id);
      state.loadedMonthData[month.id] = { ...data, _loaded: true };
    }));
  } catch (error) {
    handleDataError(error);
  } finally {
    state.trendsLoading = false;
    setState();
  }
}

function monthById(monthId) {
  return state.months.find(month => month.id === monthId) || null;
}

function currentMonth() {
  return monthById(currentMonthId());
}

function monthData(monthId) {
  return monthId === currentMonthId() ? state.currentMonthData : (state.loadedMonthData[monthId] || emptyMonthData());
}

function findExpense(expenseId) {
  const all = [
    ...state.currentMonthData.expenses,
    ...Object.values(state.loadedMonthData).flatMap(item => item.expenses || [])
  ];
  return all.find(item => item.id === expenseId) || null;
}

async function setAbsoluteMeal(memberId, date, count) {
  const month = monthById(date.slice(0, 7));
  if (!month || month.status !== 'open') throw new Error('This month is finalized.');
  if (!month.activeMemberIds?.includes(memberId)) throw new Error('This member is not part of the selected month.');
  const base = baselineMealCount(memberId, date, month);
  await setMealOverride(db, state.profile, memberId, date, count, base);
}

async function setMealRange(memberId, startDate, endDate, count) {
  const monthId = startDate.slice(0, 7);
  if (endDate.slice(0, 7) !== monthId) throw new Error('The range must stay within one month.');

  const month = monthById(monthId);
  if (!month || month.status !== 'open') throw new Error('This month is finalized.');
  if (!month.activeMemberIds?.includes(memberId)) throw new Error('This member is not part of the selected month.');

  const dates = datesBetween(startDate, endDate);
  if (!dates.length) throw new Error('Choose a valid date range.');

  const data = monthData(monthId);
  const existingDates = new Set(
    data.overrides
      .filter(item => item.memberId === memberId)
      .map(item => item.date)
  );

  await Promise.all(dates.map(date => {
    const base = baselineMealCount(memberId, date, month);
    if (Number(count) === base && !existingDates.has(date)) return Promise.resolve();
    return setMealOverride(db, state.profile, memberId, date, count, base);
  }));

  return dates.length;
}

async function quickMeal(delta, date = todayISO()) {
  const month = currentMonth();
  if (!month || month.status !== 'open') throw new Error('This month is finalized.');
  const data = state.currentMonthData;
  if (isMessOff(date, data.mealDays)) throw new Error('Meals are off for everyone today.');
  const current = mealsForMemberOnDate(state.profile.memberId, date, month, data.overrides, data.mealDays);
  const next = current + Number(delta);
  if (next < 0) throw new Error('Meal count cannot go below zero.');
  await setAbsoluteMeal(state.profile.memberId, date, next);
}

function openExpenseModal(type = 'bazar', expense = null, options = {}) {
  const monthId = expense?.monthId || options.monthId || state.expenseMonthId || currentMonthId();
  const value = expense ? {
    date: expense.date,
    type: expense.type,
    amount: expense.amount,
    note: expense.note || ''
  } : newExpenseDefaults(type, monthId);

  state.modal = {
    type: 'expense',
    value,
    editingId: expense?.id || null,
    monthId,
    lockType: expense ? false : Boolean(options.lockType)
  };
  setState();
}

function openMealModal(date = todayISO(), monthId = null) {
  const targetMonthId = monthId || date.slice(0, 7) || currentMonthId();
  const month = monthById(targetMonthId);
  const data = monthData(targetMonthId);
  const targetDate = date.slice(0, 7) === targetMonthId ? date : `${targetMonthId}-01`;
  const count = personalMealCountOnDate(state.profile.memberId, targetDate, month, data.overrides);
  state.modal = {
    type: 'meal', monthId: targetMonthId, date: targetDate, count,
    messOff: isMessOff(targetDate, data.mealDays)
  };
  setState();
}

function openMealRangeModal(monthId = currentMonthId()) {
  const startDate = monthId === currentMonthId() ? todayISO() : `${monthId}-01`;
  state.modal = {
    type: 'meal-range',
    monthId,
    startDate,
    endDate: startDate,
    count: 0
  };
  setState();
}

function openMessOffModal(date = todayISO(), monthId = null) {
  const targetMonthId = monthId || date.slice(0, 7) || currentMonthId();
  const targetDate = date.slice(0, 7) === targetMonthId ? date : `${targetMonthId}-01`;
  const data = monthData(targetMonthId);
  state.modal = { type: 'mess-off', monthId: targetMonthId, date: targetDate, messOff: isMessOff(targetDate, data.mealDays) };
  setState();
}

function closeModal() {
  state.modal = null;
  setState();
}

async function handleAction(target) {
  const el = target.closest('[data-action]');
  const action = el?.dataset.action;
  if (!action || !el) return false;

  try {
    switch (action) {
      case 'sign-in': await signIn(); break;
      case 'sign-out': await signOut(auth); break;
      case 'reload': location.reload(); break;
      case 'claim':
        el.disabled = true;
        await claimMember(db, state.user, el.dataset.memberId);
        showToast('Name claimed successfully.');
        break;
      case 'open-expense':
        openExpenseModal(el.dataset.type || 'bazar', null, {
          monthId: el.dataset.monthId || currentMonthId(),
          lockType: el.dataset.lockType === 'true'
        });
        break;
      case 'close-modal': closeModal(); break;
      case 'quick-meal':
        el.disabled = true;
        await quickMeal(Number(el.dataset.delta));
        showToast('Meal count updated.');
        break;
      case 'open-meal-set':
        openMealModal(
          (el.dataset.monthId && el.dataset.monthId !== currentMonthId()) ? `${el.dataset.monthId}-01` : todayISO(),
          el.dataset.monthId || currentMonthId()
        );
        break;
      case 'open-meal-range':
        openMealRangeModal(el.dataset.monthId || currentMonthId());
        break;
      case 'adjust-date':
        openMealModal(el.dataset.date, el.dataset.monthId);
        break;
      case 'modal-meal-step':
        state.modal.count = Math.max(0, Math.min(20, Number(state.modal.count || 0) + Number(el.dataset.delta || 0)));
        setState();
        break;
      case 'open-mess-off':
        openMessOffModal(
          (el.dataset.monthId && el.dataset.monthId !== currentMonthId()) ? `${el.dataset.monthId}-01` : todayISO(),
          el.dataset.monthId || currentMonthId()
        );
        break;
      case 'open-member-detail': {
        const memberId = el.dataset.memberId;
        const monthId = el.dataset.monthId || state.settlementMonthId || currentMonthId();
        if (!memberId) return true;
        state.settlementScrollY = window.scrollY;
        state.settlementMemberId = memberId;
        state.settlementMonthId = monthId;
        state.route = 'member-detail';
        location.hash = `#/member-detail/${monthId}/${encodeURIComponent(memberId)}`;
        await loadHistoricalMonth(monthId);
        setState();
        break;
      }
      case 'back-settlement':
        location.hash = '#/settlement';
        break;
      case 'expense-filter':
        state.expenseFilter = el.dataset.filter || 'all';
        setState();
        break;
      case 'edit-expense': {
        const expense = findExpense(el.dataset.expenseId);
        if (expense) openExpenseModal(expense.type, expense);
        break;
      }
      case 'delete-expense':
        if (!confirm('Delete this transaction?')) return true;
        await removeExpense(db, el.dataset.expenseId);
        closeModal();
        showToast('Transaction deleted.');
        break;
      case 'toggle-month': {
        const month = monthById(el.dataset.monthId || currentMonthId());
        if (!month) return true;
        const next = month.status === 'open' ? 'closed' : 'open';
        const message = next === 'closed'
          ? `Finalize ${month.id}? Expenses and meal changes will become read-only.`
          : `Reopen ${month.id}? Members will be able to change data again.`;
        if (!confirm(message)) return true;
        await setMonthStatus(db, month.id, next);
        showToast(next === 'closed' ? 'Month finalized.' : 'Month reopened.');
        break;
      }
      case 'create-current-month':
        await ensureMonthExists(db, currentMonthId());
        showToast('Current month created.');
        break;
      case 'toggle-member': {
        const member = state.members.find(item => item.id === el.dataset.memberId);
        if (!member) return true;
        const active = el.dataset.active === 'true';
        if (!active && !confirm(`Remove ${member.name}? Historical data will be kept.`)) return true;
        await setMemberActive(db, member.id, active);
        showToast(active ? `${member.name} restored.` : `${member.name} removed for future months.`);
        break;
      }
      case 'unclaim': {
        const slot = state.claimSlots.find(item => item.id === el.dataset.memberId);
        if (!slot) return true;
        if (!confirm(`Unclaim ${slot.name} from ${slot.claimedByEmail}?`)) return true;
        await adminUnclaimMember(db, slot);
        showToast(`${slot.name} is available to claim again.`);
        break;
      }
      default: return false;
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Action failed.', 'error');
  }
  return true;
}

root.addEventListener('click', async event => {
  if (event.target.matches('[data-modal-backdrop]')) {
    closeModal();
    return;
  }

  const routeButton = event.target.closest('[data-route]');
  if (routeButton) {
    state.route = routeButton.dataset.route;
    if (state.route !== 'member-detail') state.settlementMemberId = null;
    location.hash = `#/${state.route}`;
    if (state.route === 'settlement') loadAllMonthsForTrends();
    setState();
    return;
  }
  await handleAction(event.target);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.modal) {
    closeModal();
  }
});

root.addEventListener('change', async event => {
  const target = event.target;

  if (target.dataset.action === 'expense-month') {
    state.expenseMonthId = target.value;
    await loadHistoricalMonth(target.value);
    setState();
    return;
  }
  if (target.dataset.action === 'meal-month') {
    state.mealMonthId = target.value;
    await loadHistoricalMonth(target.value);
    setState();
    return;
  }
  if (target.dataset.action === 'settlement-month') {
    state.settlementMonthId = target.value;
    await loadHistoricalMonth(target.value);
    loadAllMonthsForTrends();
    setState();
    return;
  }
  if (target.dataset.action === 'meal-modal-date' && state.modal?.type === 'meal') {
    const month = monthById(state.modal.monthId);
    const data = monthData(state.modal.monthId);
    state.modal.date = target.value;
    state.modal.count = personalMealCountOnDate(state.profile.memberId, target.value, month, data.overrides);
    state.modal.messOff = isMessOff(target.value, data.mealDays);
    setState();
    return;
  }
  if (target.dataset.action === 'meal-range-start' && state.modal?.type === 'meal-range') {
    state.modal.startDate = target.value;
    if (state.modal.endDate < state.modal.startDate) state.modal.endDate = state.modal.startDate;
    setState();
    return;
  }
  if (target.dataset.action === 'meal-range-end' && state.modal?.type === 'meal-range') {
    state.modal.endDate = target.value;
    setState();
    return;
  }
  if (target.dataset.action === 'mess-off-date' && state.modal?.type === 'mess-off') {
    const data = monthData(state.modal.monthId);
    state.modal.date = target.value;
    state.modal.messOff = isMessOff(target.value, data.mealDays);
    setState();
  }
});

root.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  try {
    if (form.dataset.form === 'expense') {
      const values = Object.fromEntries(new FormData(form).entries());
      const month = monthById(state.modal.monthId);
      if (!month || month.status !== 'open') throw new Error('This month is finalized.');
      if (!['bazar', 'utility'].includes(values.type)) throw new Error('Choose Bazar or Utility.');
      if (values.date.slice(0, 7) !== state.modal.monthId) throw new Error('The date must stay in the selected month.');
      const amount = Number(values.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount.');
      form.querySelector('button[type="submit"]').disabled = true;
      if (state.modal.editingId) {
        await updateExpense(db, state.modal.editingId, values);
        showToast('Transaction updated.');
      } else {
        await addExpense(db, state.profile, values);
        showToast('Expense added.');
      }
      closeModal();
      return;
    }

    if (form.dataset.form === 'meal') {
      const values = Object.fromEntries(new FormData(form).entries());
      const count = Number(values.count);
      if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error('Meal count must be a whole number from 0 to 20.');
      await setAbsoluteMeal(state.profile.memberId, values.date, count);
      showToast('Meal count saved.');
      closeModal();
      return;
    }

    if (form.dataset.form === 'meal-range') {
      const values = Object.fromEntries(new FormData(form).entries());
      const count = Number(values.count);
      if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error('Meal count must be a whole number from 0 to 20.');
      if (values.startDate.slice(0, 7) !== state.modal.monthId || values.endDate.slice(0, 7) !== state.modal.monthId) {
        throw new Error('The range must stay in the selected month.');
      }
      const dates = datesBetween(values.startDate, values.endDate);
      if (!dates.length) throw new Error('Choose an end date on or after the start date.');
      if (dates.length > 3 && !confirm(`Set your meal count to ${count} for ${dates.length} days?`)) return;
      form.querySelector('button[type="submit"]').disabled = true;
      const updatedDays = await setMealRange(state.profile.memberId, values.startDate, values.endDate, count);
      showToast(`Meal count updated for ${updatedDays} ${updatedDays === 1 ? 'day' : 'days'}.`);
      closeModal();
      return;
    }

    if (form.dataset.form === 'mess-off') {
      const values = Object.fromEntries(new FormData(form).entries());
      const month = monthById(state.modal.monthId);
      if (!month || month.status !== 'open') throw new Error('This month is finalized.');
      const next = !state.modal.messOff;
      if (next && !confirm(`Turn meals off for everyone on ${values.date}?`)) return;
      await setMessOff(db, state.profile, values.date, next);
      showToast(next ? 'Meals turned off for everyone.' : 'Meals turned back on.');
      closeModal();
      return;
    }

    if (form.dataset.form === 'admin-meal') {
      const values = Object.fromEntries(new FormData(form).entries());
      const count = Number(values.count);
      if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error('Meal count must be a whole number from 0 to 20.');
      await setAbsoluteMeal(values.memberId, values.date, count);
      showToast('Member meal count saved.');
      return;
    }

    if (form.dataset.form === 'member') {
      const values = Object.fromEntries(new FormData(form).entries());
      await updateMemberDetails(db, form.dataset.memberId, { name: values.name, currentRent: values.rent });
      showToast('Member updated.');
      return;
    }

    if (form.dataset.form === 'add-member') {
      const values = Object.fromEntries(new FormData(form).entries());
      const maxOrder = Math.max(0, ...state.members.map(m => Number(m.sortOrder || 0)));
      await addMember(db, { name: values.name, currentRent: values.rent, sortOrder: maxOrder + 1 });
      form.reset();
      showToast('Member added for future months.');
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Could not save.', 'error');
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = false;
  }
});

window.addEventListener('hashchange', async () => {
  const previousRoute = state.route;
  const parsed = parseRouteHash();
  state.route = parsed.route;
  if (parsed.monthId) state.settlementMonthId = parsed.monthId;
  state.settlementMemberId = parsed.route === 'member-detail' ? parsed.memberId : null;

  if (state.route === 'member-detail') {
    await loadHistoricalMonth(state.settlementMonthId);
  } else if (state.route === 'settlement') {
    loadAllMonthsForTrends();
  }

  setState();
  if (previousRoute === 'member-detail' && state.route === 'settlement') {
    requestAnimationFrame(() => window.scrollTo(0, state.settlementScrollY || 0));
  }
});

async function start() {
  try {
    ({ auth, db } = await initFirebase());

    onAuthStateChanged(auth, async user => {
      resetAuthSubscriptions();
      state.user = user;
      state.profile = null;
      state.claimSlots = [];
      state.profileLoading = Boolean(user);
      state.authReady = true;
      setState();

      if (!user) return;

      try {
        if (user.email?.toLowerCase() === ADMIN_EMAIL) await bootstrapIfNeeded(db, user);
      } catch (error) {
        console.error(error);
        state.fatalError = `Admin bootstrap failed: ${error.message}`;
        setState();
        return;
      }

      unsubClaimSlots = subscribeClaimSlots(db, slots => {
        state.claimSlots = slots;
        setState();
      }, handleDataError);

      unsubProfile = subscribeProfile(db, user.uid, profile => {
        state.profile = profile;
        state.profileLoading = false;
        if (profile) startFullData(profile);
        setState();
      }, error => {
        state.profileLoading = false;
        handleDataError(error);
        setState();
      });
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(console.warn);
      });
    }
  } catch (error) {
    console.error(error);
    state.authReady = true;
    state.fatalError = error.message;
    setState();
  }
}

start();