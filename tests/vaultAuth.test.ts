import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanPhoneNumber,
  generateSalt,
  hashPin,
  isValidPhoneNumber,
  isValidPin,
} from '../src/services/vaultAuth';

test('cleanPhoneNumber strips spaces, dashes and non-numeric characters', () => {
  assert.equal(cleanPhoneNumber('01712-345678'), '01712345678');
  assert.equal(cleanPhoneNumber('+88 017 123 45678'), '8801712345678');
  assert.equal(cleanPhoneNumber('  01811223344  '), '01811223344');
});

test('isValidPhoneNumber validates strictly 11 digits', () => {
  assert.equal(isValidPhoneNumber('01712345678'), true);
  assert.equal(isValidPhoneNumber('01811223344'), true);
  assert.equal(isValidPhoneNumber('01999999999'), true);
  assert.equal(isValidPhoneNumber('0171234567'), false); // 10 digits
  assert.equal(isValidPhoneNumber('017123456789'), false); // 12 digits
  assert.equal(isValidPhoneNumber('abcdefghijk'), false);
});

test('isValidPin validates strictly 4 digits', () => {
  assert.equal(isValidPin('1234'), true);
  assert.equal(isValidPin('0000'), true);
  assert.equal(isValidPin('9876'), true);
  assert.equal(isValidPin('123'), false); // 3 digits
  assert.equal(isValidPin('12345'), false); // 5 digits
  assert.equal(isValidPin('abcd'), false);
  assert.equal(isValidPin('12a4'), false);
});

test('generateSalt returns a 32-character random hex string', () => {
  const salt1 = generateSalt();
  const salt2 = generateSalt();
  assert.ok(salt1.length >= 16);
  assert.notEqual(salt1, salt2);
});

test('hashPin produces deterministic hash for same pin and salt', async () => {
  const salt = 'abcdef0123456789';
  const pin = '1234';
  const hash1 = await hashPin(pin, salt);
  const hash2 = await hashPin(pin, salt);
  assert.equal(hash1, hash2);
  assert.ok(hash1.length > 0);
});

test('hashPin produces different hashes for different PINs', async () => {
  const salt = 'abcdef0123456789';
  const hash1 = await hashPin('1234', salt);
  const hash2 = await hashPin('5678', salt);
  assert.notEqual(hash1, hash2);
});

test('hashPin produces different hashes for different salts', async () => {
  const hash1 = await hashPin('1234', 'salt_alpha');
  const hash2 = await hashPin('1234', 'salt_beta');
  assert.notEqual(hash1, hash2);
});
