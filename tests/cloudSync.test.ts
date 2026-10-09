import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideSignInSync, isAccountSwitch, type SignInSyncInput } from '../src/services/cloudSync';

const base: SignInSyncInput = {
  userUid: 'uid-B',
  previousUserUid: null,
  dataOwnerUid: null,
  localHasData: true,
  cloudHasData: true,
  cloudSnapshotAt: 2000,
  lastSyncedAt: 1000,
};

const decide = (overrides: Partial<SignInSyncInput>) => decideSignInSync({ ...base, ...overrides });

// ── The reported bug: logout of account A, login of account B on the same
// device. The local cache still holds A's records; B's Drive backup must win.

test('account switch (persisted dataOwnerUid) restores the new account cloud backup over the local cache', () => {
  const decision = decide({ dataOwnerUid: 'uid-A', localHasData: true, cloudHasData: true });
  assert.equal(decision.action, 'restore-cloud');
  assert.equal(decision.accountSwitched, true);
});

test('account switch with no cloud backup clears the previous account cache instead of showing it', () => {
  const decision = decide({ dataOwnerUid: 'uid-A', localHasData: true, cloudHasData: false });
  assert.equal(decision.action, 'clear-local');
  assert.equal(decision.accountSwitched, true);
});

test('account switch is detected from the previous session user even without a persisted tag (legacy installs)', () => {
  const withCloud = decide({ previousUserUid: 'uid-A', dataOwnerUid: null, cloudHasData: true });
  assert.equal(withCloud.action, 'restore-cloud');
  assert.equal(withCloud.accountSwitched, true);

  const withoutCloud = decide({ previousUserUid: 'uid-A', dataOwnerUid: null, cloudHasData: false });
  assert.equal(withoutCloud.action, 'clear-local');
  assert.equal(withoutCloud.accountSwitched, true);
});

test('an account switch never keeps the local cache, even when the cloud copy is older', () => {
  const decision = decide({
    dataOwnerUid: 'uid-A',
    localHasData: true,
    cloudHasData: true,
    cloudSnapshotAt: 500, // older than the device's last sync point
    lastSyncedAt: 9000,
  });
  assert.equal(decision.action, 'restore-cloud');
  assert.equal(decision.accountSwitched, true);
});

// ── Same account: offline edits made while signed out must survive sign-in.

test('same account keeps local data when the cloud snapshot is not newer (offline edits are protected)', () => {
  const decision = decide({
    userUid: 'uid-A',
    dataOwnerUid: 'uid-A',
    previousUserUid: 'uid-A',
    localHasData: true,
    cloudHasData: true,
    cloudSnapshotAt: 1000,
    lastSyncedAt: 1000, // this device made the newest backup
  });
  assert.equal(decision.action, 'keep-local');
  assert.equal(decision.accountSwitched, false);
});

test('same account restores when another device backed up newer data (multi-device sync)', () => {
  const decision = decide({
    userUid: 'uid-A',
    dataOwnerUid: 'uid-A',
    previousUserUid: null,
    localHasData: true,
    cloudHasData: true,
    cloudSnapshotAt: 5000,
    lastSyncedAt: 1000,
  });
  assert.equal(decision.action, 'restore-cloud');
  assert.equal(decision.accountSwitched, false);
});

// ── Fresh devices / wiped browsers keep the original auto-restore behavior.

test('empty local cache adopts the cloud backup (new device auto-restore)', () => {
  const decision = decide({ localHasData: false, cloudHasData: true });
  assert.equal(decision.action, 'restore-cloud');
  assert.equal(decision.accountSwitched, false);
});

test('empty local cache without cloud backup stays empty (nothing to restore)', () => {
  const decision = decide({ localHasData: false, cloudHasData: false });
  assert.equal(decision.action, 'keep-local');
  assert.equal(decision.accountSwitched, false);
});

// ── Never-synced local data (app used while signed out, then first sign-in).

test('cloud takes priority over never-synced local data when the account already has backups', () => {
  const decision = decide({
    dataOwnerUid: null,
    previousUserUid: null,
    localHasData: true,
    cloudHasData: true,
    cloudSnapshotAt: 2000,
    lastSyncedAt: 0,
  });
  assert.equal(decision.action, 'restore-cloud');
  assert.equal(decision.accountSwitched, false);
});

test('never-synced local data is kept and claimed when the account has no backups', () => {
  const decision = decide({
    dataOwnerUid: null,
    previousUserUid: null,
    localHasData: true,
    cloudHasData: false,
    lastSyncedAt: 0,
  });
  assert.equal(decision.action, 'keep-local');
  assert.equal(decision.accountSwitched, false);
});

// ── isAccountSwitch signal checks.

test('isAccountSwitch only fires for a genuinely different account', () => {
  assert.equal(isAccountSwitch({ userUid: 'uid-A', previousUserUid: null, dataOwnerUid: null }), false);
  assert.equal(isAccountSwitch({ userUid: 'uid-A', previousUserUid: 'uid-A', dataOwnerUid: 'uid-A' }), false);
  assert.equal(isAccountSwitch({ userUid: 'uid-B', previousUserUid: 'uid-A', dataOwnerUid: 'uid-A' }), true);
  assert.equal(isAccountSwitch({ userUid: 'uid-B', previousUserUid: null, dataOwnerUid: 'uid-A' }), true);
  assert.equal(isAccountSwitch({ userUid: 'uid-B', previousUserUid: 'uid-A', dataOwnerUid: null }), true);
  // A restored session of the same account (page reload) is not a switch.
  assert.equal(isAccountSwitch({ userUid: 'uid-A', previousUserUid: null, dataOwnerUid: 'uid-A' }), false);
});
