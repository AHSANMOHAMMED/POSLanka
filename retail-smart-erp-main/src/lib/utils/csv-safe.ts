/**
 * CSV formula-injection guard. A cell that starts with =, @, tab or CR — or with + / - that is not
 * a plain number or phone number — would run as a formula when the CSV is opened in Excel, so it
 * gets a leading apostrophe. Numbers like "-150.00" and phones like "+94 77 123 4567" are untouched.
 */
export const CSV_FORMULA_RE = /^(?:[=@\t\r]|[+-](?![\d\s.()-]*$))/

export function neutralizeCsvFormula(value: string): string {
  return CSV_FORMULA_RE.test(value) ? `'${value}` : value
}
