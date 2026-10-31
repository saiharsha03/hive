// Generates the Hive app icon: a small honeycomb of flat hexagon cells on a dark rounded square, one cell in the
// app's accent blue (the "active agent"). Writes the SVG sources, PNGs for every size and a multi-size ICO.
//   node scripts/make-icons.mjs
// Sizes up to 32 px use a simpler three-cell cluster so the shape still reads in a taskbar or tab.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'build')
const SIZE = 1024
const BG = '#16181d'
const AMBER = '#f5a524'
const BLUE = '#0078d4' // --accent in the renderer

// a pointy-top hexagon centred on (cx, cy) with circumradius r
function hex(cx, cy, r, fill) {
  const pts = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90)
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`
}

// cells as axial offsets: the centre of a pointy-top neighbour sits `step` away at 0, 60, 120... degrees
function cluster(cells, r, gap, blueIndex) {
  const step = Math.sqrt(3) * r + gap
  const pos = cells.map(([q, s]) => [q * step + s * step * 0.5, s * step * (Math.sqrt(3) / 2)])
  // centre the cluster's bounding box on the canvas
  const xs = pos.map(([x]) => x)
  const ys = pos.map(([, y]) => y)
  const ox = SIZE / 2 - (Math.min(...xs) + Math.max(...xs)) / 2
  const oy = SIZE / 2 - (Math.min(...ys) + Math.max(...ys)) / 2
  return pos.map(([x, y], i) => hex(x + ox, y + oy, r, i === blueIndex ? BLUE : AMBER)).join('\n  ')
}

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="224" fill="${BG}"/>
  ${body}
</svg>
`

// seven cells: the centre and its six neighbours; the top-right one is blue
const full = svg(cluster([[0, 0], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, 1], [0, 1]], 128, 26, 4))
// three cells in a triangle for tiny sizes, bigger and with a wider gap
const small = svg(cluster([[0, 0], [1, 0], [1, -1]], 235, 56, 2))

mkdirSync(join(out, 'icons'), { recursive: true })
writeFileSync(join(out, 'icon.svg'), full)
writeFileSync(join(out, 'icon-small.svg'), small)

const render = (src, size) => new Resvg(src, { fitTo: { mode: 'width', value: size } }).render().asPng()
const pngs = new Map()
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  const png = render(size <= 32 ? small : full, size)
  pngs.set(size, png)
  writeFileSync(join(out, 'icons', `${size}x${size}.png`), png)
}
writeFileSync(join(out, 'icon.png'), pngs.get(512))

// ICO with PNG-encoded entries (supported since Windows Vista): header, one directory entry per size, then the data
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const header = Buffer.alloc(6 + 16 * icoSizes.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(icoSizes.length, 4)
let offset = header.length
icoSizes.forEach((size, i) => {
  const e = 6 + 16 * i
  header.writeUInt8(size === 256 ? 0 : size, e) // 0 means 256
  header.writeUInt8(size === 256 ? 0 : size, e + 1)
  header.writeUInt16LE(1, e + 4) // colour planes
  header.writeUInt16LE(32, e + 6) // bits per pixel
  header.writeUInt32LE(pngs.get(size).length, e + 8)
  header.writeUInt32LE(offset, e + 12)
  offset += pngs.get(size).length
})
writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...icoSizes.map((s) => pngs.get(s))]))
console.log(`icons written to ${out}`)
