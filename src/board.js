// board.js — MAPP Experiment Board window, Tera Term window
(function (G) {
'use strict';
const { h, I, WM, msgBox } = G;
const RT = () => G.MappRuntime;

// 5x8 HD44780-style font, ASCII 0x20..0x7E, 5 column bytes each (bit0 = top row)
const FONT = ('0000000000 00005F0000 0007000700 147F147F14 242A7F2A12 2313086462 3649562050 0008070300 001C224100 0041221C00 2A1C7F1C2A 08083E0808 0080703000 0808080808 0000606000 2010080402 ' +
  '3E5149453E 00427F4000 7249494946 2141494D33 1814127F10 2745454539 3C4A494931 4121110907 3649494936 464949291E 0000140000 0040340000 0008142241 1414141414 0041221408 0201590906 ' +
  '3E415D594E 7C1211127C 7F49494936 3E41414122 7F4141413E 7F49494941 7F09090901 3E41415173 7F0808087F 00417F4100 2040413F01 7F08142241 7F40404040 7F021C027F 7F0408107F 3E4141413E ' +
  '7F09090906 3E4151215E 7F09192946 2649494932 03017F0103 3F4040403F 1F2040201F 3F4038403F 6314081463 0304780403 6159494D43 007F414141 0204081020 004141417F 0402010204 4040404040 ' +
  '0003070800 2054547840 7F28444438 3844444428 384444287F 3854545418 00087E0902 18A4A49C78 7F08040478 00447D4000 2040403D00 7F10284400 00417F4000 7C04780478 7C08040478 3844444438 ' +
  'FC18242418 182424180C 7C08040408 4854545424 04043F4424 3C4040207C 1C2040201C 3C4030403C 4428102844 4C9090907C 4464544C44 0008364100 0000770000 0041360800 0201020402').split(' ');
function glyph(code) {
  if (code >= 0x20 && code <= 0x7E) { const s = FONT[code - 0x20]; return [0, 1, 2, 3, 4].map(i => parseInt(s.substr(i * 2, 2), 16)); }
  if (code === 0xFF) return [255, 255, 255, 255, 255];
  if (code === 0xDF) return [0, 7, 5, 7, 0];
  return [0, 0, 0, 0, 0];
}

const SEG_PATHS = { // 7-seg digit 60x100 viewBox, a..g + dp
  a: 'M14 6 L46 6 L40 13 L20 13 Z', b: 'M48 8 L48 46 L41 41 L42 15 Z', c: 'M48 54 L48 92 L42 85 L41 59 Z', d: 'M14 94 L46 94 L40 87 L20 87 Z',
  e: 'M12 54 L12 92 L18 85 L19 59 Z', f: 'M12 8 L12 46 L19 41 L18 15 Z', g: 'M15 50 L21 46 L39 46 L45 50 L39 54 L21 54 Z' };
const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

const BoardUI = {
  w: null, m: null, usb: true, speed: 1, isBusy: false, muted: false, audio: null, lastFrame: 0, pinsOpen: false,
  connected() { return this.usb; },
  busy(b) { this.isBusy = b; if (b && this.m) { this.m.state = 'programming'; } },
  machine() { return this.m; },
  init(m) {
    this.m = m;
    requestAnimationFrame(t => this.loop(t));
    // keep simulating when the tab is hidden (rAF pauses there)
    setInterval(() => { const now = performance.now(); if (now - (this.lastRaf || 0) > 300) this.step(now, true); }, 100);
  },
  open() {
    if (this.w) { this.w.restore(); this.w.focus(); return; }
    const dw = WM.desk.clientWidth, dh = WM.desk.clientHeight;
    const W = 548;
    this.w = WM.open('board', { title: 'MAPP Experiment Board (STM32 NUCLEO-F103RB)', icon: I.board, w: W, h: Math.min(dh - 12, 990), x: Math.max(0, dw - W - 6), y: 4, cls: 'boardwin', minW: 420, onClosed: () => { this.w = null; } });
    this.render();
  },
  render() {
    const me = this;
    const B = this.m.board;
    // ---- toolbar
    this.stateEl = h('span.bd-state');
    const speedSel = h('select.tin.bd-speed', { title: 'Simulation speed (slow motion lets you see multiplexing)' }, [1, 0.5, 0.25, 0.1, 0.02].map(s => h('option', { value: s, text: s === 1 ? 'Real time (1×)' : s + '× slow-mo' })));
    speedSel.value = this.speed; speedSel.onchange = () => { this.speed = +speedSel.value; };
    const usb = h('label.bd-usb', { title: 'USB cable to the lab PC (ST-LINK)' }, h('input', { type: 'checkbox', checked: this.usb, onchange: e => { this.usb = e.target.checked; this.powerChanged(); } }), ' USB');
    const mute = h('button.bd-tbtn', { title: 'Mute / unmute buzzer', text: this.muted ? '🔇' : '🔊', onclick: e => { this.muted = !this.muted; e.target.textContent = this.muted ? '🔇' : '🔊'; } });
    const toolbar = h('div.bd-toolbar', null, this.stateEl, h('span.wspace'), speedSel, mute, usb);
    // ---- Nucleo board
    this.ld1 = h('div.bd-led.ld1', { title: 'LD1 COM (ST-LINK activity)' });
    this.ld2 = h('div.bd-led.ld2', { title: 'LD2 user LED = PA5 (LED1)' });
    this.ld3 = h('div.bd-led.ld3', { title: 'LD3 PWR' });
    const pbtn = (cls, label, pin, title) => {
      const b = h('div.bd-btn.' + cls, { title: title + '\nClick = press. Right-click = latch (hold down).' });
      let latched = false;
      const set = v => { if (pin === 'RESET') { if (!v) this.reset(); b.classList.toggle('down', v); return; } B.btn[pin] = v ? 0 : 1; this.m.setDrive(); b.classList.toggle('down', v); document.querySelectorAll('.bd-btn[data-pin="' + pin + '"]').forEach(x => x.classList.toggle('down', v)); };
      b.dataset.pin = pin;
      let t0 = 0;
      b.addEventListener('pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); this.audioInit(); b.setPointerCapture(e.pointerId); if (!latched) { set(true); t0 = performance.now(); } });
      b.addEventListener('pointerup', e => { if (e.button !== 0) return; if (!latched) setTimeout(() => { if (!latched) set(false); }, Math.max(0, 120 - (performance.now() - t0))); });
      b.addEventListener('contextmenu', e => { e.preventDefault(); if (pin === 'RESET') return; latched = !latched; set(latched); b.classList.toggle('latched', latched); });
      return h('div.bd-btnwrap', null, b, h('div.bd-lbl', { text: label }));
    };
    const nucleo = h('div.bd-nucleo', null,
      h('div.bd-ntitle', null, h('b', { text: 'NUCLEO-F103RB' }), h('span', { text: '  STM32F103RBT6' })),
      h('div.bd-nrow', null,
        h('div.bd-ledwrap', null, this.ld1, h('div.bd-lbl', { text: 'LD1 COM' })),
        h('div.bd-ledwrap', null, this.ld3, h('div.bd-lbl', { text: 'LD3 PWR' })),
        h('div.bd-ledwrap', null, this.ld2, h('div.bd-lbl', { text: 'LD2 (PA5)' })),
        h('div.bd-chip', null, h('span', { text: 'STM32\nF103RB' })),
        pbtn('blue', 'B1 USER (PC13)', 'PC13', 'Blue user button B1 = PC13 (pressed = 0)'),
        pbtn('black', 'RESET', 'RESET', 'Black RESET button: restarts your program')),
      h('div.bd-nrow.small', null,
        this.ledB14 = h('div.bd-led.red.sm', { title: 'LED on PB14' }), h('span.bd-lbl', { text: 'PB14' }),
        this.ledB15 = h('div.bd-led.red.sm', { title: 'LED on PB15' }), h('span.bd-lbl', { text: 'PB15' }),
        h('span.bd-gap'), pbtn('tact', 'PC12', 'PC12', 'Push button on PC12 (pressed = 0)'), pbtn('tact', 'PA15', 'PA15', 'Push button on PA15 (pressed = 0)')));
    // ---- General I/O board
    this.bar = [];
    const barEl = h('div.bd-bar');
    for (let i = 9; i >= 0; i--) { const s = h('div.bd-barseg' + (i > 7 ? '.unused' : '')); if (i <= 7) this.bar[i] = s; barEl.append(s); }
    const barLbl = h('div.bd-barlbl', null, ...[9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(i => h('span', { text: i > 7 ? '' : 'PC' + i })));
    const dip = h('div.bd-dip', null, h('div.bd-dipon', { text: 'ON ↑' }));
    this.dipEls = {};
    for (const name of ['PB12', 'PA4', 'PD2']) {
      const sw = h('div.bd-dipsw', { title: name + ': click to toggle. Up (ON) = 0, Down (OFF) = 1' }, h('div.bd-diplever'));
      sw.addEventListener('click', () => { B.dip[name] = B.dip[name] ? 0 : 1; this.m.setDrive(); this.paintDip(); this.audioInit(); });
      this.dipEls[name] = sw;
      dip.append(h('div.bd-dipcol', null, sw, h('div.bd-lbl', { text: name })));
    }
    this.buzzEl = h('div.bd-buzzer', { title: 'Buzzer on PA1' });
    const pot = h('input.bd-pot', { type: 'range', min: 0, max: 1000, value: Math.round(B.pot * 1000), title: 'Potentiometer on PA0 (AnalogIn)' });
    pot.oninput = () => { B.pot = pot.value / 1000; this.m.setDrive(); potV.textContent = (B.pot * 3.3).toFixed(2) + ' V'; };
    const potV = h('span.bd-lbl', { text: (B.pot * 3.3).toFixed(2) + ' V' });
    this.relayEl = h('div.bd-led.yellow.sm', { title: 'Relay / motor drive (PA6 / PA7)' });
    const io = h('div.bd-pcb', null, h('div.bd-ptitle', { text: 'General I/O Board' }),
      h('div.bd-iorow', null, h('div.bd-barwrap', null, barEl, barLbl, h('div.bd-sub', { text: 'LED bar  (PortC: PC7 … PC0)' })),
        h('div.bd-dipwrap', null, dip, h('div.bd-sub', { text: 'DIP switch' }))),
      h('div.bd-iorow', null, h('div.bd-buzzwrap', null, this.buzzEl, h('div.bd-sub', { text: 'Buzzer PA1' })),
        h('div.bd-potwrap', null, h('div.bd-knob'), pot, h('div.bd-sub', null, 'Pot PA0 ', potV)),
        h('div.bd-ledwrap', null, this.relayEl, h('div.bd-lbl', { text: 'PA6/PA7' }))));
    // ---- 7-segment board
    this.digits = [];
    const dg = h('div.bd-digits');
    for (let d = 3; d >= 0; d--) {
      const svgNS = 'http://www.w3.org/2000/svg';
      const s = document.createElementNS(svgNS, 'svg'); s.setAttribute('viewBox', '0 0 64 100'); s.classList.add('bd-7seg');
      const segs = {};
      for (const k of SEGS) { const p = document.createElementNS(svgNS, 'path'); p.setAttribute('d', SEG_PATHS[k]); p.setAttribute('transform', 'skewX(-6) translate(6 0)'); s.append(p); segs[k] = p; }
      const dp = document.createElementNS(svgNS, 'circle'); dp.setAttribute('cx', 55); dp.setAttribute('cy', 92); dp.setAttribute('r', 4.2); s.append(dp); segs.dp = dp;
      this.digits[d] = segs;
      dg.append(h('div.bd-digit', null, s, h('div.bd-lbl', { text: 'DIG' + d })));
    }
    const seg = h('div.bd-pcb', null, h('div.bd-ptitle', { text: '7-Segment Display Board  (segments PB7..PB0 = dp g f e d c b a, digits PC11..PC8)' }),
      h('div.bd-segrow', null, dg, pbtn('tact', 'PC13', 'PC13', 'Push button PC13 (same signal as B1)')));
    // ---- LCD & keypad
    this.lcdCanvas = h('canvas.bd-lcd', { width: 20 * 18 + 16, height: 2 * 27 + 16 });
    const keys = h('div.bd-keys');
    for (const row of [['1', '2', '3', 'F'], ['4', '5', '6', 'E'], ['7', '8', '9', 'D'], ['A', '0', 'B', 'C']]) for (const k of row) {
      const kb = h('div.bd-key', { text: k, title: 'Key ' + k + ' (or type it on your keyboard while the board window is focused)' });
      let t0 = 0;
      kb.addEventListener('pointerdown', e => { e.preventDefault(); this.audioInit(); kb.setPointerCapture(e.pointerId); kb.classList.add('down'); B.pressKey(k); t0 = performance.now(); });
      const up = () => { if (kb.classList.contains('down')) { const wait = Math.max(0, 120 - (performance.now() - t0)); setTimeout(() => { kb.classList.remove('down'); B.releaseKey(); }, wait); } };
      kb.addEventListener('pointerup', up); kb.addEventListener('pointercancel', up);
      keys.append(kb);
    }
    this.keyEls = keys;
    const lcdk = h('div.bd-pcb', null, h('div.bd-ptitle', { text: 'LCD & Keypad Board  (LCD: D7..D4 = PA11..PA8, E = PA12, RS = PC7, RW = PC6 • 74C922: PB11..PB8, DA = PB13)' }),
      h('div.bd-lcdwrap', null, h('div.bd-lcdbezel', null, this.lcdCanvas)), h('div.bd-keywrap', null, keys));
    // ---- pin monitor
    this.pinTable = h('div.bd-pins');
    const pinDet = h('details.bd-pindet', { open: this.pinsOpen }, h('summary', { text: 'Pin monitor (GPIO levels)' }), this.pinTable);
    pinDet.addEventListener('toggle', () => { this.pinsOpen = pinDet.open; });
    this.w.body.innerHTML = '';
    this.w.body.append(h('div.bd', { tabindex: 0 }, toolbar, h('div.bd-scroll', null, nucleo, io, seg, lcdk, pinDet)));
    this.w.body.firstChild.addEventListener('keydown', e => this.kbd(e, true));
    this.w.body.firstChild.addEventListener('keyup', e => this.kbd(e, false));
    this.paintDip();
  },
  kbd(e, down) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.toUpperCase();
    if (!/^[0-9A-F]$/.test(k)) return;
    e.preventDefault();
    const el = [...this.keyEls.children].find(x => x.textContent === k);
    if (down && !e.repeat) { el && el.classList.add('down'); this.m.board.pressKey(k); this.audioInit(); this.kt0 = performance.now(); }
    if (!down) setTimeout(() => { el && el.classList.remove('down'); this.m.board.releaseKey(); }, Math.max(0, 120 - (performance.now() - (this.kt0 || 0))));
  },
  paintDip() { for (const n in this.dipEls) this.dipEls[n].classList.toggle('on', this.m.board.dip[n] === 0); },
  reset() { if (!this.usb) return; G.App.resetBoard(); },
  powerChanged() { G.App.powerChanged(this.usb); },
  audioInit() {
    if (this.audio) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = 440; gain.gain.value = 0;
      osc.connect(gain); gain.connect(ctx.destination); osc.start();
      this.audio = { ctx, osc, gain };
    } catch (e) { this.audio = { none: true }; }
  },
  /* ---------- main loop: run machine in real time and paint ---------- */
  loop(ts) {
    requestAnimationFrame(t => this.loop(t));
    this.lastRaf = performance.now();
    this.step(ts, false);
  },
  step(ts, bg) {
    const m = this.m; if (!m) return;
    const dt = Math.min(bg ? 1100 : 100, this.lastFrame ? ts - this.lastFrame : 16);
    if (dt <= 0) return;
    this.lastFrame = ts;
    if (!this.usb) { m.t += dt * 1000; }
    else if (this.isBusy) { m.t += dt * 1000; }
    else {
      const target = m.t + dt * 1000 * this.speed;
      const ok = m.runUntil(target, bg ? 200 : 28);
      this.lagging = !ok;
    }
    if (this.w && !this.w.minimized) this.paint(ts);
    this.sound();
  },
  paint(ts) {
    const m = this.m, B = m.board;
    const powered = this.usb;
    const f = B.takeFrame(m.t);
    const run = powered && !this.isBusy;
    const st = this.isBusy ? 'Programming flash…' : !powered ? 'Board unpowered (USB unplugged)' : m.state === 'running' ? (m.main && m.main.done ? 'main() returned – MCU idle' : 'Running: ' + (G.App.flashInfo || 'program')) : m.state === 'fault' ? 'HardFault: ' + m.fault : m.state === 'erased' ? 'Flash erased – no program' : m.state;
    this.stateEl.textContent = st + (this.lagging ? '  (simulation slower than real time)' : '');
    this.stateEl.className = 'bd-state ' + (m.state === 'fault' ? 'fault' : this.isBusy ? 'busy' : run && m.state === 'running' ? 'run' : 'idle');
    const lit = (el, v, cls) => { el.style.setProperty('--b', Math.min(1, v * 1.25).toFixed(3)); el.classList.toggle(cls || 'on', v > 0.02); };
    lit(this.ld3, powered ? 1 : 0);
    this.ld1.classList.toggle('busy', this.isBusy && Math.floor(ts / 120) % 2 === 0);
    this.ld1.classList.toggle('on', powered && !this.isBusy);
    for (let i = 0; i < 8; i++) lit(this.bar[i], run ? f.bar[i] : 0);
    lit(this.ld2, run ? f.ld2 : 0); lit(this.ledB14, run ? f.b14 : 0); lit(this.ledB15, run ? f.b15 : 0);
    lit(this.relayEl, run ? Math.max(f.pa6, f.pa7) : 0);
    for (let d = 0; d < 4; d++) {
      const segs = this.digits[d];
      for (let s = 0; s < 8; s++) {
        const v = run ? f.seg[d][s] : 0;
        const el = s < 7 ? segs[SEGS[s]] : segs.dp;
        const b = Math.min(1, v * 3.2);
        el.style.fill = b > 0.01 ? 'rgba(255,' + Math.round(40 + 40 * b) + ',30,' + (0.18 + 0.82 * b).toFixed(3) + ')' : '';
        el.style.filter = b > 0.3 ? 'drop-shadow(0 0 ' + (2 + 3 * b).toFixed(1) + 'px rgba(255,60,30,.8))' : '';
      }
    }
    this.drawLcd(ts, powered);
    const bz = run ? B.buzzer(m.t) : { on: false };
    this.buzzEl.classList.toggle('on', bz.on);
    if (this.pinsOpen && (!this.pinT || ts - this.pinT > 150)) { this.pinT = ts; this.paintPins(); }
  },
  drawLcd(ts, powered) {
    const c = this.lcdCanvas, g = c.getContext('2d');
    const lcd = this.m.board.lcd;
    const DOT = 3, GAP = 0.45, CW = 18, CH = 27, OX = 8, OY = 8;
    g.fillStyle = powered ? '#9cc13a' : '#7f9139'; g.fillRect(0, 0, c.width, c.height);
    const on = '#1b2b0c', off = powered ? 'rgba(40,70,10,0.12)' : 'rgba(40,70,10,0.05)';
    const cur = lcd.disp ? lcd.cursorPos() : null;
    const blinkOn = Math.floor(ts / 530) % 2 === 0;
    for (let r = 0; r < 2; r++) for (let col = 0; col < 20; col++) {
      let rows;
      const busy = this.isBusy;
      if (!powered || busy) rows = null;
      else if (!lcd.inited) rows = r === 0 ? 'block' : null;
      else if (!lcd.disp) rows = null;
      else {
        const ch = lcd.charAt(r, col);
        if (ch < 16) { const base = (ch & 7) * 8; rows = []; for (let y = 0; y < 8; y++) rows.push(lcd.cgram[base + y]); rows = { cg: rows }; }
        else rows = glyph(ch);
      }
      const x0 = OX + col * CW, y0 = OY + r * CH;
      for (let x = 0; x < 5; x++) for (let y = 0; y < 8; y++) {
        let px = false;
        if (rows === 'block') px = true;
        else if (rows && rows.cg) px = !!((rows.cg[y] >> (4 - x)) & 1);
        else if (rows) px = !!((rows[x] >> y) & 1);
        if (cur && cur.r === r && cur.c === col) {
          if (lcd.cursor && y === 7) px = true;
          if (lcd.blink && blinkOn) px = true;
        }
        g.fillStyle = px ? on : off;
        g.fillRect(x0 + x * DOT, y0 + y * DOT, DOT - GAP, DOT - GAP);
      }
    }
  },
  paintPins() {
    const m = this.m;
    let html = '<table><tr><th></th>' + [...Array(16)].map((_, i) => '<th>' + (15 - i) + '</th>').join('') + '</tr>';
    ['A', 'B', 'C', 'D'].forEach((P, p) => {
      html += '<tr><th>P' + P + '</th>';
      const port = m.ports[p], lv = m.portLevel(p);
      for (let n = 15; n >= 0; n--) {
        if (p === 3 && n > 2) { html += '<td class="na"></td>'; continue; }
        const out = (port.out >> n) & 1, v = (lv >> n) & 1;
        html += '<td class="' + (out ? 'o' : 'i') + (v ? ' h' : '') + '" title="P' + P + '_' + n + ' ' + (out ? 'output' : 'input') + ' = ' + v + '">' + v + '</td>';
      }
      html += '</tr>';
    });
    html += '</table><div class="bd-pinkey"><span class="o h">1</span> output high <span class="o">0</span> output low <span class="i h">1</span> input high <span class="i">0</span> input low</div>';
    this.pinTable.innerHTML = html;
  },
  sound() {
    const a = this.audio; if (!a || a.none) return;
    const m = this.m;
    const bz = (this.usb && !this.isBusy && m.state === 'running') ? m.board.buzzer(m.t) : { on: false };
    const on = bz.on && !this.muted && this.speed === 1;
    const t = a.ctx.currentTime;
    if (on) { a.osc.frequency.setTargetAtTime(Math.max(40, Math.min(8000, bz.freq)), t, 0.005); a.gain.gain.setTargetAtTime(0.05, t, 0.005); }
    else a.gain.gain.setTargetAtTime(0, t, 0.01);
  },
};

/* ---------------- Tera Term ---------------- */
const TeraTerm = {
  w: null, el: null,
  open() {
    if (this.w) { this.w.restore(); this.w.focus(); return; }
    const mb = G.menuBar([
      { label: 'File', items: () => [{ label: 'New connection...', disabled: true }, { label: 'Log...', disabled: true }, '-', { label: 'Exit', action: () => this.w.close() }] },
      { label: 'Edit', items: () => [{ label: 'Copy', action: () => { try { navigator.clipboard.writeText(getSelection().toString()); } catch (e) { } } }, '-', { label: 'Clear screen', action: () => { this.el.textContent = ''; } }, { label: 'Clear buffer', action: () => { this.el.textContent = ''; } }] },
      { label: 'Setup', items: () => [{ label: 'Terminal...', disabled: true }, { label: 'Window...', disabled: true }, { label: 'Font', sub: [{ label: 'Font...', action: () => { this.big = !this.big; this.el.classList.toggle('big', this.big); } }] }, '-', { label: 'Serial port...', action: () => msgBox('Tera Term: Serial port setup and connection', 'Port: COM3  (STMicroelectronics STLink Virtual COM Port)\nSpeed: 9600\nData: 8 bit\nParity: none\nStop bits: 1 bit\nFlow control: none', 'info') }] },
      { label: 'Control', items: [{ label: 'Reset terminal', action: () => { this.el.textContent = ''; } }] },
      { label: 'Window', items: [] }, { label: 'Help', items: [{ label: 'About Tera Term...', action: () => msgBox('About Tera Term', 'Tera Term (simulated)\nShows printf() output from the board over the ST-LINK Virtual COM port at 9600 baud.\nPress the black RESET button on the board to see the start-up message again.', 'info') }] }]);
    this.el = h('pre.tt-screen');
    this.w = WM.open('teraterm', { title: 'COM3 - Tera Term VT', icon: I.term, w: 600, h: 320, x: 40, y: Math.max(10, WM.desk.clientHeight - 360), cls: 'ttwin', onClosed: () => { this.w = null; } });
    this.w.body.append(h('div.tt', null, mb, this.el));
  },
  write(s) {
    if (!this.el || !this.w) return;
    let t = this.el.textContent + s.replace(/\r/g, '');
    if (t.length > 40000) t = t.slice(-30000);
    this.el.textContent = t;
    this.el.scrollTop = this.el.scrollHeight;
  },
};

G.Board = BoardUI; G.TeraTerm = TeraTerm;
})(window);
