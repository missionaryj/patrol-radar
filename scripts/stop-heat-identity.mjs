// Identity rules for Chicago and Urbana. These functions see only allowlisted
// columns. They do not read officer, driver, address, or demographic fields.
import { createHash } from 'node:crypto';
import { classifyReason, reasonIndex } from './stop-heat-lib.mjs';

const CHICAGO_KEY_FIELDS = ['date', 'time', 'lat', 'lng', 'type', 'violation', 'outcome', 'citation_issued', 'arrest_made', 'beat'];

/** Rows identical on every public stop attribute the map can see.
 *  Stanford built this file by joining arrests and citations and warns that
 *  residual duplicates can remain: many clocks are hourly, and officer ids are
 *  incomplete. Different time, coordinate, violation, or beat stays separate,
 *  because a shared hour and geocoded intersection can be two vehicles. */
export function chicagoEncounterKey(row) {
    return createHash('sha256').update(CHICAGO_KEY_FIELDS.map(k => String(row?.[k] ?? '').trim()).join('\u001f')).digest('hex');
}

/** Official stop-level geocodes look like 547-08. Beat labels in the same
 *  column look like "61 -" through "65 -". 999-99 is the unknown code.
 *  None of these are coordinates, and none are Champaign beats. */
export function urbanaLocationCode(value) {
    const code = String(value ?? '').trim();
    if (/^\d{3}-\d{2}$/.test(code))
        return code === '999-99' || code === '000-00' ? null : code;
    if (/^6[1-5] -$/.test(code))
        return code;
    return null;
}

/** Prefer the moving-violation type. Plate/registration is not a driver-license stop. */
export function urbanaReason(reason, violation) {
    const kind = String(violation ?? '').trim();
    if (kind && !/^(not a moving violation|other)$/i.test(kind)) {
        const specific = classifyReason(kind);
        if (specific != null && specific !== reasonIndex('other')) return specific;
    }
    const text = String(reason ?? '');
    if (/plate|reg/i.test(text)) return reasonIndex('registration');
    return classifyReason(text);
}
