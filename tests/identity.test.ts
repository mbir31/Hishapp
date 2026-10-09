import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signOutIdentityPatch } from '../src/services/identity';

const account = { uid: 'firebase-uid-123', name: 'Ayesha Rahman' };

test('sign-out clears the Gmail name that sign-in copied into Settings', () => {
  assert.deepEqual(
    signOutIdentityPatch({ doctorName: 'Ayesha Rahman', ownerUid: account.uid }, account),
    { doctorName: '', doctorEmail: '', doctorPhoto: '', ownerUid: null }
  );
});

test('sign-out keeps a doctor name the doctor typed after signing in', () => {
  assert.deepEqual(
    signOutIdentityPatch({ doctorName: 'Dr. Ayesha Rahman (BDS)', ownerUid: account.uid }, account),
    { doctorName: 'Dr. Ayesha Rahman (BDS)', doctorEmail: '', doctorPhoto: '', ownerUid: null }
  );
});

test('surrounding spaces do not make the copied Gmail name look typed', () => {
  assert.equal(
    signOutIdentityPatch({ doctorName: '  Ayesha Rahman  ', ownerUid: account.uid }, account)
      ?.doctorName,
    ''
  );
});

test('sign-out does not touch an identity that belongs to another account', () => {
  assert.equal(
    signOutIdentityPatch({ doctorName: 'Dr. Other Doctor', ownerUid: 'someone-else' }, account),
    null
  );
});

test('sign-out leaves a name typed by hand alone when no account is linked', () => {
  assert.equal(signOutIdentityPatch({ doctorName: 'Dr. Self Typed', ownerUid: null }, account), null);
});

test('sign-out with no signed-in account changes nothing', () => {
  assert.equal(
    signOutIdentityPatch({ doctorName: 'Ayesha Rahman', ownerUid: account.uid }, null),
    null
  );
});
