import { isShareCancelled, migrateLegacySaved, type SavedGame } from './lotto'

export const SAVED_KEY = 'lucky:v1:saved'
export const LEGACY_SAVED_KEY = 'lotto:v1:saved'

export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

function parseSaved(value: string) {
  try { return JSON.parse(value) as unknown } catch { return [] }
}

export async function loadSavedGames(storage: KeyValueStorage): Promise<SavedGame[]> {
  const current = await storage.getItem(SAVED_KEY)
  if (current !== null) return migrateLegacySaved(parseSaved(current))

  const legacy = await storage.getItem(LEGACY_SAVED_KEY)
  if (legacy === null) return []

  const migrated = migrateLegacySaved(parseSaved(legacy))
  await storage.setItem(SAVED_KEY, JSON.stringify(migrated))
  storage.removeItem(LEGACY_SAVED_KEY).catch(() => {})
  return migrated
}

export async function persistSavedGames(storage: KeyValueStorage, next: SavedGame[], apply: (games: SavedGame[]) => void) {
  await storage.setItem(SAVED_KEY, JSON.stringify(next))
  apply(next)
}

export function createResettableTimer<T>(schedule: (callback: () => void, delay: number) => T, cancel: (timer: T) => void) {
  let active: T | undefined
  return {
    start: (callback: () => void, delay = 2200) => {
      if (active !== undefined) cancel(active)
      active = schedule(() => { active = undefined; callback() }, delay)
    },
    cancel: () => { if (active !== undefined) { cancel(active); active = undefined } },
  }
}

export type ShareResult = 'shared' | 'cancelled' | 'copied' | 'copy-failed'

export async function shareLuckyNumbers(
  send: (message: string) => Promise<void>,
  copy: (message: string) => Promise<void>,
  message: string,
): Promise<ShareResult> {
  try {
    await send(message)
    return 'shared'
  } catch (error) {
    if (isShareCancelled(error)) return 'cancelled'
    try {
      await copy(message)
      return 'copied'
    } catch {
      return 'copy-failed'
    }
  }
}
