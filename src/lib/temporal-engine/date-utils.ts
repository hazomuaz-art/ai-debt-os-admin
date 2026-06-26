// Date arithmetic — always relative to the MESSAGE timestamp (§7 of the
// architecture), always expressed in the company's timezone (§2), never UTC
// "now" and never the time the code happens to run.

export interface ReferenceNow {
  utc: Date
  timezone: string
}

// Returns the calendar date (YYYY-MM-DD) of `utc` AS OBSERVED in `timezone`.
// Uses Intl, which has full IANA tz support without extra dependencies.
export function dateOnlyInTimezone(utc: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(utc)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export function addMonthsToDateString(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCMonth(dt.getUTCMonth() + months)
  return dt.toISOString().slice(0, 10)
}

// ISO weekday: 1=Monday ... 7=Sunday.
export function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const js = dt.getUTCDay() // 0=Sunday..6=Saturday
  return js === 0 ? 7 : js
}

const WEEKDAY_NAME_TO_ISO: Record<string, number> = {
  'الاثنين': 1, 'الثلاثاء': 2, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6, 'الاحد': 7,
}

// Next occurrence of a named weekday strictly AFTER `fromDateStr` (today
// itself doesn't count — "الجمعة" said on a Friday means next Friday).
export function nextWeekdayOnOrAfter(fromDateStr: string, weekdayNameNormalized: string): string | null {
  const targetIso = WEEKDAY_NAME_TO_ISO[weekdayNameNormalized]
  if (!targetIso) return null
  let d = fromDateStr
  for (let i = 1; i <= 7; i++) {
    d = addDaysToDateString(fromDateStr, i)
    if (isoWeekday(d) === targetIso) return d
  }
  return null
}

export function firstOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-01`
}

export function lastOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m, 0)) // day 0 of next month = last day of this month
  return dt.toISOString().slice(0, 10)
}

export function middleOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-15`
}

export function firstOfNextMonth(dateStr: string): string {
  return firstOfMonth(addMonthsToDateString(firstOfMonth(dateStr), 1))
}

export function startOfWeek(dateStr: string): string {
  // Saudi business week: Sunday is day 1 of the week conceptually for
  // "بداية الأسبوع" — ISO weekday 7 (Sunday). Back up to the most recent Sunday.
  const iso = isoWeekday(dateStr)
  const diff = iso === 7 ? 0 : iso
  return addDaysToDateString(dateStr, -diff)
}

export function endOfWeek(dateStr: string): string {
  return addDaysToDateString(startOfWeek(dateStr), 6)
}

// Is `dateStr` a weekend day per the given ISO weekday list (e.g. [5,6] = Fri/Sat)?
export function isWeekendDay(dateStr: string, weekendDays: number[]): boolean {
  return weekendDays.includes(isoWeekday(dateStr))
}

export function isSaneFutureDate(dateStr: string, todayStr: string, maxDaysAhead = 730): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const today = new Date(`${todayStr}T00:00:00Z`).getTime()
  const target = new Date(`${dateStr}T00:00:00Z`).getTime()
  if (Number.isNaN(today) || Number.isNaN(target)) return false
  const diffDays = (target - today) / 86_400_000
  return diffDays >= -1 && diffDays <= maxDaysAhead // -1 tolerates "today"
}

// ── Hijri ↔ Gregorian conversion ──────────────────────────────────────
// Tabular (Kuwaiti algorithm) civil Hijri calendar — a well-known
// deterministic approximation, NOT the Umm al-Qura observational calendar
// (which can differ by ±1 day around month boundaries depending on moon
// sighting). This is a KNOWN, DOCUMENTED LIMITATION — flagged explicitly
// here and in the architecture risk section — acceptable for "العميل قال
// ١٥ محرم" precision, but must never be presented as authoritative for
// exact Umm al-Qura dates without a dedicated lookup table per year.
export function hijriToGregorian(hYear: number, hMonth: number, hDay: number): string {
  const jd = Math.floor((11 * hYear + 3) / 30) + 354 * hYear + 30 * hMonth
    - Math.floor((hMonth - 1) / 2) + hDay + 1948440 - 385
  return julianDayToGregorian(jd)
}

function julianDayToGregorian(jd: number): string {
  const a = jd + 32044
  const b = Math.floor((4 * a + 3) / 146097)
  const c = a - Math.floor((146097 * b) / 4)
  const d = Math.floor((4 * c + 3) / 1461)
  const e = c - Math.floor((1461 * d) / 4)
  const m = Math.floor((5 * e + 2) / 153)
  const day = e - Math.floor((153 * m + 2) / 5) + 1
  const month = m + 3 - 12 * Math.floor(m / 10)
  const year = 100 * b + d - 4800 + Math.floor(m / 10)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const HIJRI_MONTH_NAMES: Record<string, number> = {
  'محرم': 1, 'صفر': 2, 'ربيع الاول': 3, 'ربيع الأول': 3, 'ربيع الثاني': 4, 'ربيع الآخر': 4,
  'جمادى الاولى': 5, 'جمادى الأولى': 5, 'جمادى الآخرة': 6, 'جمادى الثانية': 6,
  'رجب': 7, 'شعبان': 8, 'رمضان': 9, 'شوال': 10, 'ذو القعدة': 11, 'ذو الحجة': 12,
}
export function hijriMonthNumber(nameNormalized: string): number | null {
  return HIJRI_MONTH_NAMES[nameNormalized] ?? null
}

// Rough inverse: current Hijri year for a given Gregorian date — used to
// resolve "١٥ محرم" (no year stated) to the nearest upcoming occurrence.
export function gregorianToHijriYear(gDateStr: string): number {
  const [y, m, d] = gDateStr.split('-').map(Number)
  const jd = gregorianToJulianDay(y, m, d)
  return Math.floor((30 * (jd - 1948440) + 10646) / 10631)
}
function gregorianToJulianDay(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045
}
