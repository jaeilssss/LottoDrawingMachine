import { afterEach, describe, expect, it, vi } from 'vitest'
import { canSave, createDrawGate, formatFiveGames, isShareCancelled, migrateLegacySaved, normalizedDaily, pickNumbers, shouldAnimate, visibleBallsForGame, type SavedGame } from './lotto'
import { createResettableTimer, LEGACY_SAVED_KEY, loadSavedGames, persistSavedGames, SAVED_KEY, shareLuckyNumbers } from './lucky-flow'

afterEach(() => vi.useRealTimers())

const saved = (length: number): SavedGame[] => Array.from({ length }, (_, index) => ({
  id: String(index), numbers: [1, 2, 3, 4, 5, 6], createdAt: '2026-01-01T00:00:00.000Z', source: 'single',
}))

describe('행운 번호 규칙', () => {
  it('1~45 사이에서 중복 없는 오름차순 여섯 수를 만든다', () => {
    for (let index = 0; index < 20; index += 1) {
      const numbers = pickNumbers()
      expect(numbers).toHaveLength(6)
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
      expect(new Set(numbers).size).toBe(6)
      expect(numbers.every((number) => number >= 1 && number <= 45)).toBe(true)
    }
  })
})

describe('저장 이관 규칙', () => {
  it('기존 저장에서 round를 제거하고 최신 50개만 새 형식으로 만든다', () => {
    const migrated = migrateLegacySaved([
      { id: 'old', round: 12, numbers: [1, 2, 3, 4, 5, 6], createdAt: '2026-01-01T00:00:00.000Z', source: 'single' },
      { id: 'new', round: 13, numbers: [2, 3, 4, 5, 6, 7], createdAt: '2026-02-01T00:00:00.000Z', source: 'five' },
      { id: 'invalid', numbers: [1, 1, 2], createdAt: '2026-03-01T00:00:00.000Z', source: 'single' },
    ])
    expect(migrated).toEqual([
      { id: 'new', numbers: [2, 3, 4, 5, 6, 7], createdAt: '2026-02-01T00:00:00.000Z', source: 'five' },
      { id: 'old', numbers: [1, 2, 3, 4, 5, 6], createdAt: '2026-01-01T00:00:00.000Z', source: 'single' },
    ])
  })

  it('새 저장 키가 있으면 기존 저장 키를 읽거나 변경하지 않는다', async () => {
    const calls: string[] = []
    const storage = {
      getItem: async (key: string) => { calls.push(`get:${key}`); return key === SAVED_KEY ? JSON.stringify([saved(1)[0]]) : JSON.stringify([saved(1)[0], saved(1)[0]]) },
      setItem: async () => { calls.push('set') },
      removeItem: async () => { calls.push('remove') },
    }
    await expect(loadSavedGames(storage)).resolves.toEqual(saved(1))
    expect(calls).toEqual([`get:${SAVED_KEY}`])
  })

  it('기존 저장은 새 키에 성공적으로 쓴 뒤에만 삭제한다', async () => {
    const calls: string[] = []
    const legacy = [{ ...saved(1)[0], round: 7 }]
    const storage = {
      getItem: async (key: string) => { calls.push(`get:${key}`); return key === LEGACY_SAVED_KEY ? JSON.stringify(legacy) : null },
      setItem: async (key: string) => { calls.push(`set:${key}`) },
      removeItem: async (key: string) => { calls.push(`remove:${key}`) },
    }
    await expect(loadSavedGames(storage)).resolves.toEqual(saved(1))
    await Promise.resolve()
    expect(calls).toEqual([`get:${SAVED_KEY}`, `get:${LEGACY_SAVED_KEY}`, `set:${SAVED_KEY}`, `remove:${LEGACY_SAVED_KEY}`])
  })

  it('새 키 쓰기에 실패하면 기존 저장을 삭제하지 않고 다음 실행에서 다시 시도한다', async () => {
    const calls: string[] = []
    const storage = {
      getItem: async (key: string) => { calls.push(`get:${key}`); return key === LEGACY_SAVED_KEY ? JSON.stringify([saved(1)[0]]) : null },
      setItem: async () => { calls.push('set'); throw new Error('write failed') },
      removeItem: async () => { calls.push('remove') },
    }
    await expect(loadSavedGames(storage)).rejects.toThrow('write failed')
    expect(calls).toEqual([`get:${SAVED_KEY}`, `get:${LEGACY_SAVED_KEY}`, 'set'])
  })

  it('KST 날짜가 바뀌면 오늘 횟수를 0으로 초기화한다', () => {
    const now = new Date('2026-10-14T15:30:00.000Z')
    expect(normalizedDaily({ date: '2026-10-14', count: 2 }, now)).toEqual({ date: '2026-10-15', count: 0 })
    expect(normalizedDaily({ date: '2026-10-15', count: 2 }, now)).toEqual({ date: '2026-10-15', count: 2 })
  })
})

describe('저장 규칙', () => {
  it('1건과 5건 저장을 모두 원자적으로 한도 검사한다', () => {
    expect(canSave(saved(49), [[1, 2, 3, 4, 5, 6]])).toBe(true)
    expect(canSave(saved(49), Array.from({ length: 5 }, () => [1, 2, 3, 4, 5, 6]))).toBe(false)
    expect(canSave(saved(45), Array.from({ length: 5 }, () => [1, 2, 3, 4, 5, 6]))).toBe(true)
  })

  it('5게임 복사 형식은 A~E를 줄바꿈으로 구분한다', () => {
    expect(formatFiveGames([[3, 11, 19, 27, 34, 42], [1, 2, 3, 4, 5, 6]])).toBe('A 3 11 19 27 34 42\nB 1 2 3 4 5 6')
  })

  it('저장 삭제와 되돌리기는 저장 성공 후에만 목록 상태를 바꾼다', async () => {
    const before = saved(1)
    const afterDelete: SavedGame[] = []
    let visible = before
    await expect(persistSavedGames({ getItem: async () => null, setItem: async () => { throw new Error('write failed') }, removeItem: async () => {} }, afterDelete, (next) => { visible = next })).rejects.toThrow('write failed')
    expect(visible).toEqual(before)

    const restored = [...before, ...afterDelete]
    await persistSavedGames({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }, restored, (next) => { visible = next })
    expect(visible).toEqual(restored)
  })

  it('삭제 되돌리기 CTA는 마지막 삭제 뒤 2.2초 동안 유지된다', () => {
    vi.useFakeTimers()
    let undoVisible = true
    const timer = createResettableTimer(setTimeout, clearTimeout)
    timer.start(() => { undoVisible = false })
    vi.advanceTimersByTime(2100)
    timer.start(() => { undoVisible = false })
    vi.advanceTimersByTime(2199)
    expect(undoVisible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(undoVisible).toBe(false)
  })
})

describe('뽑기와 공유 흐름', () => {
  it('진행 중에는 중복 뽑기를 시작하지 못한다', () => {
    const gate = createDrawGate()
    expect(gate.start()).toBe(true)
    expect(gate.start()).toBe(false)
    gate.finish()
    expect(gate.start()).toBe(true)
  })

  it('5게임의 30개 공을 한 공씩 공개하고 동작 줄이기에서는 연출을 생략한다', () => {
    expect(visibleBallsForGame(7, 0)).toBe(6)
    expect(visibleBallsForGame(7, 1)).toBe(1)
    expect(visibleBallsForGame(7, 2)).toBe(0)
    expect(shouldAnimate(true, false)).toBe(true)
    expect(shouldAnimate(false, false)).toBe(false)
    expect(shouldAnimate(true, true)).toBe(false)
  })

  it('공유 취소는 복사 대체를 하지 않고, 다른 실패만 대체한다', () => {
    expect(isShareCancelled(new Error('user cancelled'))).toBe(true)
    expect(isShareCancelled(new Error('not supported'))).toBe(false)
    expect(isShareCancelled(undefined)).toBe(false)
  })

  it('공유 취소는 조용히 닫고, 실패하면 같은 메시지를 복사한다', async () => {
    const message = '내 행운 번호: 1, 2, 3, 4, 5, 6'
    const copied: string[] = []
    await expect(shareLuckyNumbers(async () => { throw new Error('user cancelled') }, async (text) => { copied.push(text) }, message)).resolves.toBe('cancelled')
    await expect(shareLuckyNumbers(async () => { throw new Error('unsupported') }, async (text) => { copied.push(text) }, message)).resolves.toBe('copied')
    await expect(shareLuckyNumbers(async () => { throw new Error('unsupported') }, async () => { throw new Error('clipboard failed') }, message)).resolves.toBe('copy-failed')
    expect(copied).toEqual([message])
  })
})
