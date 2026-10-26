/** Redaction runs on raw text BEFORE parsing. Removes unit IDs, officer/personal names, plates, badge numbers, phones, DOBs. */
const TITLES = String.raw`(?:officer|ofc|sgt|sergeant|deputy|lt|lieutenant|detective|det|cpl|corporal|trooper|chief|captain|capt)`;
/** Case-insensitive on the first letter only, so the following name must really be capitalized. */
const ci = (alts: string) => `(?:${alts.slice(3, -1).split('|').map(w => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join('|')})`;
const SUBJ = String.raw`(?:subject|suspect|male|female|driver|passenger|victim|complainant|caller|rp|juvenile|party|person)`;
export function redact(text: string): string {
  return text
    // plates: "plate ABC 1234", "Illinois registration 123 4567", "tag Q12345"
    .replace(/\b(?:[Pp]lates?|[Rr]egistration|[Rr]eg|[Tt]ags?|[Ll]icense(?: plate)?)(?:\s+(?:number|no\.?|#|is|of|on|reads?))*\s*(?:(?:[Ii]llinois|IL|[Ii]ndiana|IN)\s+)?[A-Z0-9]{1,4}(?:[\s-][A-Z0-9]{1,4}){0,2}\b/g, '[plate]')
    .replace(/\b(?:[Ii]llinois|IL|[Ii]ndiana|IN)\s+(?:[A-Z]{1,3}\s?\d{2,5}|\d{2,3}\s?\d{3,4})\b/g, '[plate]')
    .replace(/\bbadge\s*(?:number|no\.?|#)?\s*\d+/gi, '[unit]')
    .replace(new RegExp(String.raw`\b(?:unit|car|medic|engine|truck|squad|${TITLES})\.?\s+(?:#\s*)?[a-z]*\d[\w-]*`, 'gi'), '[unit]')
    .replace(new RegExp(String.raw`\b${ci(TITLES)}\.?\s+[A-Z][a-z']+(?:\s+[A-Z][a-z']+)?`, 'g'), '[person]')
    // "subject John Smith", "male named Jacob Ortiz", "RP is Maria Lopez", "name of Tom"
    .replace(new RegExp(String.raw`\b(${ci(SUBJ)})(?:\s+(?:is|named|name|identified as|by the name of|of))+\s+[A-Z][a-z']+(?:\s+[A-Z][a-z']+){0,2}`, 'g'), '$1 [person]')
    .replace(/\b(?:named|name is|last name|first name|identified as)\s+[A-Z][a-z']+(?:\s+[A-Z][a-z']+){0,2}/g, '[person]')
    .replace(/\b(?:\d{3}[-.\s]?){2}\d{4}\b/g, '[phone]')
    .replace(/\b(?:dob|date of birth)\s*[:\s]?\s*[\d/-]+/gi, '[dob]')
    .replace(/\b\d{1,3}[a-z]{1,2}\d{1,3}\b/gi, '[unit]')  // 2A12, 1L23
    .replace(/\b(?:adam|baker|charlie|david|edward|frank|lincoln|mary|ocean|paul|sam|tom|union|victor|william|king|john|henry|ida|nora)[- ]?\d{1,3}\b/gi, '[unit]');
}
