// Figures and desks for the office scene, as SVG strings. Looks come from officeCore.lookOf: the role picks the
// props (clipboard, hard hat, glasses and magnifier, lab coat and flask, headset), the shirt tells people apart.
// The side figure faces right with its feet at the origin; the plan figure is seen from above, facing up.
import type { Look } from '../../../shared/officeCore'

const COAT = '#dcdad3'

export function sideFigure(L: Look): string {
  const coat = L.kind === 'validator'
  const body = coat ? COAT : L.shirt, arm = coat ? '#b2b0a8' : L.dark
  let head = `<g class="o-head"><rect x="16" y="18" width="5" height="5" fill="${L.skin}"/><circle cx="19" cy="12.5" r="8" fill="${L.skin}"/>` +
    `<path d="M26.6 11.5 l2.2 2.4 -2.4 .8 z" fill="${L.skin}"/><rect x="22.6" y="10.6" width="1.8" height="2.2" rx=".8" fill="#1b1b1b"/>`
  if (L.hat) head += `<path d="M10.5 11 Q11 3 19.5 3 Q27 3 27.5 10 Z" fill="${L.hat}"/><rect x="9.5" y="9.4" width="22" height="2.4" rx="1.1" fill="${L.hat}"/><path d="M15 3.6 Q19 2 23.5 4" fill="none" stroke="rgba(0,0,0,.15)" stroke-width="1.4"/>`
  else head += `<path d="M11 15 Q9.5 4.5 19 4.2 Q26.5 4 27 9 Q21 8 19 10 Q17.5 14 16 17 Z" fill="${L.hair}"/>`
  if (L.kind === 'reviewer') head += '<circle cx="24" cy="12" r="2.6" fill="none" stroke="#1e1e1e" stroke-width="1"/><path d="M21.4 11.6 h-6" stroke="#1e1e1e" stroke-width=".9"/>'
  if (L.kind === 'qa') head += '<path d="M12.5 12 Q12 3.5 19.5 3.6 Q25 4 25.5 9" fill="none" stroke="#151515" stroke-width="1.8"/><rect x="14" y="10" width="4.5" height="6" rx="1.8" fill="#151515"/><path d="M17 15 Q20 19.5 25.5 17.5" fill="none" stroke="#151515" stroke-width="1.2"/>'
  head += '</g>'
  const torso = `<path d="M13 27 Q13 21.5 18 21.5 H21 Q26 21.5 26 27 V${coat ? 49 : 45} H13 Z" fill="${body}"/>` +
    (coat ? `<path d="M19.5 22 h4 v12 h-4 z" fill="${L.shirt}"/><path d="M22 23 v26" stroke="#9f9d95" stroke-width="1"/>` : '') +
    (L.kind === 'builder' ? '<path d="M13 33 h13 M13 38 h13" stroke="#efe3a3" stroke-width="1.6" opacity=".85"/>' : '')
  let prop = ''
  if (L.kind === 'lead') prop = '<rect x="22" y="33" width="9" height="12" rx="1" fill="#d9d3c3" transform="rotate(-12 26 39)"/><rect x="24.5" y="32" width="4" height="2.2" fill="#6d6d6d" transform="rotate(-12 26 39)"/>'
  if (L.kind === 'reviewer') prop = '<circle cx="29" cy="37" r="3.6" fill="#9cc3d6" fill-opacity=".35" stroke="#cfcfcf" stroke-width="1.4"/><path d="M26.5 39.5 l-2.5 3" stroke="#6b4b2f" stroke-width="2" stroke-linecap="round"/>'
  if (L.kind === 'validator') prop = '<path d="M25.5 32 h3.4 v4 l3.4 6.5 h-10.2 l3.4 -6.5 z" fill="#eef4f2" fill-opacity=".9"/><path d="M23 39 h8.4 l1.2 3 h-10.8 z" fill="#58b7a7"/>'
  const leg = (cls: string, shade: string) => `<g class="o-limb ${cls}"><rect x="16" y="44" width="6" height="18" rx="2" fill="${shade}"/><rect x="16" y="60" width="10" height="4" rx="1.6" fill="#161616"/></g>`
  const armG = (cls: string) => `<g class="o-limb ${cls}"><rect x="16.5" y="23" width="5.5" height="18" rx="2.6" fill="${arm}"/><circle cx="19.2" cy="41.5" r="2.6" fill="${L.skin}"/></g>`
  const stand = `<g class="o-stand"><g class="o-upper">${armG('o-ab')}</g>${leg('o-lb', '#1d1d20')}${leg('o-lf', L.legs)}` +
    `<g class="o-upper">${torso}${head}${armG('o-af')}${prop}</g></g>`
  const sit = `<g class="o-sit"><g transform="translate(0 2)">` +
    `<rect x="15" y="41.5" width="17" height="6" rx="2.6" fill="${L.legs}"/><rect x="26.5" y="44" width="5.5" height="17" rx="2" fill="${L.legs}"/><rect x="26.5" y="58" width="10" height="4" rx="1.6" fill="#161616"/>` +
    `<g class="o-upper">${torso}${head}<rect x="16.5" y="23" width="5.5" height="13" rx="2.6" fill="${arm}"/>` +
    `<g class="o-fore"><rect x="17" y="31.5" width="15" height="5" rx="2.4" fill="${arm}"/><circle cx="33" cy="34" r="2.6" fill="${L.skin}"/></g>` +
    '</g></g></g>'
  return `<svg width="45" height="80" viewBox="0 0 36 64">${stand}${sit}</svg>`
}

// origin at the seated figure's feet; desk to the left, chair under them; the monitor glows in the owner's state
export function sideDesk(i: number): string {
  return '<svg width="1" height="1">' +
    '<rect x="-74" y="-40" width="56" height="4.5" rx="1" fill="#6a5340"/>' +
    '<rect x="-71" y="-36" width="3.5" height="36" fill="#4a3a2c"/><rect x="-25" y="-36" width="3.5" height="36" fill="#4a3a2c"/>' +
    '<rect x="-70" y="-36" width="16" height="22" fill="#3f3226"/><rect x="-68" y="-31" width="12" height="1.4" fill="#5a4838"/><rect x="-68" y="-23" width="12" height="1.4" fill="#5a4838"/>' +
    '<rect x="-60" y="-45" width="5" height="5" fill="#2a2a2a"/><rect x="-64" y="-41.5" width="13" height="2" fill="#2a2a2a"/>' +
    '<rect x="-63" y="-74" width="7" height="31" rx="1" fill="#1b1b1b" transform="skewY(-8)"/>' +
    `<rect class="ofc-scr" data-who="${i}" x="-56.5" y="-72" width="3" height="27" fill="currentColor" transform="skewY(-8)"/>` +
    '<rect x="-44" y="-42.5" width="15" height="2.4" rx="1" fill="#2c2c2c"/>' +
    '<rect x="-35" y="-48" width="6" height="7.5" rx="1.2" fill="#d9d4c7"/>' +
    '<rect x="-6" y="-29" width="20" height="4" rx="1.5" fill="#3b3b3b"/><rect x="10" y="-58" width="4" height="31" rx="1.5" fill="#3b3b3b"/>' +
    '<rect x="1.5" y="-25" width="3" height="18" fill="#2a2a2a"/><rect x="-6" y="-6" width="18" height="2.5" rx="1" fill="#2a2a2a"/><circle cx="-5" cy="-2" r="2" fill="#222"/><circle cx="11" cy="-2" r="2" fill="#222"/>' +
    '</svg>'
}

function topProp(L: Look): string {
  switch (L.kind) {
    case 'lead': return '<rect x="7" y="-15" width="9" height="11" rx="1" fill="#d9d3c3" transform="rotate(12 11 -9)"/><rect x="9.5" y="-16" width="4" height="2.4" fill="#6d6d6d" transform="rotate(12 11 -9)"/>'
    case 'reviewer': return '<circle cx="-11" cy="-12" r="4.2" fill="#1b1b1b" fill-opacity=".35" stroke="#cfcfcf" stroke-width="1.6"/><line x1="-8" y1="-9" x2="-5" y2="-5" stroke="#6b4b2f" stroke-width="2.2" stroke-linecap="round"/>'
    case 'validator': return '<path d="M9 -17 h4 v4 l4 7 h-12 l4 -7 z" fill="#e8f1ef" fill-opacity=".9"/><path d="M6.3 -8 h11.4 l1.2 2 h-13.8 z" fill="#58b7a7"/>'
    case 'qa': return '<rect x="8" y="-14" width="7" height="10" rx="3.5" fill="#2a2a2a" stroke="#4d4d4d"/><line x1="11.5" y1="-14" x2="11.5" y2="-10" stroke="#4d4d4d"/>'
    default: return ''
  }
}

function topHead(L: Look): string {
  if (L.hat) return `<circle cx="0" cy="-1" r="8.6" fill="${L.hat}"/><path d="M-8 -1 h16" stroke="rgba(0,0,0,.18)" stroke-width="1.4"/><ellipse cx="0" cy="-9.4" rx="5" ry="1.8" fill="${L.hat}" stroke="rgba(0,0,0,.15)"/>`
  let s = `<circle cx="0" cy="0" r="7" fill="${L.hair}"/><ellipse cx="0" cy="-5" rx="4.6" ry="2.4" fill="${L.skin}"/>`
  if (L.kind === 'qa') s += '<path d="M-7.5 1 A7.5 7.5 0 0 1 7.5 1" fill="none" stroke="#151515" stroke-width="1.8"/><circle cx="-7.6" cy="1" r="2" fill="#151515"/><circle cx="7.6" cy="1" r="2" fill="#151515"/><path d="M-7.6 1 Q-8 -6 -3 -8" fill="none" stroke="#151515" stroke-width="1.2"/>'
  if (L.kind === 'reviewer') s += '<path d="M-4 -7.2 h8" stroke="#2a2a2a" stroke-width="1"/>'
  return s
}

export function topFigure(L: Look): string {
  const coat = L.kind === 'validator'
  const arm = coat ? '#a9a79f' : L.dark
  return '<svg width="44" height="44" viewBox="-22 -22 44 44">' +
    '<g class="o-feet"><ellipse class="o-fl" cx="-5" cy="-9" rx="3" ry="4.4" fill="#1a1a1a"/><ellipse class="o-fr" cx="5" cy="-9" rx="3" ry="4.4" fill="#1a1a1a"/></g>' +
    '<g class="o-body">' +
    `<g class="o-hands"><circle class="o-hl" cx="-6" cy="-10.5" r="2.6" fill="${L.skin}"/><circle class="o-hr" cx="6" cy="-10.5" r="2.6" fill="${L.skin}"/></g>` +
    `<ellipse class="o-al" cx="-12.4" cy="0.5" rx="3.6" ry="5.2" fill="${arm}"/><ellipse class="o-ar" cx="12.4" cy="0.5" rx="3.6" ry="5.2" fill="${arm}"/>` +
    `<ellipse cx="0" cy="1.5" rx="12.5" ry="7.5" fill="${coat ? COAT : L.shirt}"/>` +
    (coat ? `<path d="M-2.5 -5 h5 v12 h-5 z" fill="${L.shirt}"/>` : '') +
    (L.kind === 'builder' ? '<path d="M-11 3 h22" stroke="#e8e0a0" stroke-width="1.6" opacity=".8"/>' : '') +
    topHead(L) + topProp(L) + '</g></svg>'
}

// 88 x 42, monitor edge at the top; rotated 180 degrees for the row across the aisle
export function topDesk(i: number): string {
  return '<svg viewBox="0 0 88 42" width="88" height="42"><rect x="1" y="1" width="86" height="40" rx="1.5" fill="#5a4533" stroke="#3b2d21" stroke-width="2"/>' +
    '<rect x="2" y="2" width="84" height="5" fill="#64503c"/>' +
    `<rect class="ofc-glow" data-who="${i}" x="22" y="10" width="44" height="7" fill="currentColor"/>` +
    '<rect x="24" y="4" width="40" height="6" rx="1" fill="#161616"/><rect x="40" y="10" width="8" height="3" fill="#161616"/>' +
    '<rect x="29" y="25" width="30" height="8" rx="1" fill="#2a2a2a"/><rect x="31" y="27" width="26" height="1.4" fill="#3d3d3d"/><rect x="31" y="30" width="26" height="1.4" fill="#3d3d3d"/>' +
    '<rect x="63" y="26" width="6" height="8" rx="3" fill="#2a2a2a"/>' +
    '<circle cx="11" cy="15" r="4.4" fill="#d9d4c7"/><circle cx="11" cy="15" r="3" fill="#3b2617"/>' +
    '<rect x="6" y="23" width="13" height="15" fill="#cfcabd" transform="rotate(-9 12 30)"/><rect x="8" y="26" width="8" height="1.2" fill="#9d978b" transform="rotate(-9 12 30)"/>' +
    '</svg>'
}
