import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanForFirestore } from '../src/services/firestoreSync';
import {
  isBiometricEnrolledFor,
  removeBiometricEnrollment,
} from '../src/services/biometricAuth';

test('cleanForFirestore strips undefined fields so Firestore batch writes never fail', () => {
  const dirty = {
    id: 'entry-123',
    patientName: 'Rahim Uddin',
    settlementId: undefined,
    remarks: 'Treated tooth',
    meta: {
      nestedUndefined: undefined,
      validNumber: 42,
    },
    items: [{ key: 'a', val: undefined }, { key: 'b', val: 100 }],
  };

  const cleaned = cleanForFirestore(dirty) as any;

  assert.equal(cleaned.id, 'entry-123');
  assert.equal(cleaned.patientName, 'Rahim Uddin');
  assert.equal(cleaned.remarks, 'Treated tooth');
  assert.equal('settlementId' in cleaned, false, 'undefined settlementId must be removed');
  assert.equal('nestedUndefined' in cleaned.meta, false, 'nested undefined must be removed');
  assert.equal(cleaned.meta.validNumber, 42);
  assert.equal(cleaned.items[0].key, 'a');
  assert.equal('val' in cleaned.items[0], false);
  assert.equal(cleaned.items[1].val, 100);
});

test('biometric enrollment status can be checked and cleared from local storage', () => {
  // In mock environment
  const testPhone = '01711223344';
  assert.equal(isBiometricEnrolledFor(testPhone), false);

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`hisapp_bio_vault_${testPhone}`, JSON.stringify({ phone: testPhone }));
    assert.equal(isBiometricEnrolledFor(testPhone), true);

    removeBiometricEnrollment(testPhone);
    assert.equal(isBiometricEnrolledFor(testPhone), false);
  }
});
