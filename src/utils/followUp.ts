/**
 * HISAPP — "FOLLOW-UP" PRESET SUPPORT
 * ─────────────────────────────────────────────────────────────────
 * A follow-up visit is a revisit where the patient pays nothing again
 * (the fee was already collected in the first visit), so both the dental
 * procedure list and the received-amount presets ship with a "Follow-up"
 * entry that always lands on ৳0 — while staying fully editable.
 *
 * The helpers below are pure so they can be reused by the database layer
 * (which back-fills the preset for doctors who saved their lists before
 * this feature existed) and unit-tested without a browser.
 */
import { AmountPreset } from '../types';

/** Name of the built-in follow-up procedure. */
export const FOLLOW_UP_PROCEDURE = 'Follow-up';

/** Id of the built-in follow-up amount preset. */
export const FOLLOW_UP_PRESET_ID = 'follow-up';

/** Label of the built-in follow-up amount preset. */
export const FOLLOW_UP_PRESET_LABEL = 'Follow-up';

/** The built-in follow-up amount preset — always ৳0 (still editable). */
export const FOLLOW_UP_AMOUNT_PRESET: AmountPreset = {
  id: FOLLOW_UP_PRESET_ID,
  label: FOLLOW_UP_PRESET_LABEL,
  amount: 0,
};

/**
 * True when a procedure name is the follow-up preset. The comparison is
 * case-insensitive and ignores surrounding spaces so a renamed-cased copy
 * ("follow-up", " Follow-Up ") still behaves like the preset.
 */
export function isFollowUpProcedure(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.trim().toLowerCase() === FOLLOW_UP_PROCEDURE.toLowerCase();
}

/**
 * True when an amount preset is the follow-up preset — matched by id first,
 * then by label, so presets recreated from a JSON backup are recognised too.
 */
export function isFollowUpAmountPreset(preset: AmountPreset | null | undefined): boolean {
  if (!preset) return false;
  if (preset.id === FOLLOW_UP_PRESET_ID) return true;
  return (preset.label || '').trim().toLowerCase() === FOLLOW_UP_PRESET_LABEL.toLowerCase();
}

/**
 * Returns the procedure list with the follow-up preset appended when it is
 * missing. Idempotent: a list that already contains "Follow-up" (in any
 * casing) is returned untouched, so a doctor's own ordering is preserved.
 */
export function withFollowUpProcedure(procedures: string[] | null | undefined): string[] {
  const list = Array.isArray(procedures) ? procedures.filter((p) => typeof p === 'string') : [];
  if (list.some((p) => isFollowUpProcedure(p))) return list;
  return [...list, FOLLOW_UP_PROCEDURE];
}

/**
 * Returns the amount preset list with the follow-up preset inserted right
 * after the last zero-amount preset (next to "No Payment" / "Free Campaign")
 * when it is missing. Idempotent.
 */
export function withFollowUpAmountPreset(presets: AmountPreset[] | null | undefined): AmountPreset[] {
  const list = Array.isArray(presets) ? presets.filter((p) => p && typeof p.label === 'string') : [];
  if (list.some((preset) => isFollowUpAmountPreset(preset))) return list;

  const lastZeroIndex = list.reduce(
    (acc, preset, index) => (preset.amount === 0 ? index : acc),
    -1
  );

  const next = [...list];
  next.splice(lastZeroIndex + 1, 0, { ...FOLLOW_UP_AMOUNT_PRESET });
  return next;
}
