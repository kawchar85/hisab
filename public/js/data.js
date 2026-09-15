import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { ADMIN_EMAIL, DEFAULT_MEALS, INITIAL_MEMBERS } from './constants.js';
import { currentMonthId, monthStartISO, todayISO } from './date.js';

export async function bootstrapIfNeeded(db, user) {
  if (!user?.email || user.email.toLowerCase() !== ADMIN_EMAIL) return false;

  const configRef = doc(db, 'system', 'config');
  const nowMonth = currentMonthId();

  await runTransaction(db, async tx => {
    const configSnap = await tx.get(configRef);

    if (!configSnap.exists()) {
      tx.set(configRef, {
        adminEmail: ADMIN_EMAIL,
        timeZone: 'Asia/Dhaka',
        createdAt: serverTimestamp()
      });

      const rentByMember = {};
      const activeMemberIds = [];

      for (const member of INITIAL_MEMBERS) {
        rentByMember[member.id] = member.currentRent;
        activeMemberIds.push(member.id);

        tx.set(doc(db, 'members', member.id), {
          name: member.name,
          currentRent: member.currentRent,
          active: true,
          role: member.role,
          sortOrder: member.sortOrder,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        tx.set(doc(db, 'claimSlots', member.id), {
          name: member.name,
          active: true,
          sortOrder: member.sortOrder,
          claimedByUid: member.id === 'kawchar' ? user.uid : null,
          claimedByEmail: member.id === 'kawchar' ? ADMIN_EMAIL : null,
          claimedAt: member.id === 'kawchar' ? serverTimestamp() : null
        });
      }

      tx.set(doc(db, 'users', user.uid), {
        email: ADMIN_EMAIL,
        memberId: 'kawchar',
        role: 'admin',
        createdAt: serverTimestamp()
      });

      tx.set(doc(db, 'months', nowMonth), {
        id: nowMonth,
        startDate: monthStartISO(nowMonth),
        status: 'open',
        activeMemberIds,
        rentByMember,
        weekdayDefault: DEFAULT_MEALS.weekday,
        fridayDefault: DEFAULT_MEALS.friday,
        saturdayDefault: DEFAULT_MEALS.saturday,
        createdAt: serverTimestamp(),
        closedAt: null
      });
      return;
    }

    const userRef = doc(db, 'users', user.uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) {
      tx.set(userRef, {
        email: ADMIN_EMAIL,
        memberId: 'kawchar',
        role: 'admin',
        createdAt: serverTimestamp()
      });
      tx.set(doc(db, 'claimSlots', 'kawchar'), {
        claimedByUid: user.uid,
        claimedByEmail: ADMIN_EMAIL,
        claimedAt: serverTimestamp()
      }, { merge: true });
    }
  });

  await ensureMonthExists(db, nowMonth);
  return true;
}

export async function ensureMonthExists(db, monthId) {
  const monthRef = doc(db, 'months', monthId);
  const monthSnap = await getDoc(monthRef);
  if (monthSnap.exists()) return;

  const memberSnaps = await getDocs(collection(db, 'members'));
  const members = memberSnaps.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(item => item.active)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const activeMemberIds = members.map(item => item.id);
  const rentByMember = Object.fromEntries(members.map(item => [item.id, Number(item.currentRent || 0)]));

  await setDoc(monthRef, {
    id: monthId,
    startDate: monthStartISO(monthId),
    status: 'open',
    activeMemberIds,
    rentByMember,
    weekdayDefault: DEFAULT_MEALS.weekday,
    fridayDefault: DEFAULT_MEALS.friday,
    saturdayDefault: DEFAULT_MEALS.saturday,
    createdAt: serverTimestamp(),
    closedAt: null
  });
}

export function subscribeProfile(db, uid, callback, onError) {
  return onSnapshot(doc(db, 'users', uid), snap => {
    callback(snap.exists() ? { uid: snap.id, ...snap.data() } : null);
  }, onError);
}

export function subscribeClaimSlots(db, callback, onError) {
  return onSnapshot(collection(db, 'claimSlots'), snap => {
    callback(snap.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
  }, onError);
}

export function subscribeMembers(db, callback, onError) {
  return onSnapshot(collection(db, 'members'), snap => {
    callback(snap.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
  }, onError);
}

export function subscribeMonths(db, callback, onError) {
  return onSnapshot(collection(db, 'months'), snap => {
    callback(snap.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => b.id.localeCompare(a.id)));
  }, onError);
}

function snapItems(snap) {
  return snap.docs.map(item => {
    const data = item.data();
    return { id: item.id, ...data, createdAtMs: data.createdAt?.toMillis?.() || data.updatedAt?.toMillis?.() || 0 };
  });
}

export function subscribeMonthData(db, monthId, callback, onError) {
  const specs = [
    ['expenses', 'expenses'],
    ['mealAdjustments', 'adjustments'],
    ['mealOverrides', 'overrides'],
    ['mealDays', 'mealDays']
  ];
  const state = { expenses: [], adjustments: [], overrides: [], mealDays: [] };
  const emit = () => callback({
    expenses: [...state.expenses].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAtMs || 0) - (a.createdAtMs || 0)),
    adjustments: [...state.adjustments].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAtMs || 0) - (a.createdAtMs || 0)),
    overrides: [...state.overrides].sort((a, b) => b.date.localeCompare(a.date)),
    mealDays: [...state.mealDays].sort((a, b) => b.date.localeCompare(a.date))
  });

  const unsubs = specs.map(([collectionName, key]) => {
    const q = query(collection(db, collectionName), where('monthId', '==', monthId));
    return onSnapshot(q, snap => {
      state[key] = snapItems(snap);
      emit();
    }, onError);
  });
  return () => unsubs.forEach(unsub => unsub());
}

export async function claimMember(db, user, memberId) {
  const userRef = doc(db, 'users', user.uid);
  const slotRef = doc(db, 'claimSlots', memberId);

  await runTransaction(db, async tx => {
    const [userSnap, slotSnap] = await Promise.all([tx.get(userRef), tx.get(slotRef)]);
    if (userSnap.exists()) throw new Error('This Google account has already claimed a member.');
    if (!slotSnap.exists()) throw new Error('Member slot not found.');

    const slot = slotSnap.data();
    if (!slot.active) throw new Error('This member slot is inactive.');
    if (slot.claimedByUid || slot.claimedByEmail) throw new Error(`${slot.name} has already been claimed.`);

    tx.update(slotRef, {
      claimedByUid: user.uid,
      claimedByEmail: user.email,
      claimedAt: serverTimestamp()
    });
    tx.set(userRef, {
      email: user.email,
      memberId,
      role: 'member',
      createdAt: serverTimestamp()
    });
  });
}

export async function addExpense(db, profile, values) {
  const ref = doc(collection(db, 'expenses'));
  await setDoc(ref, {
    date: values.date,
    monthId: values.date.slice(0, 7),
    type: values.type,
    amount: Number(values.amount),
    note: values.note?.trim() || '',
    ownerUid: profile.uid,
    memberId: profile.memberId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateExpense(db, expenseId, values) {
  await updateDoc(doc(db, 'expenses', expenseId), {
    date: values.date,
    type: values.type,
    category: deleteField(),
    amount: Number(values.amount),
    note: values.note?.trim() || '',
    updatedAt: serverTimestamp()
  });
}

export async function removeExpense(db, expenseId) {
  await deleteDoc(doc(db, 'expenses', expenseId));
}

export async function setMealOverride(db, profile, memberId, date, count, baselineCount) {
  const value = Number(count);
  if (!Number.isInteger(value) || value < 0 || value > 20) throw new Error('Meal count must be a whole number from 0 to 20.');
  const ref = doc(db, 'mealOverrides', `${memberId}__${date}`);
  if (value === Number(baselineCount)) {
    await deleteDoc(ref).catch(error => {
      if (error.code !== 'not-found') throw error;
    });
    return;
  }
  await setDoc(ref, {
    date,
    monthId: date.slice(0, 7),
    count: value,
    memberId,
    updatedByUid: profile.uid,
    updatedAt: serverTimestamp()
  });
}

export async function setMessOff(db, profile, date, messOff) {
  await setDoc(doc(db, 'mealDays', date), {
    date,
    monthId: date.slice(0, 7),
    messOff: Boolean(messOff),
    updatedByUid: profile.uid,
    updatedByMemberId: profile.memberId,
    updatedAt: serverTimestamp()
  });
}

export async function setMonthStatus(db, monthId, status) {
  await updateDoc(doc(db, 'months', monthId), {
    status,
    closedAt: status === 'closed' ? serverTimestamp() : null
  });
}

export async function updateMemberDetails(db, memberId, { name, currentRent }) {
  const cleanName = String(name || '').trim();
  const rent = Number(currentRent);
  if (!cleanName) throw new Error('Nickname is required.');
  if (!Number.isFinite(rent) || rent < 0) throw new Error('Enter a valid rent amount.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'members', memberId), {
    name: cleanName,
    currentRent: rent,
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, 'claimSlots', memberId), { name: cleanName });
  await batch.commit();
}

export async function addMember(db, { name, currentRent, sortOrder }) {
  const cleanName = String(name || '').trim();
  const rent = Number(currentRent);
  if (!cleanName) throw new Error('Nickname is required.');
  if (!Number.isFinite(rent) || rent < 0) throw new Error('Enter a valid rent amount.');
  const memberRef = doc(collection(db, 'members'));
  const batch = writeBatch(db);
  batch.set(memberRef, {
    name: cleanName,
    currentRent: rent,
    active: true,
    role: 'member',
    sortOrder: Number(sortOrder || 1000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(db, 'claimSlots', memberRef.id), {
    name: cleanName,
    active: true,
    sortOrder: Number(sortOrder || 1000),
    claimedByUid: null,
    claimedByEmail: null,
    claimedAt: null
  });
  await batch.commit();
}

export async function setMemberActive(db, memberId, active) {
  if (memberId === 'kawchar' && !active) throw new Error('The Admin member cannot be removed.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'members', memberId), { active: Boolean(active), updatedAt: serverTimestamp() });
  batch.update(doc(db, 'claimSlots', memberId), { active: Boolean(active) });
  await batch.commit();
}

export async function adminUnclaimMember(db, slot) {
  if (slot.id === 'kawchar') throw new Error('The Admin account cannot be unclaimed.');
  if (!slot.claimedByUid) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', slot.claimedByUid));
  batch.update(doc(db, 'claimSlots', slot.id), {
    claimedByUid: null,
    claimedByEmail: null,
    claimedAt: null
  });
  await batch.commit();
}

export async function loadMonthDataOnce(db, monthId) {
  const names = ['expenses', 'mealAdjustments', 'mealOverrides', 'mealDays'];
  const snaps = await Promise.all(names.map(name => getDocs(query(collection(db, name), where('monthId', '==', monthId)))));
  return {
    expenses: snaps[0].docs.map(item => ({ id: item.id, ...item.data() })),
    adjustments: snaps[1].docs.map(item => ({ id: item.id, ...item.data() })),
    overrides: snaps[2].docs.map(item => ({ id: item.id, ...item.data() })),
    mealDays: snaps[3].docs.map(item => ({ id: item.id, ...item.data() }))
  };
}

export async function ensureCurrentMonthForAdmin(db, profile) {
  if (profile?.role !== 'admin') return;
  await ensureMonthExists(db, currentMonthId());
}

export function newExpenseDefaults(type = 'bazar', monthId = currentMonthId()) {
  return {
    date: monthId === currentMonthId() ? todayISO() : `${monthId}-01`,
    type,
    amount: '',
    note: ''
  };
}
