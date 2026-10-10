import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_AMOUNT_PRESETS, DEFAULT_PROCEDURES } from '../src/db/indexedDB';
import {
  FOLLOW_UP_AMOUNT_PRESET,
  FOLLOW_UP_PROCEDURE,
  isFollowUpAmountPreset,
  isFollowUpProcedure,
  withFollowUpAmountPreset,
  withFollowUpProcedure,
} from '../src/utils/followUp';

test('the built-in lists ship with the Follow-up preset', () => {
  assert.equal(FOLLOW_UP_PROCEDURE, 'Follow-up');
  assert.equal(DEFAULT_PROCEDURES.at(-1), 'Follow-up');
  assert.equal(DEFAULT_PROCEDURES.filter((p) => isFollowUpProcedure(p)).length, 1);

  const preset = DEFAULT_AMOUNT_PRESETS.find((p) => isFollowUpAmountPreset(p));
  assert.deepEqual(preset, FOLLOW_UP_AMOUNT_PRESET);
  assert.equal(preset?.amount, 0);
  // It sits with the other zero-fee presets, ahead of the numeric amounts.
  assert.deepEqual(
    DEFAULT_AMOUNT_PRESETS.map((p) => p.label).slice(0, 3),
    ['No Payment', 'Free Campaign', 'Follow-up']
  );
});

test('procedure matching ignores casing and stray spaces', () => {
  assert.equal(isFollowUpProcedure('Follow-up'), true);
  assert.equal(isFollowUpProcedure(' follow-up '), true);
  assert.equal(isFollowUpProcedure('FOLLOW-UP'), true);
  assert.equal(isFollowUpProcedure('Visit'), false);
  assert.equal(isFollowUpProcedure('Follow-up Review'), false);
  assert.equal(isFollowUpProcedure(undefined), false);
});

test('amount preset matching works from the id or a restored label', () => {
  assert.equal(isFollowUpAmountPreset({ id: 'follow-up', label: 'Follow-up', amount: 0 }), true);
  assert.equal(isFollowUpAmountPreset({ id: 'x1', label: 'Follow-Up', amount: 0 }), true);
  assert.equal(isFollowUpAmountPreset({ id: 'x2', label: 'No Payment', amount: 0 }), false);
  assert.equal(isFollowUpAmountPreset(null), false);
});

test('back-filling a customized procedure list is idempotent', () => {
  assert.deepEqual(withFollowUpProcedure(['RCT', 'Crown']), ['RCT', 'Crown', 'Follow-up']);
  assert.deepEqual(withFollowUpProcedure([]), ['Follow-up']);
  assert.deepEqual(withFollowUpProcedure(undefined), ['Follow-up']);

  const alreadyThere = ['Follow-up', 'RCT'];
  assert.deepEqual(withFollowUpProcedure(alreadyThere), ['Follow-up', 'RCT']); // order kept
  assert.deepEqual(withFollowUpProcedure(['RCT', 'follow-up']), ['RCT', 'follow-up']);
});

test('back-filling amount presets inserts next to the other zero-fee presets', () => {
  assert.deepEqual(withFollowUpAmountPreset([]), [FOLLOW_UP_AMOUNT_PRESET]);
  assert.deepEqual(
    withFollowUpAmountPreset([
      { id: 'no-pay', label: 'No Payment', amount: 0 },
      { id: 'amt-500', label: '500', amount: 500 },
    ]),
    [
      { id: 'no-pay', label: 'No Payment', amount: 0 },
      FOLLOW_UP_AMOUNT_PRESET,
      { id: 'amt-500', label: '500', amount: 500 },
    ]
  );

  const alreadyThere = [FOLLOW_UP_AMOUNT_PRESET];
  assert.deepEqual(withFollowUpAmountPreset(alreadyThere), [FOLLOW_UP_AMOUNT_PRESET]);
});
