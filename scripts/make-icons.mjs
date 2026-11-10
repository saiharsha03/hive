// Generates the Hive app icon: the mark the window's title bar draws (a hexagon, one cell of the hive, holding an H
// whose bar is in the accent) on a dark rounded square. Writes the SVG sources, PNGs for every size and a multi-size ICO.
//   node scripts/make-icons.mjs
// Sizes up to 32 px use heavier strokes and less margin so the shape still reads in a taskbar or tab.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'build')
const SIZE = 1024
const BG = '#16171A'
const INK = '#ECEAE5'
const ACCENT = '#5FA8F5' // the Quiet theme's accent

// the mark on a 24 x 24 grid (the same paths as HiveMark.tsx), scaled into the square with `pad` px of margin
const mark = (pad, w) => {
  const k = (SIZE - 2 * pad) / 24
  return `<rect width="${SIZE}" height="${SIZE}" rx="224" fill="${BG}"/>
  <g transform="translate(${pad} ${pad}) scale(${k})" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z" stroke="${INK}" stroke-width="${w}"/>
    <path d="M8.6 8.2v7.6M15.4 8.2v7.6" stroke="${INK}" stroke-width="${w}"/>
    <path d="M8.6 12h6.8" stroke="${ACCENT}" stroke-width="${w * 1.1}"/>
  </g>`
}
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  ${body}
</svg>
`
const full = svg(mark(150, 1.7))
const small = svg(mark(70, 2.3))

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
