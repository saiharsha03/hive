// Side cutaway: the office sliced open like a building section. One left to right lane per floor, names in the cut
// slab under each desk, the plan board on the top floor's wall (or beside the building when the panel is wide and
// short). More than six people stack into floors joined by a lift at the right end.
import { floorsOf } from '../../../shared/officeCore'
import { BOARD_ROW, boardHTML, boardHeight, boardLines, el, plateHTML, plateTitle, sheetHTML, type Built, type OfficeData, type P } from './engine'
import { sideDesk, sideFigure } from './figures'

const WALL = 12, CEIL = 22, SLAB = 46, FI = 118, SEAT = 84, VISIT = 40, CW = 120, BAY = 44, ABOVE = 124, TOPGAP = 30, BW = 320, LANE = 8

const hatch = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#2f2f2f"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#ofc-ht)"/>`
const r = (x: number, y: number, w: number, h: number, fill: string, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`

export function sideScene(stage: HTMLElement, d: OfficeData, W: number, H: number, narrow: boolean): Built {
  const n = d.people.length, floors = floorsOf(n), F = floors.length, cols = floors[0].length
  const need = boardLines(d)
  const lines = (h: number, fixed: number) => Math.max(Math.min(need, 4), Math.min(need, 10, Math.floor((h - fixed) / BOARD_ROW)))
  const lower = (F - 1) * (FI + SLAB)

  // two ways to hang the board; take the one that needs less shrinking, then the one that shows more rows
  const topFixed = CEIL + TOPGAP + boardHeight(0) + ABOVE + SLAB + lower
  const topW = 2 * WALL + cols * CW + BAY
  const topS = Math.min(1, W / topW, H / (topFixed + BOARD_ROW * lines(H, topFixed)))
  const topLines = lines(H / topS, topFixed)
  const leftFixed = CEIL + 21 + boardHeight(0)
  const leftS = Math.min(1, W / (BW + 16 + topW), H / (CEIL + F * (FI + SLAB)))
  const leftLines = lines(H / leftS, leftFixed)
  const left = leftS > topS + 0.01 || (leftS >= topS - 0.01 && topLines < need && leftLines > topLines)
  const s = left ? leftS : topS, fit = left ? leftLines : topLines
  const LW = W / s, LH = H / s

  const bx = left ? BW + 16 : 0
  const wallL = bx + WALL, wallR = LW - WALL, IW = wallR - wallL
  const cw = (IW - BAY) / cols, off = Math.max(0, (cw - CW) / 2)
  const inner = left ? Array(F).fill((LH - CEIL - F * SLAB) / F) : [LH - CEIL - SLAB - lower, ...Array(F - 1).fill(FI)]
  const ceilY: number[] = [], floorY: number[] = []
  inner.forEach((h: number, f) => { ceilY[f] = f ? floorY[f - 1] + SLAB : CEIL; floorY[f] = ceilY[f] + h })
  const shaftX = wallR - BAY / 2

  // board and note
  const bh = boardHeight(fit)
  const bw = left ? BW : Math.max(300, Math.min(560, IW * 0.5, IW - 60))
  const bX = left ? 12 : wallL + 22, bY = left ? CEIL : floorY[0] - ABOVE - bh
  const board = el(stage, 'ofc-board', boardHTML(d, fit) + '<div class="ofc-tray"></div>', { left: bX, top: bY, width: bw })
  board.dataset.fit = String(fit)
  let sheetRight = bX + bw
  if (!narrow && d.knowledge.length) {
    const sx = left ? 20 : bX + bw + 40, sy = left ? bY + bh + 26 : bY + 10
    if (left ? LH - sy > 96 : sx + 160 <= wallR - 10) { el(stage, 'ofc-sheet', sheetHTML(d.knowledge), { left: sx, top: sy, width: 150 }).style.maxHeight = `${Math.max(bh, left ? LH - sy - 10 : 0) - 14}px`; sheetRight = sx + 150 }
  }

  // the building section
  let s2 = `<svg class="ofc-shell" width="${LW}" height="${LH}"><defs><pattern id="ofc-ht" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="#383838" stroke-width="2"/></pattern></defs>`
  floors.forEach((_, f) => {
    s2 += r(wallL, ceilY[f], IW, floorY[f] - ceilY[f], '#26282b') + r(wallL, floorY[f] - 7, IW, 7, '#2f3236')
    if (f === 0) {
      s2 += r(wallL, ceilY[f] + 8, IW, 16, '#33363a')
      for (let x = wallL + 60; x < wallR; x += 120) s2 += r(x, ceilY[f] + 6, 6, 20, '#3d4146')
    }
  })
  const wx = wallR - BAY - 196
  if (!left && wx >= sheetRight + 30) {
    const wy = bY, wh = Math.min(120, Math.max(70, bh))
    s2 += r(wx, wy, 168, wh, '#151d27', ' stroke="#4b5056" stroke-width="4"')
    ;[[8, 70, 26], [38, 52, 22], [64, 84, 30], [100, 60, 24], [130, 92, 30]].forEach(([dx, h0, w], i) => {
      const h = Math.min(h0, wh - 8)
      s2 += r(wx + dx, wy + wh - h, w, h, '#0e141b')
      for (let k = 0; k < 4; k++) if ((i + k) % 3 !== 1 && 8 + Math.floor(k / 2) * 14 + 5 < h) s2 += r(wx + dx + 5 + (k % 2) * 9, wy + wh - h + 8 + Math.floor(k / 2) * 14, 5, 5, '#c9a24d', ' opacity=".7"')
    })
    s2 += `<line x1="${wx + 84}" y1="${wy}" x2="${wx + 84}" y2="${wy + wh}" stroke="#4b5056" stroke-width="3"/>`
  }
  const homes: P[] = []
  floors.forEach((ids, f) => ids.forEach((i, c) => {
    const x = wallL + c * cw + off + SEAT
    homes[i] = { x, y: floorY[f] }
    const lx = x - 30, top = ceilY[f] + (f === 0 ? 24 : 0)
    const ly = f === 0 && !left ? Math.max(ceilY[f] + 40, bY - 18) : ceilY[f] + 26
    s2 += `<line x1="${lx}" y1="${top}" x2="${lx}" y2="${ly}" stroke="#555" stroke-width="1.5"/>` +
      `<path d="M${lx - 13} ${ly + 12} L${lx - 5} ${ly} H${lx + 5} L${lx + 13} ${ly + 12} Z" fill="#3f5a52"/>` + r(lx - 6, ly + 12, 12, 3, '#efe2bd', ' rx="1.5"')
  }))
  // cut slabs and end walls
  s2 += hatch(bx, 0, LW - bx, CEIL)
  floors.forEach((_, f) => {
    s2 += hatch(bx, floorY[f], LW - bx, f === F - 1 ? LH - floorY[f] : SLAB) + hatch(bx, ceilY[f], WALL, floorY[f] - ceilY[f]) + hatch(wallR, ceilY[f], LW - wallR, floorY[f] - ceilY[f])
    s2 += `<line x1="${bx}" y1="${floorY[f]}" x2="${LW}" y2="${floorY[f]}" stroke="#4a4a4a" stroke-width="2"/>`
  })
  s2 += `<line x1="${bx}" y1="${CEIL}" x2="${LW}" y2="${CEIL}" stroke="#444" stroke-width="2"/>`
  if (F > 1) {
    const y0 = ceilY[0] + 30, y1 = floorY[F - 1]
    s2 += r(shaftX - 15, y0, 30, y1 - y0, '#1c1d1f') + `<path d="M${shaftX - 15} ${y0} V${y1} M${shaftX + 15} ${y0} V${y1}" stroke="#4b5056" stroke-width="2"/>`
    floorY.forEach((y) => { s2 += r(shaftX - 15, y - 2, 30, 2, '#4b5056') })
  }
  s2 += '</svg>'
  stage.insertAdjacentHTML('afterbegin', s2)

  d.people.forEach((p, i) => {
    const h = homes[i]
    el(stage, 'ofc-desk', sideDesk(i)).style.transform = `translate(${h.x}px,${h.y}px)`
    const plate = el(stage, 'ofc-plate', plateHTML(p, i), { left: h.x - SEAT - off + 4, top: h.y + 5, width: cw - 8 })
    plate.dataset.open = String(i)
    plate.title = plateTitle(p)
  })

  const lane = (y: number) => y + LANE
  return {
    s, LW, LH,
    geo: {
      homes,
      route(a, b) {
        const A = homes[a], T = homes[b], V = { x: T.x + VISIT, y: T.y + 3 }
        if (A.y === T.y) return [A, { x: A.x, y: lane(A.y) }, { x: V.x, y: lane(A.y) }, V]
        return [A, { x: A.x, y: lane(A.y) }, { x: shaftX, y: lane(A.y) }, { x: shaftX, y: lane(T.y) }, { x: V.x, y: lane(T.y) }, V]
      },
      face(fig, dx) { if (Math.abs(dx) > 0.5) fig.style.setProperty('--flip', dx < 0 ? '-1' : '1') },
      homeFace: () => [-1, 0],
      figure: (p) => sideFigure(p.look),
    },
  }
}
