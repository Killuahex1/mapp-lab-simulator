// ui-core.js — DOM helpers, icons, window manager, menus, dialogs, file dialog
(function (G) {
'use strict';

function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const svg = (inner, vb) => '<svg viewBox="' + (vb || '0 0 16 16') + '" width="16" height="16" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
const I = {
  folder: svg('<path d="M1 3.5h5l1.5 1.5H15v8.5H1z" fill="#f4c542" stroke="#c9971c" stroke-width=".7"/><path d="M1 6h14v7.5H1z" fill="#ffd86b"/>'),
  folderOpen: svg('<path d="M1 3.5h5l1.5 1.5H14v2H4L1 13z" fill="#e8b830"/><path d="M3.5 7H16l-3 6.5H1z" fill="#ffd86b" stroke="#c9971c" stroke-width=".6"/>'),
  file: svg('<path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#8a8a8a" stroke-width=".8"/><path d="M10 1v3h3" fill="none" stroke="#8a8a8a" stroke-width=".8"/>'),
  cpp: svg('<path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#6f7f9a" stroke-width=".8"/><path d="M10 1v3h3" fill="none" stroke="#6f7f9a" stroke-width=".8"/><text x="8" y="12.5" font-size="5.6" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#1f5bb5">C++</text>'),
  c: svg('<path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#6f7f9a" stroke-width=".8"/><text x="8" y="12.5" font-size="7" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#1f5bb5">C</text>'),
  hfile: svg('<path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#6f7f9a" stroke-width=".8"/><path d="M10 1v3h3" fill="none" stroke="#6f7f9a" stroke-width=".8"/><text x="8" y="12.5" font-size="7" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#7a3db8">h</text>'),
  txt: svg('<path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#8a8a8a" stroke-width=".8"/><path d="M5 6h6M5 8h6M5 10h6M5 12h4" stroke="#9aa" stroke-width=".8"/>'),
  uvprojx: svg('<rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#2b8a3e"/><path d="M4 4.5v4.2a2.2 2.2 0 004.4 0V4.5M10 4.5l1.6 7 1.6-7" stroke="#fff" stroke-width="1.3" fill="none"/>'),
  uvision: svg('<rect x="1" y="1" width="14" height="14" rx="2.5" fill="#1e7a35"/><path d="M3.6 4v4.6a2.4 2.4 0 004.8 0V4M9.4 4l1.8 8 1.8-8" stroke="#fff" stroke-width="1.4" fill="none"/>'),
  explorer: svg('<path d="M1 3h5.5l1.5 1.5H15V14H1z" fill="#f2b705"/><path d="M1 6h14v8H1z" fill="#ffcf3f"/><rect x="5" y="8" width="6" height="1.4" fill="#4a90d9"/>'),
  board: svg('<rect x="1" y="2" width="14" height="12" rx="1.5" fill="#1f7a43" stroke="#0f4f2a"/><rect x="5" y="5" width="6" height="6" fill="#222"/><g fill="#d8c27a"><rect x="3.4" y="5.5" width="1.2" height=".8"/><rect x="3.4" y="7.5" width="1.2" height=".8"/><rect x="3.4" y="9.5" width="1.2" height=".8"/><rect x="11.4" y="5.5" width="1.2" height=".8"/><rect x="11.4" y="7.5" width="1.2" height=".8"/><rect x="11.4" y="9.5" width="1.2" height=".8"/></g><circle cx="13" cy="4" r="1" fill="#ff3b30"/>'),
  term: svg('<rect x="1" y="2" width="14" height="12" rx="1.5" fill="#22303c"/><path d="M3.5 6l2.5 2-2.5 2" stroke="#7CFC00" stroke-width="1.3" fill="none"/><path d="M7.5 10.5h4" stroke="#ddd" stroke-width="1.2"/>'),
  lab: svg('<rect x="2.5" y="2" width="11" height="13" rx="1.5" fill="#fff" stroke="#5b6b85"/><rect x="5.5" y="1" width="5" height="2.6" rx=".8" fill="#5b6b85"/><path d="M4.5 7.5l1.2 1.2 2-2.2M4.5 11.3l1.2 1.2 2-2.2" stroke="#1a9a4a" stroke-width="1.1" fill="none"/><path d="M9 8h3M9 12h3" stroke="#889" stroke-width="1"/>'),
  reset: svg('<circle cx="8" cy="8" r="7" fill="#e8a317"/><path d="M11.3 8a3.3 3.3 0 1 1-1-2.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M10.9 3.4v2.8H8.1" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  mapp: svg('<rect x="1" y="1" width="14" height="14" rx="3" fill="#c62828"/><text x="8" y="10.6" font-size="5.2" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#fff">MAPP</text>'),
  notepad: svg('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#eaf3ff" stroke="#3b78c4"/><path d="M4.5 5h7M4.5 7.5h7M4.5 10h5" stroke="#3b78c4" stroke-width=".9"/>'),
  pc: svg('<rect x="1.5" y="2.5" width="13" height="8.5" rx="1" fill="#3b8fd9" stroke="#1d5d99"/><path d="M5 14h6M8 11v3" stroke="#555" stroke-width="1.3"/>'),
  drive: svg('<rect x="1" y="5" width="14" height="6.5" rx="1.2" fill="#d5dbe3" stroke="#7a8696"/><rect x="2.5" y="8.6" width="7" height="1.2" fill="#3b8fd9"/><circle cx="12.5" cy="9.2" r=".8" fill="#5c5"/>'),
  home: svg('<path d="M2 8L8 2.5 14 8v6H2z" fill="#4a90d9"/><rect x="6.5" y="10" width="3" height="4" fill="#fff"/>'),
  desktop: svg('<rect x="1.5" y="2.5" width="13" height="9" rx="1" fill="#2f86d6"/><path d="M5.5 14h5" stroke="#555" stroke-width="1.4"/>'),
  docs: svg('<path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#7a8696" stroke-width=".8"/><path d="M5 7h6M5 9h6M5 11h4" stroke="#4a90d9" stroke-width=".9"/>'),
  dl: svg('<path d="M8 2v8M4.5 7L8 10.5 11.5 7" stroke="#2f86d6" stroke-width="1.8" fill="none"/><path d="M2.5 13.5h11" stroke="#2f86d6" stroke-width="1.8"/>'),
  project: svg('<circle cx="5" cy="5" r="3" fill="#d4a018"/><circle cx="11" cy="7" r="3" fill="#3a7bd5"/><circle cx="6" cy="11.5" r="3" fill="#3aa35a"/>'),
  target: svg('<path d="M1 3.5h5l1.5 1.5H15v8.5H1z" fill="#c99a2e"/><path d="M1 6h14v7.5H1z" fill="#e9c46a"/><rect x="6.5" y="7.5" width="5.5" height="4.5" fill="#333"/><path d="M7 7v-1M9 7v-1M11 7v-1M7 12.5v1M9 12.5v1M11 12.5v1" stroke="#999" stroke-width=".7"/>'),
  group: svg('<path d="M1 3.5h5l1.5 1.5H15v8.5H1z" fill="#e0b13e" stroke="#b98a19" stroke-width=".6"/><path d="M1 6h14v7.5H1z" fill="#f5cf5b"/>'),
  groupOpen: svg('<path d="M1 3.5h5l1.5 1.5H14v2H4L1 13z" fill="#d9a72d"/><path d="M3.5 7H16l-3 6.5H1z" fill="#f5cf5b" stroke="#b98a19" stroke-width=".6"/>'),
  // toolbar icons
  tNew: svg('<path d="M3 1.5h6.5l3.5 3.5v9.5H3z" fill="#fff" stroke="#666"/><path d="M9.5 1.5V5H13" fill="none" stroke="#666"/>'),
  tOpen: svg('<path d="M1 3.5h5l1.5 1.5H13v2H4L1 13z" fill="#d9a72d"/><path d="M3.5 7H16l-3 6.5H1z" fill="#f5cf5b" stroke="#b98a19" stroke-width=".6"/>'),
  tSave: svg('<rect x="2" y="2" width="12" height="12" rx="1" fill="#3a6fc1"/><rect x="4.5" y="2" width="7" height="4.5" fill="#fff"/><rect x="4" y="9" width="8" height="5" fill="#dde6f5"/>'),
  tSaveAll: svg('<rect x="4" y="1" width="11" height="11" rx="1" fill="#6d94d6"/><rect x="1" y="4" width="11" height="11" rx="1" fill="#3a6fc1"/><rect x="3.3" y="4" width="6.4" height="4" fill="#fff"/><rect x="3" y="10.5" width="7" height="4" fill="#dde6f5"/>'),
  tCut: svg('<circle cx="4.5" cy="12" r="2.2" fill="none" stroke="#555" stroke-width="1.3"/><circle cx="11.5" cy="12" r="2.2" fill="none" stroke="#555" stroke-width="1.3"/><path d="M5.5 10.3L11.5 1.5M10.5 10.3L4.5 1.5" stroke="#555" stroke-width="1.2"/>'),
  tCopy: svg('<rect x="5" y="1.5" width="9" height="10" fill="#fff" stroke="#555"/><rect x="2" y="4.5" width="9" height="10" fill="#fff" stroke="#555"/>'),
  tPaste: svg('<rect x="2" y="2.5" width="10" height="12" rx="1" fill="#c9a36b" stroke="#8b6a3b"/><rect x="4.5" y="1" width="5" height="3" rx=".7" fill="#777"/><rect x="7" y="7" width="7.5" height="8" fill="#fff" stroke="#555"/>'),
  tUndo: svg('<path d="M5 4L1.5 7.5 5 11" fill="none" stroke="#2a6bd1" stroke-width="1.6"/><path d="M2 7.5h7.5a4 4 0 010 8H7" fill="none" stroke="#2a6bd1" stroke-width="1.6"/>'),
  tRedo: svg('<path d="M11 4l3.5 3.5L11 11" fill="none" stroke="#2a6bd1" stroke-width="1.6"/><path d="M14 7.5H6.5a4 4 0 000 8H9" fill="none" stroke="#2a6bd1" stroke-width="1.6"/>'),
  tBack: svg('<path d="M9.5 3.5L5 8l4.5 4.5M5 8h9" stroke="#999" stroke-width="1.6" fill="none"/>'),
  tFwd: svg('<path d="M6.5 3.5L11 8l-4.5 4.5M11 8H2" stroke="#999" stroke-width="1.6" fill="none"/>'),
  tBm: svg('<path d="M4 1.5h8v13L8 11l-4 3.5z" fill="#3a7bd5"/>'),
  tIndent: svg('<path d="M6 3h9M6 6.5h9M6 10h9M2 13.5h13" stroke="#555" stroke-width="1.2"/><path d="M1.5 4.5l3 2.2-3 2.2z" fill="#2a6bd1"/>'),
  tUnindent: svg('<path d="M6 3h9M6 6.5h9M6 10h9M2 13.5h13" stroke="#555" stroke-width="1.2"/><path d="M4.5 4.5l-3 2.2 3 2.2z" fill="#2a6bd1"/>'),
  tComment: svg('<text x="1" y="12" font-size="10" font-family="Consolas,monospace" font-weight="bold" fill="#1a8a3a">//</text>'),
  tUncomment: svg('<text x="1" y="12" font-size="10" font-family="Consolas,monospace" font-weight="bold" fill="#999">//</text><path d="M1 14L15 2" stroke="#c33" stroke-width="1.2"/>'),
  tFind: svg('<circle cx="6.5" cy="6.5" r="4.2" fill="#e8f1ff" stroke="#555" stroke-width="1.4"/><path d="M9.8 9.8l4.5 4.5" stroke="#555" stroke-width="2"/>'),
  tTranslate: svg('<rect x="2" y="2" width="12" height="12" rx="1" fill="#fff" stroke="#666"/><path d="M4.5 8.5l2.3 2.3 4.7-5.6" stroke="#2a6bd1" stroke-width="1.6" fill="none"/>'),
  tBuild: svg('<rect x="1.5" y="8.5" width="6" height="6" fill="#3a7bd5" stroke="#1e4e9a" stroke-width=".6"/><rect x="8.5" y="8.5" width="6" height="6" fill="#3a7bd5" stroke="#1e4e9a" stroke-width=".6"/><rect x="5" y="2" width="6" height="6" fill="#5ba0f2" stroke="#1e4e9a" stroke-width=".6"/><path d="M12.5 1v4.5M10.3 3.3h4.5" stroke="#c22" stroke-width="1.3"/>'),
  tRebuild: svg('<rect x="1.5" y="8.5" width="6" height="6" fill="#3a7bd5" stroke="#1e4e9a" stroke-width=".6"/><rect x="8.5" y="8.5" width="6" height="6" fill="#3a7bd5" stroke="#1e4e9a" stroke-width=".6"/><rect x="5" y="2" width="6" height="6" fill="#5ba0f2" stroke="#1e4e9a" stroke-width=".6"/><path d="M12.5 1v4.5M10.3 3.3h4.5M3 1v4.5M.8 3.3h4.5" stroke="#c22" stroke-width="1.3"/>'),
  tBatch: svg('<rect x="1" y="9" width="5" height="5" fill="#3a7bd5"/><rect x="6" y="9" width="5" height="5" fill="#3a7bd5"/><rect x="11" y="9" width="4" height="5" fill="#3a7bd5"/><rect x="3.5" y="3.5" width="5" height="5" fill="#5ba0f2"/><rect x="8.5" y="3.5" width="5" height="5" fill="#5ba0f2"/>'),
  tStop: svg('<rect x="1.5" y="8.5" width="6" height="6" fill="#9bb7dd"/><rect x="8.5" y="8.5" width="6" height="6" fill="#9bb7dd"/><circle cx="8" cy="5" r="4" fill="#d33"/><path d="M6 3l4 4M10 3L6 7" stroke="#fff" stroke-width="1.2"/>'),
  tLoad: svg('<rect x="1" y="1" width="14" height="14" rx="1" fill="#fff" stroke="#888"/><text x="8" y="7" font-size="5" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#1e4e9a">LOAD</text><path d="M8 8v5M5.5 10.5L8 13l2.5-2.5" stroke="#1e7a35" stroke-width="1.6" fill="none"/>'),
  tWand: svg('<path d="M2 14L11 5" stroke="#6b4a2b" stroke-width="2.2"/><path d="M11 5l1.6-1.6" stroke="#fff" stroke-width="2.2"/><path d="M12.5 1v3M11 2.5h3M14.5 5.5v2M13.5 6.5h2M9 .8v1.6M8.2 1.6h1.6" stroke="#e2b300" stroke-width="1"/>'),
  tManage: svg('<rect x="1" y="1" width="6" height="6" fill="#e53935"/><rect x="9" y="1" width="6" height="6" fill="#43a047"/><rect x="1" y="9" width="6" height="6" fill="#1e88e5"/><rect x="9" y="9" width="6" height="6" fill="#fdd835"/>'),
  tDebug: svg('<circle cx="7" cy="7" r="5" fill="#e8f1ff" stroke="#1e4e9a" stroke-width="1.4"/><path d="M10.5 10.5L15 15" stroke="#1e4e9a" stroke-width="2"/><text x="7" y="9.5" font-size="7" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#c22">d</text>'),
  tBooks: svg('<rect x="2" y="2" width="4" height="12" fill="#3a7bd5"/><rect x="6.5" y="3" width="3.5" height="11" fill="#43a047"/><rect x="10.5" y="1.5" width="3.5" height="12.5" fill="#e53935"/>'),
  tFunc: svg('<text x="1" y="12" font-size="10" font-family="Consolas,monospace" font-weight="bold" fill="#3a5">{}</text>'),
  tTempl: svg('<text x="0" y="12" font-size="9" font-family="Consolas,monospace" font-weight="bold" fill="#2a6bd1">0\u2192</text>'),
  errX: svg('<circle cx="8" cy="8" r="6.5" fill="#d32f2f"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.8"/>'),
  warnT: svg('<path d="M8 1.5l7 13H1z" fill="#f9a825" stroke="#b87900" stroke-width=".6"/><path d="M8 6v4.2" stroke="#222" stroke-width="1.6"/><circle cx="8" cy="12.3" r=".95" fill="#222"/>'),
  info: svg('<circle cx="8" cy="8" r="7" fill="#1e6fd9"/><path d="M8 7v5" stroke="#fff" stroke-width="1.8"/><circle cx="8" cy="4.5" r="1.1" fill="#fff"/>'),
  question: svg('<circle cx="8" cy="8" r="7" fill="#1e6fd9"/><text x="8" y="12" font-size="10" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#fff">?</text>'),
  ok: svg('<circle cx="8" cy="8" r="7" fill="#1a9a4a"/><path d="M4.5 8.2l2.3 2.3 4.7-5" stroke="#fff" stroke-width="1.8" fill="none"/>'),
  fail: svg('<circle cx="8" cy="8" r="7" fill="#d32f2f"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.8"/>'),
  pending: svg('<circle cx="8" cy="8" r="6.3" fill="none" stroke="#9aa3ad" stroke-width="1.4" stroke-dasharray="2 2"/>'),
  win: svg('<rect x="1" y="1" width="6.6" height="6.6" fill="#1e88e5"/><rect x="8.4" y="1" width="6.6" height="6.6" fill="#1e88e5"/><rect x="1" y="8.4" width="6.6" height="6.6" fill="#1e88e5"/><rect x="8.4" y="8.4" width="6.6" height="6.6" fill="#1e88e5"/>'),
  search: svg('<circle cx="6.5" cy="6.5" r="4.3" fill="none" stroke="#555" stroke-width="1.3"/><path d="M9.8 9.8L14 14" stroke="#555" stroke-width="1.5"/>'),
};
function fileIcon(name, isDir) {
  if (isDir) return I.folder;
  const e = (name.split('.').pop() || '').toLowerCase();
  if (name.indexOf('.') < 0) return I.file;
  if (e === 'cpp' || e === 'cc' || e === 'cxx') return I.cpp;
  if (e === 'c') return I.c;
  if (e === 'h' || e === 'hpp') return I.hfile;
  if (e === 'uvprojx' || e === 'uvoptx' || e === 'uvguix') return I.uvprojx;
  if (['txt', 'md', 'json', 'lib', 'mbed', 'html', 'htm', 'log', 'dep', 'map', 'hex', 'dbgconf'].includes(e)) return I.txt;
  return I.file;
}
function fileTypeName(name, isDir) {
  if (isDir) return 'File folder';
  const e = (name.split('.').pop() || '').toLowerCase();
  if (name.indexOf('.') < 0) return 'File';
  return ({ cpp: 'C++ Source File', c: 'C Source File', h: 'C/C++ Header', uvprojx: '\u00b5Vision5 Project', uvoptx: 'UVOPTX File', uvguix: 'UVGUIX File', txt: 'Text Document', md: 'Markdown Source File', json: 'JSON File', html: 'Chrome HTML Document', htm: 'Chrome HTML Document', lib: 'Object File Library', axf: 'AXF File', hex: 'HEX File', map: 'Linker Address Map', dep: 'DEP File', o: 'Object File', d: 'D File' }[e] || (e.toUpperCase() + ' File'));
}
function fmtDate(t) {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  let hh = d.getHours(); const ap = hh >= 12 ? 'pm' : 'am'; hh = hh % 12 || 12;
  return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + hh + ':' + p(d.getMinutes()) + ' ' + ap;
}
function fmtSize(n) { return n == null ? '' : Math.max(1, Math.ceil(n / 1024)).toLocaleString() + ' KB'; }

/* ================= Window manager ================= */
const WM = {
  wins: new Map(), z: 100, desk: null, bar: null, active: null,
  init(desk, bar) { this.desk = desk; this.bar = bar; },
  get(id) { return this.wins.get(id); },
  open(id, o) {
    if (this.wins.has(id)) { const w = this.wins.get(id); w.restore(); w.focus(); return w; }
    const dw = this.desk.clientWidth, dh = this.desk.clientHeight;
    const W = Math.min(o.w || 640, dw - 10), H = Math.min(o.h || 480, dh - 10);
    let x = o.x != null ? o.x : Math.max(5, (dw - W) / 2 + (this.wins.size * 24) % 120), y = o.y != null ? o.y : Math.max(5, (dh - H) / 3 + (this.wins.size * 24) % 120);
    x = Math.max(0, Math.min(x, dw - 120)); y = Math.max(0, Math.min(y, dh - 60));
    const title = h('span.wtitle', { text: o.title || '' });
    const icon = h('span.wicon', { html: o.icon || '' });
    const btnMin = h('button.wbtn.wmin', { title: 'Minimize', html: '<svg width="10" height="10"><path d="M0 5.5h10" stroke="currentColor"/></svg>' });
    const btnMax = h('button.wbtn.wmax', { title: 'Maximize', html: '<svg width="10" height="10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg>' });
    const btnClose = h('button.wbtn.wclose', { title: 'Close', html: '<svg width="10" height="10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg>' });
    const bar = h('div.wbar', null, icon, title, h('span.wspace'), o.noMin ? null : btnMin, o.noMax ? null : btnMax, btnClose);
    const body = h('div.wbody');
    const el = h('div.win' + (o.cls ? '.' + o.cls : ''), { style: { left: x + 'px', top: y + 'px', width: W + 'px', height: H + 'px' } }, bar, body);
    if (!o.noResize) for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) el.append(h('div.rz.rz-' + d, { 'data-d': d }));
    this.desk.append(el);
    const tb = o.noTask ? null : h('button.tbapp', { title: o.title, html: o.icon || '' });
    if (tb) { tb.append(h('span.tbind')); this.bar.append(tb); }
    const w = {
      id, el, body, bar, o, minimized: false, maximized: false, prev: null, tb,
      setTitle(t) { title.textContent = t; if (tb) tb.title = t; },
      focus() {
        if (WM.active && WM.active !== w) WM.active.el.classList.remove('active');
        el.style.zIndex = ++WM.z; el.classList.add('active'); WM.active = w;
        for (const x of WM.wins.values()) x.tb && x.tb.classList.toggle('on', x === w);
        o.onFocus && o.onFocus();
      },
      minimize() { w.minimized = true; el.classList.add('minimized'); if (tb) tb.classList.remove('on'); },
      restore() { if (w.minimized) { w.minimized = false; el.classList.remove('minimized'); } },
      toggleMax() {
        if (w.maximized) { Object.assign(el.style, w.prev); w.maximized = false; el.classList.remove('maxed'); }
        else { w.prev = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height }; Object.assign(el.style, { left: '0px', top: '0px', width: WM.desk.clientWidth + 'px', height: WM.desk.clientHeight + 'px' }); w.maximized = true; el.classList.add('maxed'); }
        o.onResize && o.onResize();
      },
      close(force) {
        if (!force && o.onClose && o.onClose() === false) return;
        el.remove(); if (tb) tb.remove(); WM.wins.delete(id); if (WM.active === w) WM.active = null;
        o.onClosed && o.onClosed();
      }
    };
    btnMin.addEventListener('click', e => { e.stopPropagation(); w.minimize(); });
    btnMax.addEventListener('click', e => { e.stopPropagation(); w.toggleMax(); });
    btnClose.addEventListener('click', e => { e.stopPropagation(); w.close(); });
    bar.addEventListener('dblclick', e => { if (!e.target.closest('.wbtn') && !o.noMax) w.toggleMax(); });
    el.addEventListener('pointerdown', () => w.focus(), true);
    if (tb) tb.addEventListener('click', () => { if (w.minimized) { w.restore(); w.focus(); } else if (WM.active === w) w.minimize(); else w.focus(); });
    // drag
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('.wbtn') || e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
      if (w.maximized) return;
      bar.setPointerCapture(e.pointerId);
      const mv = ev => { el.style.left = Math.max(-el.offsetWidth + 80, Math.min(WM.desk.clientWidth - 80, ox + ev.clientX - sx)) + 'px'; el.style.top = Math.max(0, Math.min(WM.desk.clientHeight - 32, oy + ev.clientY - sy)) + 'px'; };
      const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
    });
    // resize
    el.querySelectorAll('.rz').forEach(r => r.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const d = r.dataset.d, sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop, ow = el.offsetWidth, oh = el.offsetHeight;
      const minW = o.minW || 320, minH = o.minH || 200;
      r.setPointerCapture(e.pointerId);
      const mv = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (d.includes('e')) el.style.width = Math.max(minW, ow + dx) + 'px';
        if (d.includes('s')) el.style.height = Math.max(minH, oh + dy) + 'px';
        if (d.includes('w')) { const nw = Math.max(minW, ow - dx); el.style.width = nw + 'px'; el.style.left = (ox + ow - nw) + 'px'; }
        if (d.includes('n')) { const nh = Math.max(minH, oh - dy); el.style.height = nh + 'px'; el.style.top = Math.max(0, oy + oh - nh) + 'px'; }
        o.onResize && o.onResize();
      };
      const up = () => { r.removeEventListener('pointermove', mv); r.removeEventListener('pointerup', up); };
      r.addEventListener('pointermove', mv); r.addEventListener('pointerup', up);
    }));
    this.wins.set(id, w);
    w.focus();
    return w;
  }
};

/* ================= Menus ================= */
let openMenu = null;
function closeMenus() { if (openMenu) { openMenu.remove(); openMenu = null; } document.querySelectorAll('.mbar-item.open').forEach(x => x.classList.remove('open')); }
function showMenu(x, y, items, opts) {
  closeMenus();
  const m = buildMenu(items);
  document.body.append(m);
  const r = m.getBoundingClientRect();
  if (x + r.width > innerWidth) x = Math.max(0, innerWidth - r.width - 2);
  if (y + r.height > innerHeight) y = Math.max(0, (opts && opts.flipY != null ? opts.flipY : innerHeight) - r.height - 2);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  openMenu = m;
  return m;
}
function buildMenu(items, sub) {
  const m = h('div.menu' + (sub ? '.submenu' : ''));
  for (const it of items) {
    if (!it) continue;
    if (it === '-' || it.sep) { m.append(h('div.msep')); continue; }
    const row = h('div.mitem' + (it.disabled ? '.dis' : ''), null,
      h('span.mchk', { html: it.checked ? '&#10003;' : (it.icon || '') }),
      h('span.mlabel', { text: it.label }),
      h('span.mkey', { text: it.key || '' }),
      h('span.marrow', { html: it.sub ? '&#9656;' : '' }));
    if (it.sub) {
      let sm = null;
      row.addEventListener('mouseenter', () => {
        m.querySelectorAll(':scope > .submenu').forEach(s => s.remove());
        sm = buildMenu(it.sub, true); m.append(sm);
        const rr = row.getBoundingClientRect(), mr = m.getBoundingClientRect();
        sm.style.left = (rr.right - mr.left - 2) + 'px'; sm.style.top = (rr.top - mr.top - 3) + 'px';
      });
    } else {
      row.addEventListener('mouseenter', () => m.querySelectorAll(':scope > .submenu').forEach(s => s.remove()));
      row.addEventListener('click', e => { e.stopPropagation(); if (it.disabled) return; closeMenus(); it.action && setTimeout(() => it.action(), 0); });
    }
    m.append(row);
  }
  m.addEventListener('pointerdown', e => e.stopPropagation());
  m.addEventListener('contextmenu', e => e.preventDefault());
  return m;
}
document.addEventListener('pointerdown', () => closeMenus());
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
// menu bar: [{label, items: fn|[]}]
function menuBar(menus) {
  const bar = h('div.mbar');
  menus.forEach(mn => {
    const it = h('div.mbar-item', { text: mn.label });
    const open = () => {
      closeMenus();
      const r = it.getBoundingClientRect();
      showMenu(r.left, r.bottom, typeof mn.items === 'function' ? mn.items() : mn.items);
      it.classList.add('open');
    };
    it.addEventListener('pointerdown', e => { e.stopPropagation(); if (it.classList.contains('open')) closeMenus(); else open(); });
    it.addEventListener('mouseenter', () => { if (bar.querySelector('.mbar-item.open') && !it.classList.contains('open')) open(); });
    bar.append(it);
  });
  return bar;
}

/* ================= Dialogs ================= */
function modal(o) {
  // o: {title, icon, body(el), buttons:[{label, value, default, cancel}], width, owner}
  return new Promise(res => {
    const shade = h('div.shade');
    const btns = h('div.dlg-btns');
    const done = v => { shade.remove(); dlg.remove(); document.removeEventListener('keydown', key, true); res(v); };
    (o.buttons || [{ label: 'OK', value: true, default: true }]).forEach(b => {
      const bt = h('button.btn' + (b.default ? '.primary' : ''), { text: b.label, onclick: () => { if (b.validate && !b.validate()) return; done(b.value); } });
      if (b.disabled) bt.disabled = true;
      b.el = bt; btns.append(bt);
    });
    const close = h('button.wbtn.wclose', { html: '<svg width="10" height="10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg>', onclick: () => done((o.buttons || []).find(b => b.cancel)?.value ?? null) });
    const dlg = h('div.win.dialog.active', { style: { width: (o.width || 420) + 'px', zIndex: 100000 } },
      h('div.wbar', null, o.titleIcon ? h('span.wicon', { html: o.titleIcon }) : null, h('span.wtitle', { text: o.title || '' }), h('span.wspace'), close),
      h('div.dlg-body', null, o.icon ? h('div.dlg-icon', { html: o.icon.replace(/width="16" height="16"/, 'width="32" height="32"') }) : null, h('div.dlg-content', null, o.body)),
      btns);
    shade.style.zIndex = 99999;
    document.body.append(shade, dlg);
    const r = dlg.getBoundingClientRect();
    dlg.style.left = Math.max(10, (innerWidth - r.width) / 2) + 'px'; dlg.style.top = Math.max(10, (innerHeight - r.height) / 2.6) + 'px';
    const bar = dlg.querySelector('.wbar');
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('.wbtn')) return;
      const sx = e.clientX, sy = e.clientY, ox = dlg.offsetLeft, oy = dlg.offsetTop; bar.setPointerCapture(e.pointerId);
      const mv = ev => { dlg.style.left = ox + ev.clientX - sx + 'px'; dlg.style.top = Math.max(0, oy + ev.clientY - sy) + 'px'; };
      const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
    });
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done((o.buttons || []).find(b => b.cancel)?.value ?? null); }
      if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) { const b = (o.buttons || []).find(b => b.default); if (b && !(b.el && b.el.disabled)) { e.preventDefault(); e.stopPropagation(); if (b.validate && !b.validate()) return; done(b.value); } }
    };
    document.addEventListener('keydown', key, true);
    setTimeout(() => { const f = dlg.querySelector('input,select,textarea') || dlg.querySelector('.btn.primary'); f && f.focus(); if (f && f.select && f.tagName === 'INPUT') f.select(); }, 30);
    o.onOpen && o.onOpen(dlg, done);
  });
}
function msgBox(title, text, kind, buttons) {
  const icon = { warn: I.warnT, error: I.errX, info: I.info, question: I.question }[kind || 'info'];
  const bmap = { ok: [{ label: 'OK', value: 'ok', default: true, cancel: true }], yesno: [{ label: 'Yes', value: 'yes', default: true }, { label: 'No', value: 'no', cancel: true }], okcancel: [{ label: 'OK', value: 'ok', default: true }, { label: 'Cancel', value: 'cancel', cancel: true }], yesnocancel: [{ label: 'Yes', value: 'yes', default: true }, { label: 'No', value: 'no' }, { label: 'Cancel', value: 'cancel', cancel: true }] };
  const body = h('div.msgtext'); String(text).split('\n').forEach((l, i) => { if (i) body.append(h('br')); body.append(l); });
  return modal({ title, icon, body, buttons: bmap[buttons || 'ok'] || buttons, width: 440 });
}
function prompt(title, label, val) {
  const inp = h('input.tin', { value: val || '', style: { width: '100%' } });
  return modal({ title, body: h('div', null, h('div', { style: { marginBottom: '6px' }, text: label }), inp), buttons: [{ label: 'OK', value: 1, default: true }, { label: 'Cancel', value: 0, cancel: true }] }).then(v => v ? inp.value : null);
}

/* ================= Windows file dialog (Open / Add Files) ================= */
// o: {title, startDir, filters:[{label, exts:[..]|null}], filterIndex, okLabel, multi, keepOpen, onOk(paths)->Promise<bool keepOpen>}
function fileDialog(vfs, o) {
  return new Promise(resolve => {
    let dir = o.startDir;
    let fi = o.filterIndex || 0;
    const lookIn = h('select.tin.flook');
    const list = h('div.fd-list');
    const nameIn = h('input.tin.fd-name');
    const typeSel = h('select.tin.fd-type');
    o.filters.forEach((f, i) => typeSel.append(h('option', { value: i, text: f.label })));
    typeSel.value = fi;
    let sel = [];
    const okBtn = h('button.btn.primary', { text: o.okLabel || 'Open' });
    const closeBtn = h('button.btn', { text: o.cancelLabel || 'Cancel' });
    const upBtn = h('button.ibtn', { title: 'Up One Level', html: svg('<path d="M1 3.5h5l1.5 1.5H15v8.5H1z" fill="#f4c542"/><path d="M8 13V7M5.5 9.5L8 7l2.5 2.5" stroke="#1e4e9a" stroke-width="1.5" fill="none"/>') });
    const newBtn = h('button.ibtn', { title: 'Create New Folder', html: svg('<path d="M1 3.5h5l1.5 1.5H15v8.5H1z" fill="#f4c542"/><path d="M12 1v4M10 3h4" stroke="#e2b300" stroke-width="1.3"/>') });
    const side = h('div.fd-side');
    const places = [['Desktop', 'C:\\Users\\Student\\Desktop', I.desktop], ['Documents', 'C:\\Users\\Student\\Documents', I.docs], ['This PC', 'C:', I.pc], ['Local Disk (D:)', 'D:', I.drive], ['MAPP Programs', 'D:\\MAPP Programs', I.folder]];
    places.forEach(([n, p, ic]) => side.append(h('div.fd-place', { onclick: () => nav(p) }, h('span', { html: ic.replace(/width="16" height="16"/, 'width="28" height="28"') }), h('div', { text: n }))));
    const nav = (p) => { dir = VFS.norm(p); sel = []; render(); };
    const matches = (name) => { const f = o.filters[fi]; if (!f || !f.exts) return true; const e = name.split('.').pop().toLowerCase(); return name.includes('.') && f.exts.includes(e); };
    function render() {
      lookIn.innerHTML = '';
      const segs = VFS.split(dir);
      segs.forEach((s, i) => lookIn.append(h('option', { value: segs.slice(0, i + 1).join('\\'), text: '\u00a0'.repeat(i * 3) + (i === 0 ? (s === 'C:' ? 'Local Disk (C:)' : s === 'D:' ? 'Local Disk (D:)' : s) : s) })));
      lookIn.value = segs.join('\\');
      list.innerHTML = '';
      const items = vfs.list(dir).filter(n => n.type === 'dir' || matches(n.name)).sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
      if (!items.length) list.append(h('div.fd-empty', { text: 'No items match your search.' }));
      for (const n of items) {
        const row = h('div.fd-item' + (sel.includes(n.name) ? '.sel' : ''), { title: n.name }, h('span', { html: fileIcon(n.name, n.type === 'dir') }), h('span', { text: n.name }));
        row.addEventListener('click', e => {
          if (n.type === 'dir') { sel = []; nameIn.value = ''; }
          else if (o.multi && (e.ctrlKey || e.shiftKey)) { sel = sel.includes(n.name) ? sel.filter(x => x !== n.name) : sel.concat(n.name); }
          else sel = [n.name];
          nameIn.value = sel.map(s => sel.length > 1 ? '"' + s + '"' : s).join(' ');
          list.querySelectorAll('.fd-item').forEach(x => x.classList.toggle('sel', sel.includes(x.title)));
        });
        row.addEventListener('dblclick', () => { if (n.type === 'dir') nav(VFS.join(dir, n.name)); else { sel = [n.name]; nameIn.value = n.name; accept(); } });
        list.append(row);
      }
    }
    lookIn.addEventListener('change', () => nav(lookIn.value));
    typeSel.addEventListener('change', () => { fi = +typeSel.value; render(); });
    upBtn.addEventListener('click', () => { const s = VFS.split(dir); if (s.length > 1) nav(s.slice(0, -1).join('\\')); });
    newBtn.addEventListener('click', () => { let n = 'New folder', k = 2; while (vfs.exists(VFS.join(dir, n))) n = 'New folder (' + (k++) + ')'; vfs.mkdirp(VFS.join(dir, n)); vfs.changed(VFS.join(dir, n), 'write'); render(); });
    const body = h('div.fd', null,
      h('div.fd-top', null, h('label', { text: 'Look in:' }), lookIn, upBtn, newBtn),
      h('div.fd-mid', null, side, list),
      h('div.fd-bottom', null,
        h('label', { text: 'File name:' }), nameIn, okBtn,
        h('label', { text: 'Files of type:' }), typeSel, closeBtn));
    const shade = h('div.shade', { style: { zIndex: 99999 } });
    const close = h('button.wbtn.wclose', { html: '<svg width="10" height="10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg>' });
    const dlg = h('div.win.dialog.active', { style: { width: '640px', zIndex: 100000 } }, h('div.wbar', null, h('span.wtitle', { text: o.title }), h('span.wspace'), close), body);
    document.body.append(shade, dlg);
    const r = dlg.getBoundingClientRect();
    dlg.style.left = Math.max(10, (innerWidth - r.width) / 2) + 'px'; dlg.style.top = Math.max(10, (innerHeight - r.height) / 3) + 'px';
    const finish = (v) => { shade.remove(); dlg.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    async function accept() {
      let names = sel.slice();
      const typed = nameIn.value.trim();
      if (!names.length && typed) names = typed.match(/"[^"]+"|\S+/g).map(s => s.replace(/"/g, ''));
      if (names.length === 1 && names[0] !== sel[0] && typed) names = [typed.replace(/"/g, '')];
      if (!names.length) return;
      // typed folder path?
      if (names.length === 1) {
        const p = /^[A-Za-z]:/.test(names[0]) ? names[0] : VFS.join(dir, names[0]);
        if (vfs.isDir(p)) { nav(p); nameIn.value = ''; return; }
      }
      const paths = names.map(n => /^[A-Za-z]:/.test(n) ? VFS.norm(n) : VFS.join(dir, n));
      const missing = paths.find(p => !vfs.exists(p));
      if (missing && !o.allowNew) { await msgBox(o.title, VFS.basename(missing) + '\nFile not found.\nCheck the file name and try again.', 'warn'); return; }
      if (o.onOk) { const keep = await o.onOk(paths, dir); if (keep) { sel = []; nameIn.value = ''; render(); return; } }
      finish(paths);
    }
    okBtn.addEventListener('click', accept);
    closeBtn.addEventListener('click', () => finish(null));
    close.addEventListener('click', () => finish(null));
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); accept(); } };
    document.addEventListener('keydown', key, true);
    render();
    setTimeout(() => nameIn.focus(), 30);
  });
}

function toast(text, ms) {
  const t = h('div.toast', { text }); document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, ms || 2600);
}

Object.assign(G, { h, I, svg, WM, showMenu, closeMenus, menuBar, modal, msgBox, prompt, fileDialog, fileIcon, fileTypeName, fmtDate, fmtSize, toast });
})(window);
