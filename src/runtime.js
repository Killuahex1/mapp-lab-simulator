// runtime.js — STM32F103RB + MAPP Experiment Board model (pin-level) and program scheduler
(function (G) {
'use strict';

const WFI = { wfi: true }, EXIT = { exit: true };
const SLICE = 2000;      // loop iterations per scheduler slice
const COST = 0.5;        // µs of MCU time per loop iteration (approx. for a polling loop)

class HardFault extends Error { constructor(msg) { super(msg); this.hard = true; } }
class Ptr { constructor(a, i) { this.a = a; this.i = i; } }

/* ---------------- printf ---------------- */
function cstr(p) {
  if (p == null) return '(null)';
  if (typeof p === 'string') return p;
  let a = p, i = 0;
  if (p instanceof Ptr) { a = p.a; i = p.i; }
  let s = '';
  for (; i < a.length; i++) { const c = a[i]; if (!c) break; s += String.fromCharCode(c & 255); }
  return s;
}
function format(fmt, args) {
  let ai = 0, out = '';
  const re = /%([-+ #0]*)(\d+|\*)?(?:\.(\d+|\*))?(hh|h|ll|l|z|j|t|L)?([diuxXoscfFeEgGp%])/g;
  let last = 0, m;
  while ((m = re.exec(fmt))) {
    out += fmt.slice(last, m.index); last = re.lastIndex;
    let [, flags, width, prec, len, conv] = m;
    if (conv === '%') { out += '%'; continue; }
    if (width === '*') width = args[ai++];
    if (prec === '*') prec = args[ai++];
    width = width ? +width : 0; prec = prec === undefined ? undefined : +prec;
    let v = args[ai++], s;
    switch (conv) {
      case 'd': case 'i': {
        v = Math.trunc(+v || 0); if (len !== 'll') v = v | 0;
        s = Math.abs(v).toString(); if (prec !== undefined) s = s.padStart(prec, '0');
        if (v < 0) s = '-' + s; else if (flags.includes('+')) s = '+' + s; else if (flags.includes(' ')) s = ' ' + s;
        break;
      }
      case 'u': v = Math.trunc(+v || 0); s = (len === 'll' ? v : v >>> 0).toString(); break;
      case 'x': case 'X': case 'o': {
        v = Math.trunc(+v || 0); if (len !== 'll') v = v >>> 0;
        if (len === 'hh') v &= 255; else if (len === 'h') v &= 65535;
        s = v.toString(conv === 'o' ? 8 : 16); if (conv === 'X') s = s.toUpperCase();
        if (prec !== undefined) s = s.padStart(prec, '0');
        if (flags.includes('#') && v !== 0) s = (conv === 'o' ? '0' : conv === 'X' ? '0X' : '0x') + s;
        break;
      }
      case 'c': s = String.fromCharCode((+v || 0) & 255); break;
      case 's': s = cstr(v); if (prec !== undefined) s = s.slice(0, prec); break;
      case 'f': case 'F': s = (+v).toFixed(prec === undefined ? 6 : prec); if (flags.includes('+') && v >= 0) s = '+' + s; break;
      case 'e': case 'E': s = (+v).toExponential(prec === undefined ? 6 : prec).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); break;
      case 'g': case 'G': s = String(+(+v).toPrecision(prec || 6)); break;
      case 'p': s = '0x' + (0x20000000 + ((v && v.i) || 0)).toString(16); break;
    }
    if (s.length < width) {
      if (flags.includes('-')) s = s.padEnd(width);
      else if (flags.includes('0') && !'sc'.includes(conv)) { const neg = /^[-+ ]/.test(s) ? s[0] : ''; s = neg + s.slice(neg.length).padStart(width - neg.length, '0'); }
      else s = s.padStart(width);
    }
    out += s;
  }
  return out + fmt.slice(last);
}
function writeStr(p, s, max) {
  if (!(p instanceof Ptr)) throw new HardFault('sprintf to a null pointer');
  const n = max == null ? s.length : Math.min(s.length, max - 1);
  for (let k = 0; k < n; k++) p.a[p.i + k] = s.charCodeAt(k);
  if (max == null || max > 0) p.a[p.i + n] = 0;
}

/* ---------------- HD44780 LCD controller (4-bit interface) ---------------- */
class HD44780 {
  constructor() { this.reset(); }
  reset() {
    this.ddram = new Uint8Array(128).fill(32); this.cgram = new Uint8Array(64);
    this.ac = 0; this.cg = false; this.id = 1; this.sh = 0; this.disp = false; this.cursor = false; this.blink = false;
    this.lines = 1; this.bits8 = true; this.half = null; this.shift = 0; this.inited = false; this.ver = 0; this.log = [];
  }
  latch(nib, rs, rw) {
    if (rw) return;
    if (this.bits8) { this.exec((nib & 15) << 4, rs); return; }
    if (this.half === null) { this.half = nib & 15; return; }
    const b = (this.half << 4) | (nib & 15); this.half = null; this.exec(b, rs);
  }
  step(dir) {
    let a = this.ac;
    if (this.lines === 2) {
      a += dir;
      if (a === 0x28) a = 0x40; else if (a === 0x68) a = 0x00; else if (a === -1) a = 0x67; else if (a === 0x3F) a = 0x27;
    } else { a = (a + dir + 80) % 80; }
    this.ac = a;
  }
  exec(b, rs) {
    this.ver++;
    if (rs) {
      if (this.cg) { this.cgram[this.ac & 63] = b & 31; this.ac = (this.ac + this.id) & 63; }
      else { this.ddram[this.ac & 127] = b; this.step(this.id); if (this.sh) this.shift += this.id; }
      return;
    }
    if (b & 0x80) { this.ac = b & 0x7F; this.cg = false; }
    else if (b & 0x40) { this.ac = b & 0x3F; this.cg = true; }
    else if (b & 0x20) { this.bits8 = !!(b & 0x10); this.lines = (b & 0x08) ? 2 : 1; this.half = null; this.inited = true; }
    else if (b & 0x10) { const sc = b & 8, rl = (b & 4) ? 1 : -1; if (sc) this.shift -= rl; else this.step(rl); }
    else if (b & 0x08) { this.disp = !!(b & 4); this.cursor = !!(b & 2); this.blink = !!(b & 1); }
    else if (b & 0x04) { this.id = (b & 2) ? 1 : -1; this.sh = b & 1; }
    else if (b & 0x02) { this.ac = 0; this.shift = 0; this.cg = false; }
    else if (b & 0x01) { this.ddram.fill(32); this.ac = 0; this.id = 1; this.shift = 0; this.cg = false; }
  }
  addrAt(row, col) {
    if (this.lines === 2) return (row ? 0x40 : 0) + (((col + this.shift) % 40) + 40) % 40;
    return row ? -1 : (((col + this.shift) % 80) + 80) % 80;
  }
  charAt(row, col) { const a = this.addrAt(row, col); return a < 0 ? 32 : this.ddram[a]; }
  text(row) { if (!this.disp) return ''.padEnd(20); let s = ''; for (let c = 0; c < 20; c++) { const ch = this.charAt(row, c); s += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : (ch < 8 ? '□' : '█'); } return s; }
  cursorPos() {
    if (this.cg) return null;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 20; c++) if (this.addrAt(r, c) === this.ac) return { r, c };
    return null;
  }
}

/* ---------------- Board (MAPP Experiment Board peripherals) ---------------- */
const PIN = (p, n) => p * 16 + n;
const PA = n => PIN(0, n), PB = n => PIN(1, n), PC = n => PIN(2, n), PD = n => PIN(3, n);
const KEYMAP = ['1', '2', '3', 'F', '4', '5', '6', 'E', '7', '8', '9', 'D', 'A', '0', 'B', 'C'];

class Board {
  constructor(m) {
    this.m = m;
    this.dip = { PB12: 1, PA4: 1, PD2: 1 };   // 1 = OFF (pulled up), 0 = ON (pushed up)
    this.btn = { PC13: 1, PC12: 1, PA15: 1 }; // active-low push buttons
    this.key = { code: 0, da: 0 };           // 74C922 latched code / data available
    this.pot = 0.5;                          // PA0 potentiometer
    this.lcd = new HD44780();
    this.buzzT = []; this.lastBuzz = -1e12;
    this.resetAcc(0);
  }
  powerReset() { this.lcd.reset(); this.buzzT = []; this.lastBuzz = -1e12; }
  // external level driven onto a pin, or null if floating
  drive(pin) {
    switch (pin) {
      case PB(12): return this.dip.PB12; case PA(4): return this.dip.PA4; case PD(2): return this.dip.PD2;
      case PC(13): return this.btn.PC13; case PC(12): return this.btn.PC12; case PA(15): return this.btn.PA15;
      case PB(8): return this.key.code & 1; case PB(9): return (this.key.code >> 1) & 1; case PB(10): return (this.key.code >> 2) & 1; case PB(11): return (this.key.code >> 3) & 1;
      case PB(13): return this.key.da;
      case PA(0): return this.pot > 0.5 ? 1 : 0;
    }
    return null;
  }
  resetAcc(t) {
    this.acc = { t0: t, last: t, bar: new Float64Array(8), seg: [0, 1, 2, 3].map(() => new Float64Array(8)), dig: new Float64Array(4), ld2: 0, b14: 0, b15: 0, pa6: 0, pa7: 0 };
  }
  integrate(t) {
    const a = this.acc, dt = t - a.last;
    if (dt <= 0) { a.last = Math.max(a.last, t); return; }
    const m = this.m, lA = m.portLevel(0), lB = m.portLevel(1), lC = m.portLevel(2);
    for (let i = 0; i < 8; i++) if ((lC >> i) & 1) a.bar[i] += dt;
    for (let d = 0; d < 4; d++) if ((lC >> (8 + d)) & 1) { a.dig[d] += dt; const s = a.seg[d]; for (let i = 0; i < 8; i++) if ((lB >> i) & 1) s[i] += dt; }
    if ((lA >> 5) & 1) a.ld2 += dt * (m.pwmDuty(PA(5)));
    if ((lB >> 14) & 1) a.b14 += dt; if ((lB >> 15) & 1) a.b15 += dt;
    if ((lA >> 6) & 1) a.pa6 += dt; if ((lA >> 7) & 1) a.pa7 += dt;
    a.last = t;
  }
  takeFrame(t) {
    this.integrate(t);
    const a = this.acc, span = Math.max(1e-9, t - a.t0);
    const f = { span, bar: Array.from(a.bar, v => v / span), seg: a.seg.map(s => Array.from(s, v => v / span)), dig: Array.from(a.dig, v => v / span),
      ld2: a.ld2 / span, b14: a.b14 / span, b15: a.b15 / span, pa6: a.pa6 / span, pa7: a.pa7 / span };
    this.resetAcc(t);
    return f;
  }
  onPort(port, oldL, newL, t) {
    const ch = oldL ^ newL;
    // LCD: E = PA12 falling edge latches D7..D4 = PA11..PA8, RS = PC7, RW = PC6
    if (port === 0 && (ch & (1 << 12)) && !(newL & (1 << 12))) {
      const lC = this.m.portLevel(2);
      this.lcd.latch((newL >> 8) & 15, (lC >> 7) & 1, (lC >> 6) & 1);
      if (this.onLcd) this.onLcd(t);
    }
    // buzzer PA1
    if (port === 0 && (ch & 2)) {
      this.buzzT.push(t); if (this.buzzT.length > 16) this.buzzT.shift();
      this.lastBuzz = t;
    }
  }
  buzzer(t) {
    const pw = this.m.pwm[PA(1)];
    if (pw && pw.duty > 0 && pw.duty < 1 && pw.period > 0) return { on: true, freq: 1e6 / pw.period };
    if (t - this.lastBuzz > 40000 || this.buzzT.length < 4) return { on: false, freq: 0 };
    const b = this.buzzT, n = b.length;
    const half = (b[n - 1] - b[0]) / (n - 1);
    if (!(half > 0)) return { on: false, freq: 0 };
    return { on: true, freq: 1e6 / (2 * half) };
  }
  pressKey(ch) {
    const i = KEYMAP.indexOf(String(ch).toUpperCase());
    if (i < 0) return false;
    this.key.code = i; this.m.setDrive(); this.key.da = 1; this.m.setDrive();
    return true;
  }
  releaseKey() { this.key.da = 0; this.m.setDrive(); }
}

/* ---------------- Machine (MCU + scheduler) ---------------- */
class Machine {
  constructor(opts) {
    opts = opts || {};
    this.headless = !!opts.headless;
    this.t = 0;
    this.ports = [0, 1, 2, 3].map(() => ({ odr: 0, out: 0, pullUp: 0, pullDown: 0 }));
    this.levels = [0, 0, 0, 0];
    this.board = new Board(this);
    this.serialListeners = []; this.serialLog = '';
    this.image = null; this.state = 'off'; this.note = '';
    this.pwm = {};
    this.recalcLevels(true);
  }
  /* ---- pins ---- */
  portLevel(p) { return this.levels[p]; }
  level(pin) { return pin < 0 ? 0 : (this.levels[pin >> 4] >> (pin & 15)) & 1; }
  pwmDuty(pin) { const p = this.pwm[pin]; return p ? p.duty : 1; }
  recalcLevels(silent) {
    for (let p = 0; p < 4; p++) {
      const P = this.ports[p];
      let lv = 0;
      for (let n = 0; n < 16; n++) {
        const pin = p * 16 + n, bit = 1 << n;
        let v;
        if (P.out & bit) v = (P.odr & bit) ? 1 : 0;
        else { const d = this.board.drive(pin); v = d != null ? d : (P.pullUp & bit) ? 1 : 0; }
        if (v) lv |= bit;
      }
      const old = this.levels[p];
      if (old !== lv) {
        if (!silent) this.board.integrate(this.t);
        this.levels[p] = lv;
        if (!silent) { this.board.onPort(p, old, lv, this.t); this.checkIrq(p, old, lv); }
      }
    }
  }
  setDrive() { this.recalcLevels(false); }
  cfgOut(pin) { if (pin < 0) return; const P = this.ports[pin >> 4]; P.out |= 1 << (pin & 15); this.recalcLevels(false); }
  cfgIn(pin, mode) {
    if (pin < 0) return; const P = this.ports[pin >> 4], bit = 1 << (pin & 15);
    P.out &= ~bit;
    if (mode !== undefined) { P.pullUp &= ~bit; P.pullDown &= ~bit; if (mode === 1) P.pullUp |= bit; if (mode === 2) P.pullDown |= bit; }
    this.recalcLevels(false);
  }
  writePin(pin, v) {
    if (pin < 0) return; const P = this.ports[pin >> 4], bit = 1 << (pin & 15);
    const o = P.odr; P.odr = v ? (o | bit) : (o & ~bit);
    if (P.odr !== o) this.recalcLevels(false);
  }
  writePort(p, mask, v) {
    const P = this.ports[p]; const o = P.odr;
    P.odr = ((o & ~mask) | (v & mask)) & 0xFFFF;
    if (P.odr !== o) this.recalcLevels(false);
  }
  /* ---- interrupts ---- */
  checkIrq(p, old, nw) {
    if (!this.irqPins) return;
    const ch = old ^ nw;
    if (!ch) return;
    for (const ii of this.irqPins) {
      if ((ii.pin >> 4) !== p || !(ch & (1 << (ii.pin & 15))) || !ii.enabled) continue;
      const rising = (nw >> (ii.pin & 15)) & 1;
      const fn = rising ? ii.rise : ii.fall;
      if (fn) this.pending.push(fn);
    }
  }
  /* ---- mbed object factory ---- */
  make(cls, args, name) {
    const m = this;
    switch (cls) {
      case 'DigitalOut': {
        const pin = args[0]; m.cfgOut(pin); m.writePin(pin, args.length > 1 ? args[1] : 0);
        return { write: v => m.writePin(pin, v ? 1 : 0), read: () => (m.ports[pin >> 4].odr >> (pin & 15)) & 1, is_connected: () => pin >= 0 ? 1 : 0, pin };
      }
      case 'DigitalIn': case 'InterruptIn': {
        const pin = args[0]; m.cfgIn(pin, args.length > 1 ? args[1] : 0);
        const o = { read: () => m.level(pin), mode: md => m.cfgIn(pin, md), is_connected: () => pin >= 0 ? 1 : 0, pin };
        if (cls === 'InterruptIn') {
          const ii = { pin, rise: null, fall: null, enabled: true };
          (m.irqPins = m.irqPins || []).push(ii);
          o.rise = fn => { ii.rise = fn; }; o.fall = fn => { ii.fall = fn; };
          o.enable_irq = () => { ii.enabled = true; }; o.disable_irq = () => { ii.enabled = false; };
        }
        return o;
      }
      case 'DigitalInOut': {
        const pin = args[0]; m.cfgIn(pin);
        return { write: v => m.writePin(pin, v ? 1 : 0), read: () => m.level(pin), output: () => m.cfgOut(pin), input: () => m.cfgIn(pin), mode: md => m.cfgIn(pin, md) };
      }
      case 'PortOut': {
        const p = args[0], mask = (args.length > 1 ? args[1] : 0xFFFF) & 0xFFFF;
        for (let n = 0; n < 16; n++) if (mask & (1 << n)) m.ports[p].out |= 1 << n;
        m.recalcLevels(false);
        return { write: v => m.writePort(p, mask, v), read: () => m.ports[p].odr & mask };
      }
      case 'PortIn': {
        const p = args[0], mask = (args.length > 1 ? args[1] : 0xFFFF) & 0xFFFF;
        m.ports[p].out &= ~mask; m.recalcLevels(false);
        return { read: () => m.levels[p] & mask, mode: md => { for (let n = 0; n < 16; n++) if (mask & (1 << n)) m.cfgIn(p * 16 + n, md); } };
      }
      case 'BusOut': {
        const pins = args.slice();
        pins.forEach(pn => { m.cfgOut(pn); m.writePin(pn, 0); });
        return {
          write: v => { pins.forEach((pn, i) => { if (pn >= 0) { const P = m.ports[pn >> 4], bit = 1 << (pn & 15); P.odr = ((v >> i) & 1) ? (P.odr | bit) : (P.odr & ~bit); } }); m.recalcLevels(false); },
          read: () => pins.reduce((acc, pn, i) => acc | (pn >= 0 ? ((m.ports[pn >> 4].odr >> (pn & 15)) & 1) << i : 0), 0),
          mask: () => pins.reduce((acc, pn, i) => acc | (pn >= 0 ? 1 << i : 0), 0)
        };
      }
      case 'BusIn': {
        const pins = args.slice();
        pins.forEach(pn => m.cfgIn(pn));
        return {
          read: () => pins.reduce((acc, pn, i) => acc | (m.level(pn) << i), 0),
          mode: md => pins.forEach(pn => m.cfgIn(pn, md)),
          mask: () => pins.reduce((acc, pn, i) => acc | (pn >= 0 ? 1 << i : 0), 0)
        };
      }
      case 'PwmOut': {
        const pin = args[0]; m.cfgOut(pin);
        const st = { period: 20000, duty: 0 }; m.pwm[pin] = st;
        const apply = () => { m.writePin(pin, st.duty > 0 ? 1 : 0); };
        return {
          write: v => { st.duty = Math.max(0, Math.min(1, +v)); apply(); }, read: () => st.duty,
          period: s => { st.period = s * 1e6; }, period_ms: ms => { st.period = ms * 1000; }, period_us: us => { st.period = us; },
          pulsewidth: s => { st.duty = Math.min(1, s * 1e6 / st.period); apply(); }, pulsewidth_ms: ms => { st.duty = Math.min(1, ms * 1000 / st.period); apply(); },
          pulsewidth_us: us => { st.duty = Math.min(1, us / st.period); apply(); }, suspend: () => { }, resume: () => { }
        };
      }
      case 'AnalogIn': {
        const pin = args[0]; m.cfgIn(pin); let vref = 3.3;
        const val = () => pin === PA(0) ? m.board.pot : 0;
        return { read: () => Math.fround(Math.round(val() * 4095) / 4095), read_u16: () => (Math.round(val() * 4095) << 4) | (Math.round(val() * 4095) >> 8), read_voltage: () => val() * vref,
          set_reference_voltage: v => { vref = v; }, get_reference_voltage: () => vref };
      }
      case 'AnalogOut': { let v = 0; return { write: x => { v = x; }, read: () => v, write_u16: x => { v = x / 65535; } }; }
      case 'Timer': case 'LowPowerTimer': {
        let start = 0, acc = 0, running = false;
        const el = () => acc + (running ? m.t - start : 0);
        return { start: () => { if (!running) { start = m.t; running = true; } }, stop: () => { if (running) { acc += m.t - start; running = false; } },
          reset: () => { acc = 0; start = m.t; }, read: () => el() / 1e6, read_ms: () => Math.floor(el() / 1000), read_us: () => Math.floor(el()), elapsed_time: () => Math.floor(el()) };
      }
      case 'Ticker': case 'Timeout': case 'LowPowerTicker': case 'LowPowerTimeout': {
        const once = cls.includes('Timeout'); let tm = null;
        const att = (fn, us) => { if (tm) m.timers.splice(m.timers.indexOf(tm), 1); tm = { due: m.t + Math.max(us, 1), period: once ? 0 : Math.max(us, 1), fn }; m.timers.push(tm); };
        return { attach: att, attach_us: att, detach: () => { if (tm) { const i = m.timers.indexOf(tm); if (i >= 0) m.timers.splice(i, 1); tm = null; } } };
      }
    }
    throw new HardFault('Unsupported class ' + cls);
  }
  /* ---- runtime object passed to compiled programs ---- */
  makeR() {
    const m = this;
    let seed = 1;
    const regs = {};
    ['RCC', 'GPIOA', 'GPIOB', 'GPIOC', 'GPIOD', 'AFIO', 'EXTI', 'TIM1', 'TIM2', 'TIM3', 'TIM4', 'NVIC', 'SysTick', 'USART1', 'USART2', 'USART3', 'ADC1', 'ADC2', 'FLASH', 'PWR', 'SCB', 'DMA1', 'I2C1', 'SPI1']
      .forEach(n => { regs[n] = new Proxy({}, { get: (o, k) => (k in o ? o[k] : 0), set: (o, k, v) => { o[k] = v; m.regTouched = true; return true; } }); });
    const R = {
      b: SLICE, WFI, EXIT, SystemCoreClock: 72000000, rg: regs,
      rga: (o, k) => { if (!Array.isArray(o[k])) o[k] = [0, 0, 0, 0, 0, 0, 0, 0]; return o[k]; },
      sleepMs: ms => ({ s: Math.max(0, +ms || 0) * 1000 }),
      sleepUs: us => ({ s: Math.max(0, +us || 0) }),
      lit: bytes => { const a = new Uint8Array(bytes.length + 1); a.set(bytes); return a; },
      strArr: (bytes, n, TA) => { const a = new TA(n == null ? bytes.length + 1 : n); for (let i = 0; i < bytes.length && i < a.length; i++) a[i] = bytes[i]; return a; },
      initArr: (TA, n, vals) => { const len = n == null ? vals.length : n; const a = TA === Array ? new Array(len).fill(null) : new TA(len); for (let i = 0; i < vals.length && i < len; i++) a[i] = vals[i]; return a; },
      arr2: (n, f) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = f(); return a; },
      ptr: (a, i) => new Ptr(a, i),
      padd: (p, n) => { if (!p) throw new HardFault('pointer arithmetic on a NULL pointer'); return new Ptr(p.a, p.i + n); },
      peq: (a, b, neg) => { const e = (a === null || b === null) ? a === b : (a.a === b.a && a.i === b.i); return neg ? !e : e; },
      div: (a, b, u) => { if (b === 0) throw new HardFault('Integer division by zero'); const r = Math.trunc(a / b); return u ? r >>> 0 : r | 0; },
      mod: (a, b, u) => { if (b === 0) throw new HardFault('Integer division by zero (% 0)'); const r = a % b; return u ? r >>> 0 : r | 0; },
      ftoi: x => Number.isFinite(x) ? Math.trunc(x) : 0,
      printf: (fmt, ...a) => { const s = format(cstr(fmt), a); m.serialOut(s); return s.length; },
      sprintf: (buf, fmt, ...a) => { const s = format(cstr(fmt), a); writeStr(buf, s); return s.length; },
      snprintf: (buf, n, fmt, ...a) => { const s = format(cstr(fmt), a); writeStr(buf, s, n); return s.length; },
      puts: s => { m.serialOut(cstr(s) + '\n'); return 1; },
      putchar: c => { m.serialOut(String.fromCharCode(c & 255)); return c; },
      strlen: p => cstr(p).length,
      strcpy: (d, s) => { writeStr(d, cstr(s)); return d; },
      strncpy: (d, s, n) => { const t = cstr(s); for (let k = 0; k < n; k++) d.a[d.i + k] = k < t.length ? t.charCodeAt(k) : 0; return d; },
      strcat: (d, s) => { const t = cstr(d); writeStr(new Ptr(d.a, d.i + t.length), cstr(s)); return d; },
      strcmp: (a, b, n) => { let x = cstr(a), y = cstr(b); if (n != null) { x = x.slice(0, n); y = y.slice(0, n); } return x < y ? -1 : x > y ? 1 : 0; },
      memset: (d, v, n) => { for (let k = 0; k < n; k++) d.a[d.i + k] = v; return d; },
      memcpy: (d, s, n) => { for (let k = 0; k < n; k++) d.a[d.i + k] = s.a[s.i + k]; return d; },
      rand: () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7FFFFFFF; return seed; },
      srand: s => { seed = s | 0; },
      atoi: p => parseInt(cstr(p), 10) | 0,
      toupper: c => (c >= 97 && c <= 122) ? c - 32 : c, tolower: c => (c >= 65 && c <= 90) ? c + 32 : c,
      make: (cls, args, name) => m.make(cls, args, name),
      irq: en => { m.irqEnabled = !!en; },
      nvic: () => { m.regTouched = true; }, setVector: () => { m.regTouched = true; },
      usTicker: () => Math.floor(m.t) >>> 0,
    };
    return R;
  }
  serialOut(s) {
    this.serialLog += s; if (this.serialLog.length > 20000) this.serialLog = this.serialLog.slice(-15000);
    for (const f of this.serialListeners) f(s);
  }
  /* ---- program control ---- */
  load(image) { this.image = image; }
  erase() { this.image = null; this.powerOn(); this.state = 'erased'; }
  powerOn() {
    // MCU reset: all pins become inputs, peripherals reset
    for (const P of this.ports) { P.odr = 0; P.out = 0; P.pullUp = 0; P.pullDown = 0; }
    this.pwm = {}; this.irqPins = []; this.timers = []; this.pending = []; this.irqEnabled = true; this.regTouched = false;
    this.board.powerReset();
    this.recalcLevels(true);
    this.board.resetAcc(this.t);
    this.fault = null; this.note = '';
    this.main = { gen: null, sleepUntil: 0, wfi: false, done: false };
    if (!this.image) { this.state = 'erased'; return; }
    try {
      this.R = this.makeR();
      const prog = this.image.factory(this.R);
      this.prog = prog;
      this.main.gen = (function* () { yield* prog.init(); return yield* prog.main(); })();
      this.state = 'running';
    } catch (e) { this.doFault(e); }
  }
  doFault(e) {
    this.state = 'fault';
    let why = e && e.hard ? e.message : (e instanceof RangeError ? 'Stack overflow (runaway recursion)' : (e instanceof TypeError ? 'Invalid memory access (NULL / bad pointer)' : String(e && e.message || e)));
    this.fault = why;
    this.serialOut('\n++ MbedOS Fault Handler ++\n\nFaultType: HardFault\n\nContext:\nR0   : 00000000\nPC   : 08001A2C\nLR   : 08000F65\nxPSR : 61000000\n\n-- MbedOS Fault Handler --\n\n\n\n++ MbedOS Error Info ++\nError Status: 0x80FF013D Code: 317 Module: 255\nError Message: Fault exception\n-- MbedOS Error Info --\n[Simulator: ' + why + ']\n');
  }
  nextTimer() { let d = Infinity; for (const tm of this.timers) if (tm.due < d) d = tm.due; return d; }
  runIsr(fn) {
    let g;
    try {
      g = fn();
      let guard = 0;
      for (;;) {
        this.R.b = SLICE;
        const r = g.next();
        const used = SLICE - this.R.b;
        this.t += Math.max(used, 1) * COST * 0.01;
        if (r.done) break;
        if (r.value && r.value.s !== undefined) this.t += r.value.s;
        if (++guard > 20000) throw new HardFault('Interrupt handler never returns (infinite loop inside an ISR)');
      }
    } catch (e) { this.doFault(e); }
    this.main.wfi = false;
  }
  serviceIrqs() {
    if (!this.irqEnabled) return;
    let n = 0;
    while (this.state === 'running' && n++ < 64) {
      if (this.pending.length) { this.runIsr(this.pending.shift()); continue; }
      let tm = null; for (const x of this.timers) if (x.due <= this.t && (!tm || x.due < tm.due)) tm = x;
      if (!tm) break;
      if (tm.period) tm.due += tm.period; else this.timers.splice(this.timers.indexOf(tm), 1);
      if (tm.period && tm.due <= this.t) tm.due = this.t + tm.period;
      this.runIsr(tm.fn);
    }
  }
  // run the program until virtual time T (µs). wallMs bounds real CPU time spent.
  runUntil(T, wallMs) {
    const deadline = (wallMs === Infinity || wallMs == null) ? Infinity : performance.now() + wallMs;
    let k = 0;
    while (this.t < T) {
      if (this.state !== 'running') { this.t = T; break; }
      this.serviceIrqs();
      if (this.state !== 'running') continue;
      const M = this.main;
      if (M.done || M.wfi || M.sleepUntil > this.t) {
        if (M.wfi && this.pending.length) { M.wfi = false; continue; }
        const wake = M.done || M.wfi ? Infinity : M.sleepUntil;
        const nt = Math.min(wake, this.nextTimer(), T);
        this.t = Math.max(this.t, nt);
        continue;
      }
      if ((++k & 7) === 0 && performance.now() > deadline) return false;
      this.R.b = SLICE;
      let r;
      try { r = M.gen.next(); }
      catch (e) { this.doFault(e); break; }
      const used = SLICE - this.R.b;
      this.t += Math.max(used, 1) * COST;
      if (r.done) { M.done = true; if (!this.note) this.note = 'main() returned'; continue; }
      const v = r.value;
      if (v && v.s !== undefined) M.sleepUntil = this.t + v.s;
      else if (v === WFI) M.wfi = true;
      else if (v === EXIT) { M.done = true; this.note = 'exit() called'; }
    }
    return true;
  }
}

G.MappRuntime = { Machine, Board, HD44780, Ptr, format, cstr, KEYMAP, PIN, PA, PB, PC, PD };
})(typeof window !== 'undefined' ? window : globalThis);
