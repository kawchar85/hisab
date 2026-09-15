import { TIME_ZONE } from './constants.js';

export function dhakaDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

export function todayISO() {
  const { year, month, day } = dhakaDateParts();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function monthIdFromISO(isoDate) {
  return isoDate.slice(0, 7);
}

export function currentMonthId() {
  return monthIdFromISO(todayISO());
}

export function monthStartISO(monthId) {
  return `${monthId}-01`;
}

export function lastDateOfMonth(monthId) {
  const [year, month] = monthId.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return `${year}-${String(month).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`;
}

export function daysInMonth(monthId) {
  return Number(lastDateOfMonth(monthId).slice(8, 10));
}

export function weekdayOfISO(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

export function addDaysISO(isoDate, delta) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + delta, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

export function datesBetween(startISO, endISO) {
  if (!startISO || !endISO || startISO > endISO) return [];
  const out = [];
  let cur = startISO;
  while (cur <= endISO) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

export function prettyDate(isoDate, options = {}) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: options.withYear === false ? undefined : 'numeric',
    weekday: options.withWeekday ? 'short' : undefined,
    timeZone: 'UTC'
  }).format(d);
}

export function monthLabel(monthId) {
  const [year, month] = monthId.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(d);
}

export function clampISOToMonth(isoDate, monthId) {
  const start = monthStartISO(monthId);
  const end = lastDateOfMonth(monthId);
  if (isoDate < start) return start;
  if (isoDate > end) return end;
  return isoDate;
}

export function settlementCutoff(month) {
  const now = todayISO();
  const end = lastDateOfMonth(month.id);
  const current = currentMonthId();

  if (month.status === 'closed' || month.id < current) return end;
  if (month.id > current) return null;
  return now < end ? now : end;
}
