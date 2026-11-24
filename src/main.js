// main.js — desktop, taskbar, app wiring
(function (G) {
'use strict';
const { h, I, WM, msgBox, showMenu } = G;
const FLASH_KEY = 'mappsim.flash.v1';

const events = {
  map: {},
  on(n, f) { (this.map[n] = this.map[n] || []).push(f); },
  emit(n, d) { for (const f of this.map[n] || []) try { f(d); } catch (e) { console.error(e); } },
};

const App = {
  vfs: null, events, machine: null, flashImage: null, flashSnap: null, flashInfo: '',
  compileSnapshot(snap) {
    const incl = snap.incl || {};
    const fs = {
      resolveInclude(name, from) {
        for (const d of [VFS.dirname(from), VFS.dirname(snap.project || from)]) {
          const p = VFS.resolve(d, name);
          for (const k in incl) if (VFS.same(k, p)) return { path: VFS.norm(p), text: incl[k], display: VFS.basename(p) };
        }
        return null;
      }
    };
    const r = G.MappCompiler.buildProgram(snap.sources, fs);
    if (!r.ok) { console.warn('snapshot compile failed', r); return null; }
    return { factory: r.factory };
  },
  describe(snap) {
    const names = snap.sources.map(s => s.name);
    const main = names.find(n => !/_utilities\.cpp$/i.test(n)) || names[0] || 'program';
    const d = new Date(snap.time);
    return main + (names.length > 1 ? ' (+' + (names.length - 1) + ')' : '') + '  \u2022  downloaded ' + [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':');
  },
  flash(img, snap) {
    this.flashImage = img; this.flashSnap = snap; this.flashInfo = this.describe(Object.assign({}, snap, { time: Date.now() }));
    this.machine.load(img); this.machine.powerOn();
    try { localStorage.setItem(FLASH_KEY, JSON.stringify(Object.assign({}, snap, { flashedAt: Date.now() }))); } catch (e) { }
    events.emit('flash');
  },
  eraseFlash() {
    this.flashImage = null; this.flashSnap = null; this.flashInfo = '';
    this.machine.load(null); this.machine.erase();
    try { localStorage.setItem(FLASH_KEY, 'null'); } catch (e) { }
    events.emit('flash');
  },
  resetBoard() { this.machine.powerOn(); },
  powerChanged(on) {
    if (on) this.machine.powerOn();
    else { this.machine.image && this.machine.powerOn(); this.machine.state = 'off'; }
  },
  openCoach(tab) { G.Coach.open(tab); },
  async resetLab() {
    const r = await msgBox('MAPP', 'Restore fresh copies of all MAPP Programs?\n\nThis deletes every change you made under D:\\MAPP Programs (and any copied Lab folders), exactly like the MAPP icon on the lab PCs.', 'warn', 'yesno');
    if (r !== 'yes') return;
    if (G.UV.w) { G.UV.tabs.slice().forEach(t => { t.saved = t.ed.value; }); await G.UV.closeProject(); }
    for (const w of [...WM.wins.values()]) if (w.id.startsWith('np:')) w.close(true);
    G.seedVFS(this.vfs);
    try { Object.keys(localStorage).filter(k => k.startsWith('mappsim.uv.')).forEach(k => localStorage.removeItem(k)); } catch (e) { }
    this.vfs.changed('D:\\MAPP Programs', 'write');
    G.toast('Fresh copies of MAPP Programs restored');
  },
};

function bootFlash() {
  let snap = null;
  try { snap = JSON.parse(localStorage.getItem(FLASH_KEY) || 'undefined'); } catch (e) { snap = undefined; }
  if (snap === null) { App.machine.erase(); return; }
  if (!snap) {
    // factory board: the template LED blinky (main.cpp) is pre-loaded
    const p = 'D:\\MAPP Programs\\NUCLEO_F103RB\\main.cpp';
    const text = App.vfs.read(p) || (G.MAPP_FILES && G.MAPP_FILES['NUCLEO_F103RB\\main.cpp']) || '';
    snap = { mappsim: 1, time: Date.now(), project: 'D:\\MAPP Programs\\NUCLEO_F103RB\\NUCLEO_F103RB.uvprojx', sources: [{ path: p, name: 'main.cpp', text }], incl: {} };
  }
  const img = App.compileSnapshot(snap);
  if (img) { App.flashImage = img; App.flashSnap = snap; App.flashInfo = App.describe(Object.assign({}, snap, { time: snap.flashedAt || snap.time })); App.machine.load(img); App.machine.powerOn(); }
  else App.machine.erase();
}

function desktop() {
  const desk = h('div#desk');
  const bar = h('div#taskbar');
  const tasks = h('div.tb-tasks');
  const clock = h('div.tb-clock');
  const start = h('button.tb-start', { title: 'Start', html: I.win.replace(/width="16" height="16"/, 'width="22" height="22"') });
  bar.append(start, tasks, clock);
  document.body.append(desk, bar);
  WM.init(desk, tasks);
  const apps = [
    { name: 'This PC', icon: I.pc, run: () => G.openExplorer('C:') },
    { name: 'MAPP Programs', icon: I.folder, run: () => G.openExplorer('D:\\MAPP Programs') },
    { name: 'Keil uVision5', icon: I.uvision, run: () => G.UV.show() },
    { name: 'MAPP Board', icon: I.board, run: () => G.Board.open() },
    { name: 'Tera Term', icon: I.term, run: () => G.TeraTerm.open() },
    { name: 'Lab Test Practice', icon: I.lab, run: () => G.Coach.open() },
    { name: 'MAPP', icon: I.mapp, run: () => App.resetLab(), title: 'Restore fresh copies of MAPP Programs (like the lab PCs)' },
  ];
  const icons = h('div.desk-icons');
  apps.forEach(a => {
    const el = h('div.dicon', { title: a.title || a.name, tabindex: 0 }, h('div.dicon-img', { html: a.icon.replace(/width="16" height="16"/, 'width="40" height="40"') }), h('div.dicon-l', { text: a.name }));
    el.addEventListener('dblclick', a.run);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') a.run(); });
    el.addEventListener('click', () => { icons.querySelectorAll('.dicon.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); });
    icons.append(el);
  });
  desk.append(icons);
  desk.addEventListener('mousedown', e => { if (e.target === desk) icons.querySelectorAll('.dicon.sel').forEach(x => x.classList.remove('sel')); });
  start.addEventListener('pointerdown', e => {
    e.stopPropagation();
    const r = start.getBoundingClientRect();
    showMenu(r.left, r.top, apps.map(a => ({ label: a.name, icon: a.icon, action: a.run })).concat(['-', { label: 'File Explorer', icon: I.explorer, action: () => G.openExplorer('D:\\MAPP Programs') }]), { flipY: r.top });
  });
  const tick = () => { const d = new Date(); let hh = d.getHours(); const ap = hh >= 12 ? 'pm' : 'am'; hh = hh % 12 || 12; clock.innerHTML = hh + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap + '<br>' + d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); };
  tick(); setInterval(tick, 10000);
}

function boot() {
  App.vfs = new VFS();
  if (!App.vfs.load() || !App.vfs.exists('D:\\MAPP Programs')) G.seedVFS(App.vfs);
  G.App = App;
  App.machine = new G.MappRuntime.Machine();
  App.machine.serialListeners.push(s => G.TeraTerm.write(s));
  desktop();
  bootFlash();
  G.Board.init(App.machine);
  App.vfs.onChange((p, kind) => { if (kind === 'write') G.UV.extChanged && G.UV.extChanged(p); });
  events.on('extwrite', p => G.UV.extChanged(p));
  window.addEventListener('beforeunload', () => { App.vfs.save(); G.UV.saveUiState && G.UV.saveUiState(); });
  // initial layout
  G.Board.open();
  G.Coach.open();
  G.openExplorer('D:\\MAPP Programs');
  window.addEventListener('resize', () => { for (const w of WM.wins.values()) if (w.maximized) { w.el.style.width = WM.desk.clientWidth + 'px'; w.el.style.height = WM.desk.clientHeight + 'px'; } });
}
document.addEventListener('DOMContentLoaded', boot);
G.App = App;
})(window);
