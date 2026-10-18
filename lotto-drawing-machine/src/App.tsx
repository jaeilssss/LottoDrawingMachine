import { Clipboard, Device, Share, Storage } from '@apps-in-toss/web-framework'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Close } from './components/icons'
import { canSave, createDrawGate, DEFAULT_PREFERENCES, fiveGames, formatFiveGames, MAX_SAVED, normalizedDaily, pickNumbers, shouldAnimate, type DailyDraw, type Preferences, type SavedGame, type Source, visibleBallsForGame } from './lib/lotto'
import { createResettableTimer, loadSavedGames, persistSavedGames, shareLuckyNumbers } from './lib/lucky-flow'
import './App.css'

const DAILY_KEY = 'lucky:v1:daily'
const PREFS_KEY = 'lucky:v1:prefs'

const Ball = ({ n, hidden = false }: { n: number; hidden?: boolean }) => <i aria-label={hidden ? '공 공개 대기' : `${n}번`} className={`ball b${Math.floor((n - 1) / 10)}${hidden ? ' hidden' : ''}`}>{hidden ? '?' : n}</i>
const Balls = ({ n, visible = n.length }: { n: number[]; visible?: number }) => <span className="balls">{n.map((x, index) => <Ball key={`${x}-${index}`} n={x} hidden={index >= visible} />)}</span>
function parse<T>(value: string | null, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback } catch { return fallback } }
function dateLabel(createdAt: string) { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(new Date(createdAt)) }
function timeLabel(createdAt: string) { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(new Date(createdAt)) }
function makeShareImage(numbers: number[]) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1080
  const context = canvas.getContext('2d'); if (!context) return ''
  context.fillStyle = '#F2F7F6'; context.fillRect(0, 0, 1080, 1080)
  context.fillStyle = '#0F766E'; context.beginPath(); context.roundRect(72, 72, 936, 936, 52); context.fill()
  context.fillStyle = '#FFFFFF'; context.font = '600 42px system-ui'; context.textAlign = 'center'; context.fillText('내 행운 번호', 540, 255)
  const colors = ['#F3C94B', '#9DD6E9', '#F59B95', '#CCD1D5', '#C8DF78']
  numbers.forEach((number, index) => { const x = 172 + index * 147; context.fillStyle = colors[Math.floor((number - 1) / 10)]; context.beginPath(); context.arc(x, 535, 57, 0, Math.PI * 2); context.fill(); context.fillStyle = '#191F28'; context.font = '700 38px system-ui'; context.fillText(String(number), x, 549) })
  context.fillStyle = '#D7EFEB'; context.font = '400 30px system-ui'; context.fillText('무작위로 뽑은 번호예요', 540, 800)
  return canvas.toDataURL('image/png')
}

export default function App() {
  const [numbers, setNumbers] = useState(pickNumbers)
  const [saved, setSaved] = useState<SavedGame[]>([])
  const [daily, setDaily] = useState<DailyDraw>({ date: '', count: 0 })
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES)
  const [pending, setPending] = useState<{ games: number[][]; source: Source } | null>(null)
  const [five, setFive] = useState<number[][] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | 'all' | null>(null)
  const [undo, setUndo] = useState<SavedGame[] | null>(null)
  const [toast, setToast] = useState('')
  const [reveal, setReveal] = useState(0)
  const [fiveReveal, setFiveReveal] = useState(5)
  const timeoutRef = useRef<number[]>([])
  const undoTimerRef = useRef(createResettableTimer(window.setTimeout, window.clearTimeout))
  const toastTimerRef = useRef(createResettableTimer(window.setTimeout, window.clearTimeout))
  const drawGateRef = useRef(createDrawGate())
  const shareImage = useMemo(() => makeShareImage(numbers), [numbers])
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const isDrawing = pending !== null
  const notify = (message: string) => { setToast(message); toastTimerRef.current.start(() => setToast('')) }
  const clearTimers = () => { timeoutRef.current.forEach(window.clearTimeout); timeoutRef.current = [] }

  useEffect(() => {
    const undoTimer = undoTimerRef.current
    const toastTimer = toastTimerRef.current
    Promise.all([loadSavedGames(Storage), Storage.getItem(DAILY_KEY), Storage.getItem(PREFS_KEY)]).then(async ([loadedSaved, dailyValue, prefsValue]) => {
      setSaved(loadedSaved)
      const currentDaily = normalizedDaily(parse<DailyDraw | null>(dailyValue, null)); setDaily(currentDaily)
      setPrefs({ ...DEFAULT_PREFERENCES, ...parse<Partial<Preferences>>(prefsValue, {}) })
      if (dailyValue !== JSON.stringify(currentDaily)) Storage.setItem(DAILY_KEY, JSON.stringify(currentDaily)).catch(() => {})
    }).catch(() => notify('저장된 정보를 불러오지 못했어요. 다시 시도해 주세요.'))
    return () => { clearTimers(); undoTimer.cancel(); toastTimer.cancel() }
  }, [])

  const haptic = (type: 'tap' | 'tickWeak' | 'success') => { if (prefs.haptic) Device.triggerHaptic({ type }).catch(() => {}) }
  const persistSaved = async (next: SavedGame[]) => { await persistSavedGames(Storage, next, setSaved) }
  const copy = async (text: string) => { try { await Clipboard.setText(text); notify('번호를 복사했어요.') } catch { notify('복사하지 못했어요. 다시 시도해 주세요.') } }
  const updatePreferences = async (next: Preferences) => { try { await Storage.setItem(PREFS_KEY, JSON.stringify(next)); setPrefs(next) } catch { notify('설정을 저장하지 못했어요. 다시 시도해 주세요.') } }
  const completeDraw = (result: { games: number[][]; source: Source }) => {
    clearTimers(); setReveal(result.games[0].length); setPending(null); drawGateRef.current.finish()
    if (result.source === 'single') setNumbers(result.games[0])
    else {
      const revealImmediately = !shouldAnimate(prefs.drum, reducedMotion)
      setFiveReveal(revealImmediately ? 30 : 0); setFive(result.games)
      if (!revealImmediately) {
        result.games.flat().forEach((_, index) => timeoutRef.current.push(window.setTimeout(() => { setFiveReveal(index + 1); haptic('tickWeak') }, (index + 1) * 70)))
      }
    }
    haptic('success')
  }
  const finishDraw = () => { if (pending) completeDraw(pending) }
  const draw = async (source: Source) => {
    if (!drawGateRef.current.start()) return
    const games = source === 'single' ? [pickNumbers()] : fiveGames(); const currentDaily = normalizedDaily(daily); const nextDaily = { ...currentDaily, count: currentDaily.count + 1 }
    try { await Storage.setItem(DAILY_KEY, JSON.stringify(nextDaily)); setDaily(nextDaily) } catch { drawGateRef.current.finish(); notify('오늘 뽑은 횟수를 저장하지 못했어요. 다시 시도해 주세요.'); return }
    haptic('tap'); if (!prefs.drum || reducedMotion) { completeDraw({ games, source }); return }
    setReveal(0); setPending({ games, source }); const duration = prefs.short && nextDaily.count >= 3 ? 800 : 1400
    for (let index = 1; index <= 6; index += 1) timeoutRef.current.push(window.setTimeout(() => { setReveal(index); haptic('tickWeak') }, Math.round(duration * index / 7)))
    timeoutRef.current.push(window.setTimeout(() => completeDraw({ games, source }), duration))
  }
  const save = async (games: number[][], source: Source) => {
    if (!canSave(saved, games)) { notify(`저장은 ${MAX_SAVED}개까지 할 수 있어요.`); return }
    const records = games.map((game) => ({ id: crypto.randomUUID(), numbers: game, source, createdAt: new Date().toISOString() }))
    try { await persistSaved([...records, ...saved]); notify(`${games.length}게임을 저장했어요.`) } catch { notify('저장하지 못했어요. 다시 시도해 주세요.') }
  }
  const removeSaved = async () => { const removed = deleteTarget === 'all' ? saved : saved.filter((game) => game.id === deleteTarget); const next = deleteTarget === 'all' ? [] : saved.filter((game) => game.id !== deleteTarget); try { await persistSaved(next); setUndo(removed); undoTimerRef.current.start(() => setUndo(null)); setDeleteTarget(null); notify('삭제했어요. 되돌릴 수 있어요.') } catch { notify('삭제하지 못했어요. 다시 시도해 주세요.') } }
  const restore = async () => { if (!undo) return; if (!canSave(saved, undo.map((game) => game.numbers))) { notify('저장 한도 때문에 되돌릴 수 없어요.'); return } try { await persistSaved([...undo, ...saved]); undoTimerRef.current.cancel(); setUndo(null); notify('삭제를 되돌렸어요.') } catch { notify('되돌리지 못했어요. 다시 시도해 주세요.') } }
  const share = async () => { const text = `내 행운 번호: ${numbers.join(', ')}`; const result = await shareLuckyNumbers((message) => Share.sendMessage({ message }), Clipboard.setText, text); setShareOpen(false); if (result === 'copied') notify('번호를 복사했어요.'); if (result === 'copy-failed') notify('복사하지 못했어요. 다시 시도해 주세요.') }
  const preview = saved.slice(0, 4)
  const savedGroups = saved.reduce<Record<string, SavedGame[]>>((groups, game) => { const key = dateLabel(game.createdAt); (groups[key] ??= []).push(game); return groups }, {})

  return <main className="lucky canvas">
    <header className="hero"><div><p className="eyebrow">1부터 45까지 무작위 번호</p><h1>오늘의 행운 번호를<br />뽑아볼까요?</h1></div><button className="icon-button" aria-label="설정 열기" onClick={() => setSettingsOpen(true)}>⚙️</button></header>
    <p className="draw-count">오늘 <strong>{daily.count}</strong>번 뽑았어요</p>
    <section className="number-card" aria-live="polite"><p className="eyebrow">오늘의 추천 번호</p><Balls n={numbers} /><div className="card-actions"><button disabled={isDrawing} onClick={() => copy(numbers.join(' '))}>번호 복사</button><button disabled={isDrawing} onClick={() => setShareOpen(true)}>공유하기</button><button disabled={isDrawing} onClick={() => save([numbers], 'single')}>저장하기</button></div></section>
    <section className="saved-preview"><div className="section-title"><h2>저장한 번호 <span>{saved.length}</span></h2>{saved.length > 0 && <button className="text-button" onClick={() => setSavedOpen(true)}>전체 보기 <ChevronRight /></button>}</div>{preview.length === 0 ? <p className="empty">아직 저장한 번호가 없어요.</p> : preview.map((game) => <div className="saved-row" key={game.id}><div><p>{game.source === 'five' ? '5게임' : '한 게임'}</p><Balls n={game.numbers} /></div><span>{timeLabel(game.createdAt)}</span></div>)}</section>
    <p className="notice">번호는 무작위로 뽑아요. 특별한 기준을 반영하지 않아요.</p>
    <footer><button onClick={() => draw('five')} disabled={isDrawing}>5게임 뽑기</button><button className="primary" onClick={() => draw('single')} disabled={isDrawing}>{isDrawing ? '번호를 섞는 중' : '번호 뽑기'}</button></footer>
    {pending && <div className="modal drum" role="dialog" aria-modal="true"><section><p className="eyebrow">행운 번호를 뽑고 있어요</p><h2>{pending.source === 'single' ? '공이 하나씩 도착해요' : '5게임을 준비하고 있어요'}</h2>{pending.source === 'single' && <Balls n={pending.games[0]} visible={reveal} />}<button className="text-button skip" onClick={finishDraw}>건너뛰기</button></section></div>}
    {five && <div className="modal" role="dialog" aria-modal="true"><section className="sheet"><button className="icon-button close" aria-label="닫기" onClick={() => setFive(null)}><Close /></button><p className="eyebrow">5게임 결과</p><h2>번호를 뽑았어요</h2>{five.map((game, index) => <div className="game-row" key={index}><strong>{'ABCDE'[index]}</strong><Balls n={game} visible={visibleBallsForGame(fiveReveal, index)} /></div>)}<div className="sheet-actions"><button disabled={fiveReveal < 30} onClick={() => copy(formatFiveGames(five))}>전체 복사</button><button className="primary" disabled={fiveReveal < 30} onClick={() => save(five, 'five')}>전체 저장</button></div></section></div>}
    {shareOpen && <div className="modal" role="dialog" aria-modal="true"><section className="sheet share-sheet"><button className="icon-button close" aria-label="닫기" onClick={() => setShareOpen(false)}><Close /></button><p className="eyebrow">공유 미리보기</p><h2>내 행운 번호</h2>{shareImage && <img src={shareImage} alt={`공유 이미지: ${numbers.join(', ')}`} />}<Balls n={numbers} /><div className="sheet-actions"><button onClick={() => copy(numbers.join(' '))}>번호만 복사</button><button className="primary" onClick={share}>공유하기</button></div></section></div>}
    {settingsOpen && <div className="modal" role="dialog" aria-modal="true"><section className="sheet"><button className="icon-button close" aria-label="닫기" onClick={() => setSettingsOpen(false)}><Close /></button><p className="eyebrow">설정</p><h2>뽑기 연출</h2>{([['drum', '연출 보기', '번호를 뽑을 때 드럼을 보여줘요.'], ['short', '세 번째부터 단축', '오늘 세 번째 뽑기부터 시간을 줄여요.'], ['haptic', '진동', '탭과 번호 도착을 진동으로 알려줘요.']] as const).map(([key, title, description]) => <label className="setting-row" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={prefs[key]} onChange={(event) => updatePreferences({ ...prefs, [key]: event.target.checked })} /></label>)}</section></div>}
    {savedOpen && <div className="page-modal" role="dialog" aria-modal="true"><section><header className="page-header"><div><p className="eyebrow">저장한 번호</p><h1>{saved.length}개를 보관 중이에요</h1></div><button className="icon-button" aria-label="닫기" onClick={() => setSavedOpen(false)}><Close /></button></header>{saved.length > 0 && <button className="danger-button" onClick={() => setDeleteTarget('all')}>전체 삭제</button>}{saved.length === 0 ? <p className="empty full">저장한 번호가 없어요. 번호를 뽑은 뒤 저장해 보세요.</p> : Object.entries(savedGroups).map(([date, games]) => <section className="saved-group" key={date}><h2>{date}</h2>{games.map((game) => <article className="saved-card" key={game.id}><div><p className="eyebrow">{timeLabel(game.createdAt)}</p><strong>{game.source === 'five' ? '5게임' : '한 게임'}</strong><Balls n={game.numbers} /></div><button className="icon-button" aria-label="저장 번호 삭제" onClick={() => setDeleteTarget(game.id)}><Close /></button></article>)}</section>)}</section></div>}
    {deleteTarget && <div className="modal confirm" role="dialog" aria-modal="true"><section className="sheet"><h2>{deleteTarget === 'all' ? '저장한 번호를 모두 삭제할까요?' : '이 번호를 삭제할까요?'}</h2><p>삭제한 번호는 이 화면에서 바로 되돌릴 수 있어요.</p><div className="sheet-actions"><button onClick={() => setDeleteTarget(null)}>취소</button><button className="danger-button" onClick={removeSaved}>삭제</button></div></section></div>}
    {toast && <aside role="status">{toast}{undo && <button onClick={restore}>되돌리기</button>}</aside>}
  </main>
}
