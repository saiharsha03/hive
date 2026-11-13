// Generates the Orbit app icon: the mark the window's title bar draws (OrbitMark.tsx: a centre, one orbit, and a body
// on it in the accent) on a dark rounded square. Writes the SVG sources, PNGs for every size and a multi-size ICO.
//   node scripts/make-icons.mjs
// Sizes up to 32 px use the heavier cut and less margin so the shape still reads in a taskbar or tab.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'build')
const SIZE = 1024
const BG = '#14161A'
const INK = '#EDEBE6'
const BODY = '#F28C38' // ember: the app icon cannot follow a theme

// the two cuts of the mark on a 24 x 24 grid (the same shapes as OrbitMark.tsx), scaled into the square with `pad` px of margin
const FULL = `<circle cx="12" cy="12" r="3.3" fill="${INK}"/><path d="M20.341 11.006A8.4 8.4 0 1 1 14.427 3.958" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/><circle cx="18.435" cy="6.601" r="2.8" fill="${BODY}"/>`
const SMALL = `<circle cx="12" cy="12" r="3.7" fill="${INK}"/><path d="M20.199 12.15A8.2 8.2 0 1 1 13.276 3.9" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/><circle cx="18.282" cy="6.729" r="3.3" fill="${BODY}"/>`
const mark = (pad, cut) => `<rect width="${SIZE}" height="${SIZE}" rx="224" fill="${BG}"/>
  <g transform="translate(${pad} ${pad}) scale(${+((SIZE - 2 * pad) / 24).toFixed(3)})">${cut}</g>`
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  ${body}
</svg>
`
const full = svg(mark(150, FULL))
const small = svg(mark(70, SMALL))

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
