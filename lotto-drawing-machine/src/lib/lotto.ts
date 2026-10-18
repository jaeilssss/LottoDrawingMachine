export const MAX_SAVED = 50
export type Source = 'single' | 'five'
export type SavedGame = { id: string; numbers: number[]; createdAt: string; source: Source }
export type DailyDraw = { date: string; count: number }
export type Preferences = { drum: boolean; short: boolean; haptic: boolean }
export const DEFAULT_PREFERENCES: Preferences = { drum: true, short: true, haptic: true }

export function pickNumbers(random = (array: Uint32Array<ArrayBuffer>) => crypto.getRandomValues(array)): number[] {
  const picked = new Set<number>()
  const value = new Uint32Array<ArrayBuffer>(new ArrayBuffer(4))
  while (picked.size < 6) { random(value); picked.add(value[0] % 45 + 1) }
  return [...picked].sort((a, b) => a - b)
}

export function fiveGames(): number[][] { return Array.from({ length: 5 }, () => pickNumbers()) }

function kstParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), weekday: parts.find((part) => part.type === 'weekday')?.value ?? 'Sun' }
}

export function kstDate(now = new Date()) {
  const { year, month, day } = kstParts(now)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function normalizedDaily(daily: DailyDraw | null, now = new Date()): DailyDraw {
  const date = kstDate(now)
  return daily?.date === date ? daily : { date, count: 0 }
}

export function canSave(saved: SavedGame[], games: number[][]) { return saved.length + games.length <= MAX_SAVED }
export function formatFiveGames(games: number[][]) { return games.map((numbers, index) => `${'ABCDE'[index]} ${numbers.join(' ')}`).join('\n') }
export function visibleBallsForGame(revealed: number, gameIndex: number) { return Math.max(0, Math.min(6, revealed - gameIndex * 6)) }
export function shouldAnimate(drumEnabled: boolean, reducedMotion: boolean) { return drumEnabled && !reducedMotion }
export function isShareCancelled(error: unknown) { return error instanceof Error && /cancel/i.test(error.message) }

export function createDrawGate() {
  let locked = false
  return {
    start: () => { if (locked) return false; locked = true; return true },
    finish: () => { locked = false },
  }
}

type LegacySavedGame = SavedGame & { round?: unknown }

function isSavedGame(value: unknown): value is LegacySavedGame {
  if (!value || typeof value !== 'object') return false
  const game = value as Partial<LegacySavedGame>
  return typeof game.id === 'string'
    && Array.isArray(game.numbers)
    && game.numbers.length === 6
    && new Set(game.numbers).size === 6
    && game.numbers.every((number) => Number.isInteger(number) && number >= 1 && number <= 45)
    && typeof game.createdAt === 'string'
    && (game.source === 'single' || game.source === 'five')
}

export function migrateLegacySaved(value: unknown): SavedGame[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isSavedGame)
    .map(({ id, numbers, createdAt, source }) => ({ id, numbers: [...numbers].sort((a, b) => a - b), createdAt, source }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_SAVED)
}
