/**
 * Sri Lanka public holidays for 2026 and 2027 — used by "Import Sri Lanka holidays" on the
 * Holidays page.
 *
 * Checked on 2026-10-27 against the Government Printing Department 2026 calendar (as listed
 * by Ada Derana, 28 Dec 2025) and the Central Bank of Sri Lanka 2027 holiday table. The 2026
 * day-after-Vesak holiday was later moved by gazette amendment (2 May → 31 May, then reported
 * as not observed), so that one date may need editing. Users can still edit any imported date.
 */
export interface StaticHoliday {
  date: string
  name: string
  poya?: boolean
}

export const SRI_LANKA_HOLIDAYS_VERIFIED = true

export const SRI_LANKA_HOLIDAYS: Record<number, StaticHoliday[]> = {
  2026: [
    { date: '2026-01-03', name: 'Duruthu Full Moon Poya Day', poya: true },
    { date: '2026-01-15', name: 'Tamil Thai Pongal Day' },
    { date: '2026-02-01', name: 'Navam Full Moon Poya Day', poya: true },
    { date: '2026-02-04', name: 'National Day' },
    { date: '2026-02-15', name: 'Mahasivarathri Day' },
    { date: '2026-03-02', name: 'Medin Full Moon Poya Day', poya: true },
    { date: '2026-03-21', name: 'Id-Ul-Fitr (Ramazan Festival Day)' },
    { date: '2026-04-01', name: 'Bak Full Moon Poya Day', poya: true },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-04-13', name: 'Day prior to Sinhala & Tamil New Year Day' },
    { date: '2026-04-14', name: 'Sinhala & Tamil New Year Day' },
    { date: '2026-05-01', name: 'May Day / Vesak Full Moon Poya Day', poya: true },
    { date: '2026-05-02', name: 'Day following Vesak Full Moon Poya Day' },
    { date: '2026-05-28', name: 'Id-Ul-Alha (Hajji Festival Day)' },
    { date: '2026-05-30', name: 'Adhi Poson Full Moon Poya Day', poya: true },
    { date: '2026-06-29', name: 'Poson Full Moon Poya Day', poya: true },
    { date: '2026-07-29', name: 'Esala Full Moon Poya Day', poya: true },
    { date: '2026-08-26', name: 'Milad-Un-Nabi (Holy Prophet\'s Birthday)' },
    { date: '2026-08-27', name: 'Nikini Full Moon Poya Day', poya: true },
    { date: '2026-09-26', name: 'Binara Full Moon Poya Day', poya: true },
    { date: '2026-10-25', name: 'Vap Full Moon Poya Day', poya: true },
    { date: '2026-11-08', name: 'Deepavali Festival Day' },
    { date: '2026-11-24', name: 'Il Full Moon Poya Day', poya: true },
    { date: '2026-12-23', name: 'Unduvap Full Moon Poya Day', poya: true },
    { date: '2026-12-25', name: 'Christmas Day' },
  ],
  2027: [
    { date: '2027-01-15', name: 'Tamil Thai Pongal Day' },
    { date: '2027-01-22', name: 'Duruthu Full Moon Poya Day', poya: true },
    { date: '2027-02-04', name: 'National Day' },
    { date: '2027-02-20', name: 'Navam Full Moon Poya Day', poya: true },
    { date: '2027-03-06', name: 'Mahasivarathri Day' },
    { date: '2027-03-10', name: 'Id-Ul-Fitr (Ramazan Festival Day)' },
    { date: '2027-03-22', name: 'Medin Full Moon Poya Day', poya: true },
    { date: '2027-03-26', name: 'Good Friday' },
    { date: '2027-04-13', name: 'Day prior to Sinhala & Tamil New Year Day' },
    { date: '2027-04-14', name: 'Sinhala & Tamil New Year Day' },
    { date: '2027-04-20', name: 'Bak Full Moon Poya Day', poya: true },
    { date: '2027-05-01', name: 'May Day' },
    { date: '2027-05-17', name: 'Id-Ul-Alha (Hajji Festival Day)' },
    { date: '2027-05-19', name: 'Vesak Full Moon Poya Day', poya: true },
    { date: '2027-05-20', name: 'Day following Vesak Full Moon Poya Day' },
    { date: '2027-06-18', name: 'Poson Full Moon Poya Day', poya: true },
    { date: '2027-07-18', name: 'Esala Full Moon Poya Day', poya: true },
    { date: '2027-08-15', name: 'Milad-Un-Nabi (Holy Prophet\'s Birthday)' },
    { date: '2027-08-16', name: 'Nikini Full Moon Poya Day', poya: true },
    { date: '2027-09-15', name: 'Binara Full Moon Poya Day', poya: true },
    { date: '2027-10-15', name: 'Vap Full Moon Poya Day', poya: true },
    { date: '2027-10-28', name: 'Deepavali Festival Day' },
    { date: '2027-11-13', name: 'Il Full Moon Poya Day', poya: true },
    { date: '2027-12-13', name: 'Unduvap Full Moon Poya Day', poya: true },
    { date: '2027-12-25', name: 'Christmas Day' },
  ],
}
