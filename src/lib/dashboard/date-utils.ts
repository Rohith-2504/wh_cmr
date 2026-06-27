// Centralised date helpers for the dashboard so every chart / card
// agrees on what "today", "day boundary", and "day of week" mean.
// All boundaries and displayed timestamps use Asia/Kolkata (IST).

/** Application timezone — Indian Standard Time. */
export const APP_TIMEZONE = 'Asia/Kolkata' as const

/** Display locale; paired with APP_TIMEZONE for consistent formatting. */
export const APP_LOCALE = 'en-IN'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

type AppDayParts = { year: number; month: number; day: number }

function toDate(input: string | Date): Date {
  return typeof input === 'string' ? new Date(input) : input
}

function getAppDayParts(d: Date): AppDayParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(d)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

/** UTC instant for midnight at the start of a calendar day in IST. */
function midnightIstUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS)
}

export function startOfLocalDay(d: Date = new Date()): Date {
  const { year, month, day } = getAppDayParts(d)
  return midnightIstUtc(year, month, day)
}

export function daysAgoStart(days: number): Date {
  const { year, month, day } = getAppDayParts(new Date())
  const anchor = new Date(year, month - 1, day)
  anchor.setDate(anchor.getDate() - days)
  return midnightIstUtc(anchor.getFullYear(), anchor.getMonth() + 1, anchor.getDate())
}

/** Date-only key (YYYY-MM-DD) for bucketing rows by IST calendar day. */
export function localDayKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const { year, month, day } = getAppDayParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Inclusive list of IST-day keys spanning the last `n` days, in
 * chronological order. Useful for seeding chart buckets so days with
 * zero activity still render a 0-point in the line.
 */
export function lastNDayKeys(n: number): string[] {
  const keys: string[] = []
  const start = daysAgoStart(n - 1)
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + i * 86_400_000)
    keys.push(localDayKey(d))
  }
  return keys
}

/**
 * ISO day-of-week where 0 = Monday … 6 = Sunday, evaluated in IST.
 * JavaScript's native getDay() uses 0 = Sunday which is awkward for
 * most business charts.
 */
export function mondayIndex(d: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
  }).format(d)
  const MAP: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  }
  return MAP[weekday] ?? 0
}

export const DOW_SHORT_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const dateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const timeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const timeWithSecondsFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** IST date + 24-hour time for list/detail rows (e.g. "18 May 2026, 14:30"). */
export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso))
}

/** 24-hour time in IST (e.g. "14:30"). */
export function formatTime(input: string | Date): string {
  return timeFormatter.format(toDate(input))
}

/** 24-hour time with seconds in IST (e.g. "14:30:05"). */
export function formatTimeWithSeconds(input: string | Date): string {
  return timeWithSecondsFormatter.format(toDate(input))
}

/** Short date in IST (e.g. "18 May 2026"). */
export function formatDateMedium(input: string | Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(toDate(input))
}

/** Long date in IST (e.g. "18 May 2026" with full month name). */
export function formatDateLong(input: string | Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(toDate(input))
}

/** Note-style date + time in IST (e.g. "18 May 2026 14:30"). */
export function formatDateNote(input: string | Date): string {
  const d = toDate(input)
  const datePart = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
  return `${datePart} ${formatTime(d)}`
}

/** Compact date in IST (e.g. "18/5/26"). */
export function formatDateShort(input: string | Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
  }).format(toDate(input))
}

/** Weekday name in IST (e.g. "Monday"). */
export function formatWeekday(input: string | Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    weekday: 'long',
  }).format(toDate(input))
}

export function isTodayInAppTz(d: Date): boolean {
  return localDayKey(d) === localDayKey(new Date())
}

export function isYesterdayInAppTz(d: Date): boolean {
  const { year, month, day } = getAppDayParts(new Date())
  const yesterday = new Date(year, month - 1, day)
  yesterday.setDate(yesterday.getDate() - 1)
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
  return localDayKey(d) === yKey
}

function dayKeyToMs(key: string): number {
  const [y, m, day] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, day)
}

export function differenceInCalendarDaysAppTz(later: Date, earlier: Date): number {
  return Math.round(
    (dayKeyToMs(localDayKey(later)) - dayKeyToMs(localDayKey(earlier))) / 86_400_000,
  )
}

/** Message-thread / inbox date separator label. */
export function formatDateSeparatorLabel(dateStr: string): string {
  const date = new Date(dateStr)
  if (isTodayInAppTz(date)) return 'Today'
  if (isYesterdayInAppTz(date)) return 'Yesterday'
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

/** WhatsApp-style relative timestamp for conversation rows (IST-aware). */
export function formatConversationTime(dateStr: string | undefined): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isTodayInAppTz(date)) return formatTime(date)
  if (isYesterdayInAppTz(date)) return 'Yesterday'
  if (differenceInCalendarDaysAppTz(new Date(), date) < 7) {
    return formatWeekday(date)
  }
  return formatDateShort(date)
}

/** Whether an instant falls within the last N IST calendar days (inclusive of today). */
export function isWithinLastAppDays(instant: Date, days: number): boolean {
  return instant >= daysAgoStart(days - 1)
}

/** Chart axis label from an IST day key (YYYY-MM-DD). */
export function formatChartDayShort(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    month: 'short',
    day: 'numeric',
  }).format(midnightIstUtc(y, m, d))
}

/** Chart tooltip label from an IST day key (YYYY-MM-DD). */
export function formatChartDayLong(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(midnightIstUtc(y, m, d))
}
