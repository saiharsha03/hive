// Floor plan: the office from above. Two rows of desks face a shared aisle, so every hand-off is a short trip along
// it; each desk's monitor light carries its owner's state. The board hangs on the north wall, or on the west wall
// when the panel is wide and short. Columns are added as people join.
import { BOARD_ROW, boardHTML, boardHeight, boardLines, el, plateHTML, plateTitle, sheetHTML, type Built, type OfficeData, type P } from './engine'
import { topDesk, topFigure } from './figures'

const MX = 12, MT = 10, MB = 8, WALL = 7, CW = 124, PLANT = 46, EAST = 24, BW = 330, FB = 282, VISIT = 42

export function planScene(stage: HTMLElement, d: OfficeData, W: number, H: number, narrow: boolean): Built {
  const n = d.people.length, cols = Math.max(1, Math.ceil(n / 2))
  const need = boardLines(d)
  const lines = (h: number, fixed: number) => Math.max(Math.min(need, 4), Math.min(need, 10, Math.floor((h - fixed) / BOARD_ROW)))
  const frame = 2 * MX + 2 * WALL

  // board on the north wall (top) or the west wall (left); the one that shrinks less wins, then more rows
  const floorW = PLANT + cols * CW + EAST
  const topFixed = MT + MB + 2 * WALL + boardHeight(0) + 12 + FB
  const topS = Math.min(1, W / (frame + 28 + floorW), H / (topFixed + BOARD_ROW * lines(H, topFixed)))
  const topLines = lines(H / topS, topFixed)
  const leftFixed = MT + MB + 2 * WALL + 8 + boardHeight(0)
  const leftS = Math.min(1, W / (frame + BW + 28 + floorW), H / (MT + MB + 2 * WALL + FB))
  const leftLines = lines(H / leftS, leftFixed)
  const left = leftS > topS + 0.01 || (leftS >= topS - 0.01 && topLines < need && leftLines > topLines)
  const s = left ? leftS : topS, fit = left ? leftLines : topLines
  const LW = W / s, LH = H / s

  // room interior
  const ix0 = MX + WALL, iy0 = MT + WALL, ix1 = LW - MX - WALL, iy1 = LH - MB - WALL
  const bh = boardHeight(fit), wantSheet = !narrow && d.knowledge.length > 0
  let bw: number, bX: number, bY: number, fx0: number, fy0: number
  if (left) { bw = BW; bX = ix0 + 8; bY = iy0 + 8; fx0 = ix0 + BW + 28; fy0 = iy0 }
  else { bw = Math.max(300, Math.min(600, ix1 - ix0 - 28 - (wantSheet ? 186 : 0))); bX = ix0 + 14; bY = iy0 - 1; fx0 = ix0; fy0 = iy0 + bh + 12 }
  const board = el(stage, 'ofc-board ofc-hang', boardHTML(d, fit) + '<div class="ofc-tray"></div>', { left: bX, top: bY, width: bw })
  board.dataset.fit = String(fit)
  if (wantSheet) {
    const sx = left ? bX + 10 : bX + bw + 22, sy = left ? bY + bh + 22 : iy0 + 10
    if (left ? iy1 - sy > 90 : sx + 156 <= ix1 - 8) el(stage, 'ofc-sheet', sheetHTML(d.knowledge), { left: sx, top: sy, width: 150 }).style.maxHeight = `${left ? iy1 - sy - 8 : bh - 14}px`
  }

  // rows either side of the aisle; spare height widens the aisle first
  const FH = iy1 - fy0, e = Math.max(0, FH - FB), g = Math.min(e, 100) / 2, pad = (e - 2 * g) / 2, y = fy0 + pad
  const Y = { tagA: y + 2, deskA: y + 63, chairA: y + 99, aisle: y + 139 + g, chairB: y + 179 + 2 * g, deskB: y + 215 + 2 * g, tagB: y + 238 + 2 * g }
  const colW = (ix1 - fx0 - PLANT - EAST) / cols
  const rowA = (i: number) => i < cols
  const cx = (i: number) => fx0 + PLANT + colW * ((rowA(i) ? i : i - cols) + 0.5)
  const homes: P[] = d.people.map((_, i) => ({ x: cx(i), y: rowA(i) ? Y.chairA : Y.chairB }))

  let svg = `<svg class="ofc-shell" width="${LW}" height="${LH}"><defs><pattern id="ofc-grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0 H0 V44" fill="none" stroke="#2a2a2a"/></pattern></defs>` +
    `<rect x="${MX + WALL / 2}" y="${MT + WALL / 2}" width="${LW - 2 * MX - WALL}" height="${LH - MT - MB - WALL}" fill="#242424" stroke="#3a3a3a" stroke-width="${WALL}"/>` +
    `<rect x="${fx0}" y="${fy0}" width="${ix1 - fx0}" height="${iy1 - fy0}" fill="url(#ofc-grid)"/>` +
    `<rect x="${fx0 + PLANT / 2}" y="${Y.aisle - 17}" width="${LW - MX - fx0 - PLANT / 2}" height="34" fill="#2b2926"/>` +
    `<path d="M${fx0 + PLANT / 2} ${Y.aisle - 17} H${ix1} M${fx0 + PLANT / 2} ${Y.aisle + 17} H${ix1}" stroke="#3a3632" stroke-dasharray="4 3"/>` +
    // door gap in the east wall at the end of the aisle
    `<rect x="${ix1 - 1}" y="${Y.aisle - 26}" width="${WALL + 2}" height="52" fill="#242424"/>` +
    `<path d="M${ix1 + WALL} ${Y.aisle - 26} A40 40 0 0 0 ${ix1 + WALL - 38} ${Y.aisle + 14}" fill="none" stroke="#4a4a4a" stroke-dasharray="3 3"/>` +
    `<line x1="${ix1 + WALL}" y1="${Y.aisle - 26}" x2="${ix1 + WALL - 38}" y2="${Y.aisle - 26}" stroke="#5a5a5a" stroke-width="3"/>`
  // a plant at the west end of the aisle
  const px = fx0 + 22, py = Y.aisle
  svg += `<g transform="translate(${px} ${py})"><circle r="9" fill="#3b3631"/><g fill="#4f7a45"><ellipse cx="-7" cy="-4" rx="8" ry="4" transform="rotate(-30 -7 -4)"/><ellipse cx="7" cy="-5" rx="8" ry="4" transform="rotate(35 7 -5)"/><ellipse cx="0" cy="8" rx="4" ry="8"/><ellipse cx="-6" cy="6" rx="7" ry="3.6" transform="rotate(40 -6 6)"/></g><g fill="#5f8f52"><ellipse cx="5" cy="5" rx="7" ry="3.4" transform="rotate(-40 5 5)"/><ellipse cx="0" cy="-8" rx="3.4" ry="7"/></g></g>`
  homes.forEach((h, i) => {
    const back = rowA(i) ? h.y + 12 : h.y - 18
    svg += `<rect x="${h.x - 14}" y="${h.y - 14}" width="28" height="28" rx="6" fill="#363636" stroke="#2e2e2e" stroke-width="2"/><rect x="${h.x - 13}" y="${back}" width="26" height="6" rx="2" fill="#404040"/>`
  })
  svg += '</svg>'
  stage.insertAdjacentHTML('afterbegin', svg)

  d.people.forEach((p, i) => {
    const a = rowA(i)
    const desk = el(stage, `ofc-pdesk${a ? '' : ' b'}`, topDesk(i), { left: cx(i), top: a ? Y.deskA : Y.deskB })
    desk.dataset.open = String(i)
    const tag = el(stage, 'ofc-plate ofc-tag', plateHTML(p, i), { left: cx(i) - (colW - 12) / 2, top: a ? Y.tagA : Y.tagB, width: colW - 12 })
    tag.dataset.open = String(i)
    tag.title = plateTitle(p)
  })

  return {
    s, LW, LH,
    geo: {
      homes,
      route(a, b) {
        const A = homes[a], T = homes[b], V = { x: T.x + VISIT, y: T.y }
        return [A, { x: A.x, y: Y.aisle }, { x: V.x, y: Y.aisle }, V]
      },
      face(fig, dx, dy) {
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return
        let target = (Math.atan2(dy, dx) * 180) / Math.PI + 90
        const cur = parseFloat(fig.dataset.rot || '0')
        while (target - cur > 180) target -= 360
        while (target - cur < -180) target += 360
        fig.dataset.rot = String(target)
        fig.style.setProperty('--rot', `${target}deg`)
      },
      homeFace: (i) => (rowA(i) ? [0, -1] : [0, 1]),
      figure: (p) => topFigure(p.look),
    },
  }
}
