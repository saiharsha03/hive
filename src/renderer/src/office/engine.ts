// The office scene engine, shared by the side cutaway and the floor plan: builds the scene for the host's size
// (scaled down with a CSS transform when the panel is too small, so names never clip), keeps states current, and
// plays new team posts one at a time: the sender walks to the first recipient, says it in a bubble, the recipient
// nods, the sender walks back. With reduced motion the bubble shows at the sender's own desk.
import type { LogEntry } from '../../../shared/teamCore'
import { STATE_WORD, boardFit, bubbleText, trimQueue, type BoardRow, type Person } from '../../../shared/officeCore'
import { sideScene } from './side'
import { planScene } from './plan'

export type Mode = 'side' | 'plan'
export type OfficeData = { mode: Mode; people: Person[]; title: string; count: string; board: BoardRow[]; goal: string; knowledge: string[] }
export type P = { x: number; y: number }
export type Geometry = {
  homes: P[]
  route: (from: number, to: number) => P[] // from's home to where it stands to talk to `to`
  face: (fig: HTMLElement, dx: number, dy: number) => void
  homeFace: (i: number) => [number, number]
  figure: (p: Person) => string
}
// a scene draws itself into the stage at the logical size it picks and returns where people sit and walk
export type Built = { geo: Geometry; LW: number; LH: number; s: number }
export type Scene = (stage: HTMLElement, d: OfficeData, W: number, H: number, narrow: boolean) => Built

// the plan board: rows of fixed height so a scene can size it before it exists
export const BOARD_ROW = 18
export const boardHeight = (lines: number) => 44 + BOARD_ROW * lines
export const boardLines = (d: OfficeData) => (d.board.length ? d.board.length : 2)
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
// the whiteboard: the team board of major to-dos (title "Team board", "3 of 7 done") or else the plan rows
export function boardHTML(d: OfficeData, fit: number): string {
  const head = `<h2><span>${esc(d.title)}</span>${d.count ? `<span class="ofc-bcount">${esc(d.count)}</span>` : ''}</h2>`
  if (!d.board.length) return `${head}<div class="ofc-brow"><span class="ofc-bpart" title="${esc(d.goal)}">${esc(d.goal)}</span></div><div class="ofc-brow ofc-bnote">Lead is writing the plan</div>`
  const { shown, more } = boardFit(d.board.length, fit)
  return head + d.board.slice(0, shown).map((r) =>
    `<div class="ofc-brow${r.mark ? ` ofc-t-${r.mark}` : ''}"><span class="ofc-bpart" title="${esc(r.part)}">${r.mark ? `<i class="ofc-box" data-t="${r.mark}"></i>` : ''}${esc(r.part)}</span><span class="ofc-bown" title="${esc(r.owner)}">${esc(r.owner)}</span>` +
    `<span class="ofc-bstate"${r.known ? ` data-w="${r.state.toLowerCase()}"` : ''} title="${esc(r.state)}">${esc(r.state)}</span></div>`).join('') +
    (more ? `<div class="ofc-brow ofc-bnote">+${more} more</div>` : '')
}
export const sheetHTML = (lines: string[]) => `<b>knowledge.md</b>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}`
// name, role, then the state word and the person's own to-dos done ("2/5")
export const plateHTML = (p: Person, i: number) =>
  `<div class="ofc-nm">${esc(p.name)}</div><div class="ofc-rl">${esc(p.role)}</div><div class="ofc-st"><span class="ofc-sw" data-who="${i}"></span><span class="ofc-td" data-td="${i}" title="Own to-dos done">${esc(p.todo)}</span></div>`
export const plateTitle = (p: Person) => `${p.name} (${p.role})${p.doing ? `: ${p.doing}` : ''}. Click to talk`

export function el(parent: HTMLElement, cls: string, html = '', css: Partial<Record<'left' | 'top' | 'width' | 'height', number>> = {}): HTMLDivElement {
  const e = document.createElement('div')
  e.className = cls
  e.innerHTML = html
  for (const [k, v] of Object.entries(css)) e.style.setProperty(k, `${v}px`)
  parent.appendChild(e)
  return e
}

type Char = { el: HTMLDivElement; fig: HTMLDivElement; bubble: HTMLDivElement; pos: P }
const HOLD = 2600

export class Office {
  private stage: HTMLDivElement
  private ro: ResizeObserver
  private data: OfficeData | null = null
  private key = ''
  private size = ''
  private geo: Geometry | null = null
  private chars: Char[] = []
  private s = 1
  private queue: LogEntry[] = []
  private running = false
  private gen = 0
  private dead = false
  private frame = 0
  private reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(private host: HTMLElement, private onOpen: (id: string) => void) {
    this.stage = document.createElement('div')
    this.stage.className = 'ofc-stage'
    host.appendChild(this.stage)
    this.stage.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-open]')
      const p = t && this.data?.people[Number(t.getAttribute('data-open'))]
      if (p) this.onOpen(p.id)
    })
    this.ro = new ResizeObserver(() => {
      cancelAnimationFrame(this.frame)
      this.frame = requestAnimationFrame(() => { if (this.data && this.size !== this.sizeKey()) this.build() })
    })
    this.ro.observe(host)
  }

  set(d: OfficeData): void {
    // the layout depends on who is in the room, the mode and how much the board and note hold; states and
    // board text change in place so a running walk is not cut short
    const key = JSON.stringify([d.mode, d.people.map((p) => [p.id, p.name, p.role]), d.board.length, d.knowledge.length])
    const old = this.data
    this.data = d
    if (key !== this.key || !old) { this.key = key; this.build() } else this.paint(old)
  }

  play(entries: LogEntry[]): void {
    this.queue = trimQueue([...this.queue, ...entries])
    void this.pump()
  }

  clear(): void { this.queue = [] }

  // the user just messaged this person from the chat panel: they nod
  nod(id: string): void {
    const c = this.chars[this.data?.people.findIndex((p) => p.id === id) ?? -1]
    if (!c) return
    c.el.classList.remove('listening')
    void c.el.offsetWidth
    c.el.classList.add('listening')
    setTimeout(() => c.el.classList.remove('listening'), 1100)
  }

  destroy(): void {
    this.dead = true
    this.gen++
    this.ro.disconnect()
    cancelAnimationFrame(this.frame)
    this.stage.remove()
  }

  private sizeKey = () => `${this.host.clientWidth}x${this.host.clientHeight}`

  private build(): void {
    const d = this.data
    if (!d) return
    this.gen++
    this.size = this.sizeKey()
    const W = Math.max(1, this.host.clientWidth), H = Math.max(1, this.host.clientHeight)
    this.stage.innerHTML = ''
    this.stage.className = `ofc-stage ofc-${d.mode}`
    const b = (d.mode === 'plan' ? planScene : sideScene)(this.stage, d, W, H, W <= 720)
    this.geo = b.geo
    this.s = b.s
    Object.assign(this.stage.style, { width: `${b.LW}px`, height: `${b.LH}px`, transform: b.s < 1 ? `scale(${b.s})` : '' })
    this.chars = d.people.map((p, i) => {
      const e = el(this.stage, 'ofc-char home', '')
      e.dataset.who = String(i)
      const fig = el(e, 'ofc-fig', b.geo.figure(p))
      fig.dataset.open = String(i)
      fig.title = plateTitle(p)
      const c: Char = { el: e, fig, bubble: el(e, 'ofc-bubble'), pos: { ...b.geo.homes[i] } }
      this.place(c)
      const [dx, dy] = b.geo.homeFace(i)
      b.geo.face(fig, dx, dy)
      return c
    })
    this.paint(null)
  }

  private paint(old: OfficeData | null): void {
    const d = this.data
    if (!d) return
    d.people.forEach((p, i) => {
      if (old && old.people[i]?.todo !== p.todo) this.stage.querySelectorAll(`[data-td="${i}"]`).forEach((e) => { e.textContent = p.todo })
      if (old && old.people[i]?.state === p.state && old.people[i]?.doing === p.doing) return
      this.stage.querySelectorAll<HTMLElement | SVGElement>(`[data-who="${i}"]`).forEach((e) => {
        e.dataset.s = p.state
        if (e.classList.contains('ofc-sw')) e.textContent = STATE_WORD[p.state]
      })
      this.stage.querySelectorAll<HTMLElement>(`[data-open="${i}"]`).forEach((e) => { e.title = plateTitle(p) })
    })
    const board = this.stage.querySelector<HTMLElement>('.ofc-board')
    if (board && old && (old.goal !== d.goal || old.title !== d.title || old.count !== d.count || JSON.stringify(old.board) !== JSON.stringify(d.board))) board.innerHTML = boardHTML(d, Number(board.dataset.fit)) + '<div class="ofc-tray"></div>'
    const sheet = this.stage.querySelector<HTMLElement>('.ofc-sheet')
    if (sheet && old && old.knowledge.join('\n') !== d.knowledge.join('\n')) sheet.innerHTML = sheetHTML(d.knowledge)
  }

  private place(c: Char): void {
    c.el.style.transform = `translate(${c.pos.x.toFixed(1)}px,${c.pos.y.toFixed(1)}px)`
    c.el.style.zIndex = String(Math.round(c.pos.y) + 10)
  }

  private wait(ms: number, g: number): Promise<boolean> {
    return new Promise((r) => setTimeout(() => r(g === this.gen), ms))
  }

  private seg(c: Char, a: P, b: P, g: number): Promise<boolean> {
    return new Promise((res) => {
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      if (d < 0.5) { c.pos = { ...b }; this.place(c); res(g === this.gen); return }
      this.geo?.face(c.fig, b.x - a.x, b.y - a.y)
      const dur = (d / 130) * 1000, t0 = performance.now()
      const f = (now: number) => {
        if (g !== this.gen) { res(false); return }
        const k = Math.min(1, (now - t0) / dur)
        c.pos = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
        this.place(c)
        if (k < 1) requestAnimationFrame(f); else res(true)
      }
      requestAnimationFrame(f)
    })
  }

  private async walk(c: Char, pts: P[], g: number): Promise<boolean> {
    c.el.classList.add('walking')
    for (let i = 1; i < pts.length; i++) if (!(await this.seg(c, pts[i - 1], pts[i], g))) return false
    c.el.classList.remove('walking')
    return true
  }

  private say(c: Char, text: string): void {
    const b = c.bubble
    b.textContent = text
    b.style.setProperty('--shift', '0px')
    c.el.classList.add('talking')
    const r = b.getBoundingClientRect(), h = this.host.getBoundingClientRect()
    let sh = 0
    if (r.left < h.left + 6) sh = h.left + 6 - r.left
    else if (r.right > h.right - 6) sh = h.right - 6 - r.right
    b.style.setProperty('--shift', `${(sh / this.s).toFixed(1)}px`)
  }

  private faceHome(i: number): void {
    const c = this.chars[i], geo = this.geo
    if (!c || !geo) return
    const [dx, dy] = geo.homeFace(i)
    geo.face(c.fig, dx, dy)
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    while (this.queue.length && !this.dead) {
      const e = this.queue.shift()!
      await this.deliver(e)
    }
    this.running = false
  }

  private async deliver(e: LogEntry): Promise<void> {
    const d = this.data, geo = this.geo
    if (!d || !geo) return
    const g = this.gen
    const fi = d.people.findIndex((p) => p.id === e.from)
    if (fi < 0) return
    const ti = e.to.map((n) => d.people.findIndex((p) => p.name.toLowerCase() === n.toLowerCase() || p.id === n)).find((i) => i >= 0 && i !== fi) ?? -1
    const c = this.chars[fi], t = ti >= 0 ? this.chars[ti] : null
    const text = bubbleText(e.text)
    if (!t || this.reduce) {
      t?.el.classList.add('listening')
      this.say(c, text)
      await this.wait(HOLD, g)
      c.el.classList.remove('talking')
      t?.el.classList.remove('listening')
      await this.wait(300, g)
      return
    }
    const path = geo.route(fi, ti)
    c.el.classList.remove('home')
    const back = () => { c.el.classList.remove('walking', 'talking'); c.el.classList.add('home'); t.el.classList.remove('listening') }
    if (!(await this.walk(c, path, g))) return back()
    geo.face(c.fig, t.pos.x - c.pos.x, t.pos.y - c.pos.y)
    geo.face(t.fig, c.pos.x - t.pos.x, c.pos.y - t.pos.y)
    t.el.classList.add('listening')
    this.say(c, text)
    const held = await this.wait(HOLD, g)
    c.el.classList.remove('talking')
    t.el.classList.remove('listening')
    if (!held || !(await this.wait(250, g))) return back()
    if (!(await this.walk(c, [...path].reverse(), g))) return back()
    c.el.classList.add('home')
    this.faceHome(fi)
    this.faceHome(ti)
    await this.wait(400, g)
  }
}
