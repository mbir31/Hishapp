import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeDateKey,
  displayDateKey,
  formatDateKey,
  nextDateKey,
  parseDateKey,
  previousDateKey,
  shiftDateKey,
  todayDateKey,
  weekdayNameDateKey,
} from '../src/utils/dateUtils';

test('the arrow buttons step one day back and forward', () => {
  assert.equal(previousDateKey('2026-10-10'), '2026-10-09');
  assert.equal(nextDateKey('2026-10-10'), '2026-10-11');
  assert.equal(previousDateKey('2026-10-01'), '2026-09-30');
  assert.equal(nextDateKey('2026-10-31'), '2026-11-01');
});

test('stepping crosses year boundaries and leap days', () => {
  assert.equal(previousDateKey('2026-01-01'), '2025-12-31');
  assert.equal(nextDateKey('2025-12-31'), '2026-01-01');
  assert.equal(previousDateKey('2024-03-01'), '2024-02-29');
  assert.equal(previousDateKey('2026-03-01'), '2026-02-28');
  assert.equal(nextDateKey('2024-02-28'), '2024-02-29');
});

test('formatting stays in local time, so Bangladesh never loses a day', () => {
  // 2026-10-10 00:30 in Dhaka is still 2026-10-09 in UTC — the old
  // `toISOString()` based picker would have written the wrong date.
  const earlyMorning = new Date(2026, 9, 10, 0, 30);
  assert.equal(formatDateKey(earlyMorning), '2026-10-10');
  assert.equal(todayDateKey(earlyMorning), '2026-10-10');

  const lateNight = new Date(2026, 9, 10, 23, 45);
  assert.equal(formatDateKey(lateNight), '2026-10-10');
});

test('an unparsable date is rejected instead of silently shifted', () => {
  assert.equal(previousDateKey(''), null);
  assert.equal(nextDateKey('not-a-date'), null);
  assert.equal(shiftDateKey('2026-02-31', 1), null);
  assert.equal(shiftDateKey(undefined, 1), null);
  assert.equal(parseDateKey('2026-10-10')?.getFullYear(), 2026);
  assert.equal(parseDateKey('2026-13-10'), null);
});

test('multi-day jumps and the readable label', () => {
  assert.equal(shiftDateKey('2026-10-10', -14), '2026-09-26');
  assert.equal(shiftDateKey('2026-10-10', 7), '2026-10-17');
  assert.equal(describeDateKey('2026-10-10'), 'Sat, 10 Oct 2026');
  assert.equal(describeDateKey('nonsense'), '');
});

test('date selector display uses DD-MM-YYYY and full English weekday names', () => {
  assert.equal(displayDateKey('2026-10-15'), '15-10-2026');
  assert.equal(weekdayNameDateKey('2026-10-15'), 'Thursday');
  assert.equal(displayDateKey('2026-02-31'), '');
  assert.equal(weekdayNameDateKey('not-a-date'), '');
});
