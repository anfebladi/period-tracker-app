import { DateTime } from 'luxon';

function compute(startInput, cycleLength) {
  const toDateTime = (val) => {
    if (!val) return null;
    if (val instanceof Date) return DateTime.fromJSDate(val);
    if (typeof val === 'string') return DateTime.fromISO(val);
    return DateTime.fromJSDate(val);
  };

  const today = DateTime.fromISO('2026-02-15').startOf('day');
  const startDt = toDateTime(startInput).startOf('day');
  const diff = today.diff(startDt, 'days').days;
  const daysPast = Math.floor(diff);
  const currentDay = ((daysPast % cycleLength) + cycleLength) % cycleLength + 1;
  return { startInput, startDt: startDt.toISO(), daysPast, currentDay };
}

const tests = [
  { start: '2026-01-01', cycle: 45 },
  { start: '2026-01-01T00:00:00.000Z', cycle: 45 },
  { start: new Date('2026-01-01'), cycle: 45 },
  { start: '2026-01-01', cycle: 28 },
];

for (const t of tests) {
  const res = compute(t.start, t.cycle);
  console.log(JSON.stringify(res));
}
