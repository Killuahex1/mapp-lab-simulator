// engine.js — MAPP C/C++ (mbed subset) compiler: preprocess -> parse -> check -> JS generator code
// Produces diagnostics in the same style as Arm Compiler 6 (armclang) inside Keil uVision.
(function (G) {
'use strict';

/* ======================================================================
 * Diagnostics
 * ==================================================================== */
class CErr extends Error {
  constructor(tok, msg, fatal) { super(msg); this.tok = tok; this.fatal = !!fatal; }
}

/* ======================================================================
 * Lexer
 * ==================================================================== */
const PUNCTS = ['>>=', '<<=', '...', '->', '::', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##', '#', '{', '}', '[', ']', '(', ')', ';', ':', ',', '.',
  '?', '~', '!', '+', '-', '*', '/', '%', '<', '>', '=', '&', '|', '^'];

function stripComments(src) {
  let out = '', i = 0, n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < n && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n && src[i + 1] !== '\n') { out += src[i] + src[i + 1]; i += 2; continue; }
        out += src[i]; i++;
      }
      if (i < n && src[i] === q) { out += q; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const ESC = { n: 10, t: 9, r: 13, '0': 0, a: 7, b: 8, f: 12, v: 11, '\\': 92, "'": 39, '"': 34, '?': 63 };
function readEscapes(s, tok) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (s[i] === '\\') {
      const e = s[i + 1];
      if (e === 'x') { let j = i + 2, h = ''; while (j < s.length && /[0-9a-fA-F]/.test(s[j])) h += s[j++]; out.push(parseInt(h || '0', 16) & 255); i = j - 1; continue; }
      if (/[0-7]/.test(e)) { let j = i + 1, o = ''; while (j < s.length && o.length < 3 && /[0-7]/.test(s[j])) o += s[j++]; out.push(parseInt(o, 8) & 255); i = j - 1; continue; }
      if (e in ESC) { out.push(ESC[e]); i++; continue; }
      out.push(e ? e.charCodeAt(0) : 92); i++; continue;
    }
    if (c > 255) c = 63; // '?'
    out.push(c);
  }
  return out;
}

function lexLine(line, file, lineNo) {
  const toks = [];
  let i = 0; const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    const base = { file, line: lineNo, col: i + 1, ws: i > 0 && /\s/.test(line[i - 1]) };
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1; while (j < n && /\w/.test(line[j])) j++;
      const v = line.slice(i, j);
      // string prefixes u8"..", L".."
      if ((v === 'L' || v === 'u8' || v === 'u' || v === 'U') && (line[j] === '"' || line[j] === "'")) { i = j; continue; }
      toks.push(Object.assign(base, { t: 'id', v })); i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(line[i + 1] || ''))) {
      const m = /^(?:0[xX][0-9a-fA-F']*|0[bB][01']*|\d[\d']*\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)[A-Za-z_0-9]*/.exec(line.slice(i));
      const v = m[0];
      toks.push(Object.assign(base, { t: 'num', v }, parseNumber(v, base))); i += v.length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && line[j] !== c) { if (line[j] === '\\') j++; j++; }
      if (j >= n) throw new CErr(base, c === '"' ? 'missing terminating \'"\' character' : "missing terminating ' character");
      const raw = line.slice(i + 1, j);
      if (c === '"') toks.push(Object.assign(base, { t: 'str', v: line.slice(i, j + 1), bytes: readEscapes(raw) }));
      else {
        const b = readEscapes(raw);
        if (!b.length) throw new CErr(base, 'empty character constant');
        let val = b[0]; if (b.length > 1) { val = 0; for (const x of b) val = (val << 8) | x; }
        toks.push(Object.assign(base, { t: 'chr', v: line.slice(i, j + 1), val, multi: b.length > 1 }));
      }
      i = j + 1; continue;
    }
    let p = null;
    for (const q of PUNCTS) if (line.startsWith(q, i)) { p = q; break; }
    if (p) { toks.push(Object.assign(base, { t: 'p', v: p })); i += p.length; continue; }
    if (c.charCodeAt(0) > 127) throw new CErr(base, 'non-ASCII characters are not allowed outside of literals and identifiers');
    if (c === '\\') { i++; continue; }
    throw new CErr(base, "unexpected character '" + c + "'");
  }
  return toks;
}

function parseNumber(v, tok) {
  let s = v.replace(/'/g, ''), m;
  let suffix = '';
  if ((m = /^(0[xX][0-9a-fA-F]+)([A-Za-z_]*)$/.exec(s))) { s = m[1]; suffix = m[2]; return finInt(parseInt(s, 16), suffix, true); }
  if ((m = /^0[xX]$/.exec(s))) throw new CErr(tok, 'invalid suffix \'x\' on integer constant');
  if ((m = /^(0[bB][01]+)([A-Za-z_]*)$/.exec(s))) { return finInt(parseInt(m[1].slice(2), 2), m[2], true); }
  if ((m = /^(\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)([A-Za-z_]*)$/.exec(s))) {
    const suf = m[2].toLowerCase();
    if (suf && suf !== 'f' && suf !== 'l') {
      if (suf === 'ms' || suf === 's' || suf === 'us') return { val: parseFloat(m[1]), chrono: suf };
      throw new CErr(tok, "invalid suffix '" + m[2] + "' on floating constant");
    }
    return { val: parseFloat(m[1]), fl: true, f32: suf === 'f' };
  }
  if ((m = /^(\d+)([A-Za-z_]*)$/.exec(s))) {
    const oct = m[1].length > 1 && m[1][0] === '0';
    if (oct && /[89]/.test(m[1])) throw new CErr(tok, "invalid digit '" + /[89]/.exec(m[1])[0] + "' in octal constant");
    return finInt(parseInt(m[1], oct ? 8 : 10), m[2], oct);
  }
  throw new CErr(tok, "invalid suffix '" + s.replace(/^[0-9.xXa-fA-FbB]+/, '') + "' on integer constant");
  function finInt(val, suf, hexy) {
    const l = suf.toLowerCase();
    if (l === 'ms' || l === 's' || l === 'us' || l === 'min' || l === 'h') return { val, chrono: l };
    if (!/^(u|l|ul|lu|ll|ull|llu)?$/.test(l)) throw new CErr(tok, "invalid suffix '" + suf + "' on integer constant");
    let uns = l.includes('u');
    if (!uns && val > 0x7FFFFFFF && val <= 0xFFFFFFFF && hexy) uns = true;
    return { val, uns, big: val > 0xFFFFFFFF };
  }
}

/* ======================================================================
 * Preprocessor
 * ==================================================================== */
const SYS_HEADERS = new Set(['mbed.h', 'stdio.h', 'stdlib.h', 'string.h', 'stdint.h', 'stdbool.h', 'math.h', 'ctype.h',
  'rtos.h', 'cstdio', 'cstdlib', 'cstring', 'cstdint', 'cmath', 'cctype', 'chrono', 'stddef.h', 'limits.h', 'time.h',
  'platform/mbed_thread.h', 'drivers/DigitalOut.h', 'drivers/DigitalIn.h', 'mbed_wait_api.h', 'iostream']);

class Preprocessor {
  constructor(fs) {
    this.fs = fs; this.defs = new Map(); this.out = []; this.includes = []; this.diags = [];
    this.headers = new Set(); this.once = new Set(); this.depth = 0;
    const pre = { __ARM_FP: '14', __cplusplus: '201703L', __ARMCC_VERSION: '6220000', __arm__: '1', TARGET_NUCLEO_F103RB: '1', NULL: '0', __STDC__: '1' };
    for (const k in pre) this.defs.set(k, { name: k, body: lexLine(pre[k], '<built-in>', 1), builtin: true });
  }
  defineMbed() {
    const m = { MBED_MAJOR_VERSION: '6', MBED_MINOR_VERSION: '16', MBED_PATCH_VERSION: '0', MBED_VERSION: '61600', DEVICE_SERIAL: '1' };
    for (const k in m) if (!this.defs.has(k)) this.defs.set(k, { name: k, body: lexLine(m[k], '<built-in>', 1), builtin: true });
  }
  run(path, text, display) { this.doFile(path, text, display); return this.out; }

  doFile(path, text, display) {
    if (this.depth > 40) throw new CErr({ file: display, line: 1, col: 1 }, '#include nested too deeply', true);
    this.depth++;
    const src = stripComments(text.replace(/\r\n?/g, '\n'));
    const raw = src.split('\n');
    const cond = []; // {active, taken, tok, sawElse}
    let pending = [];
    const flush = () => { if (pending.length) { const e = this.expand(pending, new Set()); for (const t of e) this.out.push(t); pending = []; } };
    const isActive = () => cond.every(c => c.active);
    for (let li = 0; li < raw.length; li++) {
      let line = raw[li]; const lineNo = li + 1;
      while (/\\\s*$/.test(line) && li + 1 < raw.length) { line = line.replace(/\\\s*$/, ' ') + raw[++li]; }
      let toks;
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('#') && !isActive()) continue;
      try { toks = lexLine(line, display, lineNo); }
      catch (e) { if (!isActive()) continue; throw e; }
      if (!toks.length) continue;
      for (const t of toks) t.path = path;
      if (toks[0].t === 'p' && toks[0].v === '#') {
        flush();
        const d = toks[1];
        if (!d) continue; // null directive
        const name = d.v;
        if (name === 'if' || name === 'ifdef' || name === 'ifndef') {
          if (!isActive()) { cond.push({ active: false, taken: true, tok: d }); continue; }
          let v;
          if (name === 'ifdef') v = !!(toks[2] && this.defs.has(toks[2].v));
          else if (name === 'ifndef') v = !(toks[2] && this.defs.has(toks[2].v));
          else v = this.evalIf(toks.slice(2), d);
          cond.push({ active: v, taken: v, tok: d });
          continue;
        }
        if (name === 'elif') {
          const c = cond[cond.length - 1]; if (!c) throw new CErr(d, '#elif without #if');
          const parentActive = cond.slice(0, -1).every(x => x.active);
          if (c.taken || !parentActive) c.active = false; else { c.active = this.evalIf(toks.slice(2), d); c.taken = c.active; }
          continue;
        }
        if (name === 'else') {
          const c = cond[cond.length - 1]; if (!c) throw new CErr(d, '#else without #if');
          const parentActive = cond.slice(0, -1).every(x => x.active);
          c.active = parentActive && !c.taken; c.taken = true; continue;
        }
        if (name === 'endif') { if (!cond.length) throw new CErr(d, '#endif without #if'); cond.pop(); continue; }
        if (!isActive()) continue;
        if (name === 'define') this.doDefine(toks, d);
        else if (name === 'undef') { if (toks[2]) this.defs.delete(toks[2].v); }
        else if (name === 'include') this.doInclude(toks, d, path);
        else if (name === 'pragma') { if (toks[2] && toks[2].v === 'once') this.once.add(path); }
        else if (name === 'error') throw new CErr(d, line.replace(/^\s*#\s*error\s*/, ''), false);
        else if (name === 'warning') this.diags.push({ tok: d, msg: line.replace(/^\s*#\s*warning\s*/, '') + ' [-W#warnings]', kind: 'warning' });
        else if (name === 'line') { }
        else throw new CErr(d, 'invalid preprocessing directive');
        continue;
      }
      pending.push(...toks);
    }
    flush();
    if (cond.length) throw new CErr(cond[cond.length - 1].tok, 'unterminated conditional directive');
    this.depth--;
  }

  doDefine(toks, d) {
    const nm = toks[2];
    if (!nm || nm.t !== 'id') throw new CErr(d, 'macro name missing');
    let params = null, i = 3;
    if (toks[3] && toks[3].v === '(' && !toks[3].ws && toks[3].col === nm.col + nm.v.length) {
      params = []; i = 4;
      while (i < toks.length && toks[i].v !== ')') { if (toks[i].v !== ',') params.push(toks[i].v); i++; }
      if (i >= toks.length) throw new CErr(toks[3], "missing ')' in macro parameter list");
      i++;
    }
    const body = toks.slice(i);
    const old = this.defs.get(nm.v);
    if (old && !old.builtin && old.body.map(t => t.v).join(' ') !== body.map(t => t.v).join(' '))
      this.diags.push({ tok: nm, msg: "'" + nm.v + "' macro redefined [-Wmacro-redefined]", kind: 'warning' });
    this.defs.set(nm.v, { name: nm.v, params, body });
  }

  doInclude(toks, d, path) {
    let name, angled = false, t = toks[2];
    if (!t) throw new CErr(d, 'expected "FILENAME" or <FILENAME>');
    if (t.t === 'str') name = String.fromCharCode(...t.bytes);
    else if (t.v === '<') { angled = true; name = ''; let i = 3; while (i < toks.length && toks[i].v !== '>') { name += toks[i].v; i++; } }
    else throw new CErr(t, 'expected "FILENAME" or <FILENAME>');
    const low = name.toLowerCase();
    if (SYS_HEADERS.has(low) || SYS_HEADERS.has(name)) {
      this.headers.add(low);
      if (low === 'mbed.h' || low === 'rtos.h') this.defineMbed();
      this.includes.push({ name, sys: true });
      return;
    }
    const r = this.fs.resolveInclude(name, path, angled);
    if (!r) throw new CErr(t, "'" + name + "' file not found", true);
    this.includes.push({ name, path: r.path });
    if (this.once.has(r.path)) return;
    this.doFile(r.path, r.text, r.display || name);
  }

  evalIf(toks, d) {
    const t2 = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'id' && t.v === 'defined') {
        let n = toks[i + 1];
        if (n && n.v === '(') { n = toks[i + 2]; i += 3; } else i += 1;
        t2.push({ t: 'num', v: (n && this.defs.has(n.v)) ? '1' : '0', val: (n && this.defs.has(n.v)) ? 1 : 0, file: t.file, line: t.line, col: t.col });
        continue;
      }
      t2.push(t);
    }
    const ex = this.expand(t2, new Set());
    let js = '';
    for (const t of ex) {
      if (t.t === 'num') js += ' ' + (t.val || 0);
      else if (t.t === 'chr') js += ' ' + t.val;
      else if (t.t === 'id') js += (t.v === 'true' ? ' 1' : ' 0');
      else if (t.t === 'p' && /^(\(|\)|!|~|\*|\/|%|\+|-|<<|>>|<|>|<=|>=|==|!=|&|\^|\||&&|\|\||\?|:)$/.test(t.v)) js += ' ' + t.v;
      else throw new CErr(t, 'invalid token at start of a preprocessor expression');
    }
    if (!js.trim()) throw new CErr(d, '#if with no expression');
    try { return !!(new Function('return (' + js + ');'))(); }
    catch (e) { throw new CErr(d, 'invalid preprocessor expression'); }
  }

  expand(toks, disabled) {
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk.t === 'id' && !tk.noexp && this.defs.has(tk.v)) {
        if (disabled.has(tk.v)) { out.push(Object.assign({}, tk, { noexp: true })); continue; }
        const m = this.defs.get(tk.v);
        if (m.params) {
          const nx = toks[i + 1];
          if (!nx || nx.v !== '(') { out.push(tk); continue; }
          let depth = 0, args = [[]], j;
          for (j = i + 1; j < toks.length; j++) {
            const x = toks[j];
            if (x.t === 'p' && x.v === '(') { if (depth++ > 0) args[args.length - 1].push(x); }
            else if (x.t === 'p' && x.v === ')') { if (--depth === 0) break; args[args.length - 1].push(x); }
            else if (x.t === 'p' && x.v === ',' && depth === 1) args.push([]);
            else args[args.length - 1].push(x);
          }
          if (j >= toks.length) throw new CErr(tk, 'unterminated function-like macro invocation');
          if (args.length === 1 && !args[0].length && m.params.length === 0) args = [];
          if (args.length !== m.params.length && !(m.params.length === 1 && args.length === 1))
            throw new CErr(tk, (args.length > m.params.length ? 'too many' : 'too few') + ' arguments provided to function-like macro invocation');
          const body = [];
          for (let k = 0; k < m.body.length; k++) {
            const b = m.body[k];
            if (b.v === '#' && m.body[k + 1] && m.params.includes(m.body[k + 1].v)) {
              const a = args[m.params.indexOf(m.body[k + 1].v)] || [];
              const s = a.map(x => x.v).join(' ');
              body.push({ t: 'str', v: JSON.stringify(s), bytes: [...s].map(ch => ch.charCodeAt(0)) }); k++; continue;
            }
            const pi = b.t === 'id' ? m.params.indexOf(b.v) : -1;
            if (pi >= 0) body.push(...this.expand(args[pi] || [], disabled));
            else body.push(b);
          }
          const nd = new Set(disabled); nd.add(tk.v);
          out.push(...this.expand(this.paste(body).map(b => reloc(b, tk)), nd));
          i = j; continue;
        }
        const nd = new Set(disabled); nd.add(tk.v);
        out.push(...this.expand(this.paste(m.body).map(b => reloc(b, tk)), nd));
        continue;
      }
      out.push(tk);
    }
    return out;
  }
  paste(body) {
    if (!body.some(b => b.v === '##')) return body;
    const r = [];
    for (let i = 0; i < body.length; i++) {
      if (body[i].v === '##' && r.length && body[i + 1]) {
        const a = r.pop(), b = body[++i];
        const t = lexLine(a.v + b.v, a.file, a.line);
        r.push(...t);
      } else r.push(body[i]);
    }
    return r;
  }
}
function reloc(b, at) {
  return Object.assign({}, b, { file: at.file, line: at.line, col: at.col, path: at.path, macro: at.v });
}

/* ======================================================================
 * Types
 * ==================================================================== */
function I(bits, u, name) { return { k: 'int', bits, u, name }; }
const T = {
  void: { k: 'void', name: 'void' }, bool: { k: 'bool', name: 'bool', bits: 8, u: true },
  char: I(8, true, 'char'), schar: I(8, false, 'signed char'), uchar: I(8, true, 'unsigned char'),
  short: I(16, false, 'short'), ushort: I(16, true, 'unsigned short'), int: I(32, false, 'int'), uint: I(32, true, 'unsigned int'),
  long: I(32, false, 'long'), ulong: I(32, true, 'unsigned long'), llong: I(64, false, 'long long'), ullong: I(64, true, 'unsigned long long'),
  float: { k: 'float', bits: 32, name: 'float' }, double: { k: 'float', bits: 64, name: 'double' },
  dur: { k: 'dur', name: 'std::chrono::milliseconds' },
};
const TYPEDEFS = {
  uint8_t: I(8, true, 'uint8_t'), int8_t: I(8, false, 'int8_t'), uint16_t: I(16, true, 'uint16_t'), int16_t: I(16, false, 'int16_t'),
  uint32_t: I(32, true, 'uint32_t'), int32_t: I(32, false, 'int32_t'), uint64_t: I(64, true, 'uint64_t'), int64_t: I(64, false, 'int64_t'),
  size_t: I(32, true, 'size_t'), PinName: I(32, false, 'PinName'), PortName: I(32, false, 'PortName'), PinMode: I(32, false, 'PinMode'),
  byte: I(8, true, 'byte'), uint: I(32, true, 'uint'),
};
const ptr = (to) => ({ k: 'ptr', to, name: tname(to) + ' *' });
const arr = (of, n) => ({ k: 'arr', of, n, name: tname(of) + ' [' + (n == null ? '' : n) + ']' });
function tname(t) {
  if (!t) return '?';
  if (t.k === 'ptr') return tname(t.to) + ' *';
  if (t.k === 'arr') return tname(t.of) + ' [' + (t.n == null ? '' : t.n) + ']';
  if (t.k === 'obj') return 'mbed::' + t.cls;
  if (t.k === 'fn') return tname(t.ret) + ' (' + t.params.map(tname).join(', ') + ')';
  if (t.k === 'fnptr') return 'void (*)()';
  return (t.cst ? 'const ' : '') + t.name;
}
const isIntT = t => t && (t.k === 'int' || t.k === 'bool');
const isArith = t => t && (t.k === 'int' || t.k === 'bool' || t.k === 'float');
const isPtrish = t => t && (t.k === 'ptr' || t.k === 'arr');
function sizeOf(t) {
  if (t.k === 'int' || t.k === 'bool') return t.bits / 8;
  if (t.k === 'float') return t.bits / 8;
  if (t.k === 'arr') return (t.n || 0) * sizeOf(t.of);
  if (t.k === 'obj') return { DigitalOut: 8, DigitalIn: 8, PortOut: 16, PortIn: 16, BusOut: 72, BusIn: 72 }[t.cls] || 24;
  return 4;
}
function promote(t) {
  if (t.k === 'bool') return T.int;
  if (t.k === 'int' && t.bits < 32) return T.int;
  return t;
}
function arith(a, b) {
  if (a.k === 'float' || b.k === 'float') return ((a.k === 'float' && a.bits === 64) || (b.k === 'float' && b.bits === 64)) ? T.double : T.float;
  a = promote(a); b = promote(b);
  if (a.bits === 64 || b.bits === 64) return (a.u && a.bits === 64) || (b.u && b.bits === 64) ? T.ullong : T.llong;
  if (a.u || b.u) return T.uint;
  return T.int;
}
function wrapInt(code, t) {
  if (t.k === 'bool') return '((' + code + ')?1:0)';
  if (t.k !== 'int') return code;
  if (t.bits === 8) return t.u ? '((' + code + ')&255)' : '((' + code + ')<<24>>24)';
  if (t.bits === 16) return t.u ? '((' + code + ')&65535)' : '((' + code + ')<<16>>16)';
  if (t.bits === 32) return t.u ? '((' + code + ')>>>0)' : '((' + code + ')|0)';
  return code;
}
function constWrap(v, t) {
  if (t.k === 'bool') return v ? 1 : 0;
  if (t.k === 'float') return t.bits === 32 ? Math.fround(v) : v;
  if (t.k !== 'int') return v;
  v = Math.trunc(v);
  if (t.bits === 8) return t.u ? (v & 255) : (v << 24 >> 24);
  if (t.bits === 16) return t.u ? (v & 65535) : (v << 16 >> 16);
  if (t.bits === 32) return t.u ? (v >>> 0) : (v | 0);
  return v;
}

/* ======================================================================
 * mbed builtins
 * ==================================================================== */
const PINS = {};
['A', 'B', 'C', 'D'].forEach((p, pi) => { for (let i = 0; i < 16; i++) PINS['P' + p + '_' + i] = pi * 16 + i; });
Object.assign(PINS, { LED1: 5, LED2: 5, LED_RED: 5, BUTTON1: 45, USER_BUTTON: 45, NC: -1, CONSOLE_TX: 2, CONSOLE_RX: 3, USBTX: 2, USBRX: 3,
  A0: 0, A1: 1, A2: 4, A3: 16, A4: 33, A5: 32, D0: 3, D1: 2, D2: 10, D3: 19, D4: 21, D5: 20, D6: 26, D7: 8, D8: 9, D9: 39, D10: 22, D11: 7, D12: 6, D13: 5, D14: 25, D15: 24 });
const CONSTS = Object.assign({}, PINS, { PortA: 0, PortB: 1, PortC: 2, PortD: 3, PullNone: 0, PullUp: 1, PullDown: 2, OpenDrain: 3, PullDefault: 0,
  EXIT_SUCCESS: 0, EXIT_FAILURE: 1, RAND_MAX: 0x7FFFFFFF, osWaitForever: 0xFFFFFFFF });
const REG_BLOCKS = new Set(['RCC', 'GPIOA', 'GPIOB', 'GPIOC', 'GPIOD', 'AFIO', 'EXTI', 'TIM1', 'TIM2', 'TIM3', 'TIM4', 'NVIC', 'SysTick', 'USART1', 'USART2', 'USART3', 'ADC1', 'ADC2', 'FLASH', 'PWR', 'SCB', 'DMA1', 'I2C1', 'SPI1']);

// class model: ctor = list of param kinds, methods: name -> {params, ret, code(obj,args)}
const M = (params, ret, js) => ({ params, ret, js });
const CLASSES = {
  DigitalOut: { ctor: { min: 1, max: 2, kinds: ['pin', 'int'] }, read: 'read', write: 'write', methods: {
    write: M([T.int], T.void, 'write'), read: M([], T.int, 'read'), is_connected: M([], T.int, 'is_connected') } },
  DigitalIn: { ctor: { min: 1, max: 2, kinds: ['pin', 'mode'] }, read: 'read', methods: {
    read: M([], T.int, 'read'), mode: M([T.int], T.void, 'mode'), is_connected: M([], T.int, 'is_connected') } },
  DigitalInOut: { ctor: { min: 1, max: 1, kinds: ['pin'] }, read: 'read', write: 'write', methods: {
    write: M([T.int], T.void, 'write'), read: M([], T.int, 'read'), output: M([], T.void, 'output'), input: M([], T.void, 'input'), mode: M([T.int], T.void, 'mode') } },
  PortOut: { ctor: { min: 1, max: 2, kinds: ['port', 'int'] }, read: 'read', write: 'write', methods: {
    write: M([T.int], T.void, 'write'), read: M([], T.int, 'read') } },
  PortIn: { ctor: { min: 1, max: 2, kinds: ['port', 'int'] }, read: 'read', methods: {
    read: M([], T.int, 'read'), mode: M([T.int], T.void, 'mode') } },
  BusOut: { ctor: { min: 1, max: 16, kinds: 'pins' }, read: 'read', write: 'write', methods: {
    write: M([T.int], T.void, 'write'), read: M([], T.int, 'read'), mask: M([], T.int, 'mask') } },
  BusIn: { ctor: { min: 1, max: 16, kinds: 'pins' }, read: 'read', methods: {
    read: M([], T.int, 'read'), mode: M([T.int], T.void, 'mode'), mask: M([], T.int, 'mask') } },
  InterruptIn: { ctor: { min: 1, max: 2, kinds: ['pin', 'mode'] }, read: 'read', methods: {
    read: M([], T.int, 'read'), mode: M([T.int], T.void, 'mode'), rise: M(['fn'], T.void, 'rise'), fall: M(['fn'], T.void, 'fall'),
    enable_irq: M([], T.void, 'enable_irq'), disable_irq: M([], T.void, 'disable_irq') } },
  PwmOut: { ctor: { min: 1, max: 1, kinds: ['pin'] }, read: 'read', write: 'write', rtype: T.float, methods: {
    write: M([T.float], T.void, 'write'), read: M([], T.float, 'read'), period: M([T.float], T.void, 'period'), period_ms: M([T.int], T.void, 'period_ms'),
    period_us: M([T.int], T.void, 'period_us'), pulsewidth: M([T.float], T.void, 'pulsewidth'), pulsewidth_ms: M([T.int], T.void, 'pulsewidth_ms'),
    pulsewidth_us: M([T.int], T.void, 'pulsewidth_us'), suspend: M([], T.void, 'suspend'), resume: M([], T.void, 'resume') } },
  AnalogIn: { ctor: { min: 1, max: 2, kinds: ['pin', 'float'] }, read: 'read', rtype: T.float, methods: {
    read: M([], T.float, 'read'), read_u16: M([], T.ushort, 'read_u16'), read_voltage: M([], T.float, 'read_voltage'),
    set_reference_voltage: M([T.float], T.void, 'set_reference_voltage'), get_reference_voltage: M([], T.float, 'get_reference_voltage') } },
  AnalogOut: { ctor: { min: 1, max: 1, kinds: ['pin'] }, read: 'read', write: 'write', rtype: T.float, methods: {
    write: M([T.float], T.void, 'write'), read: M([], T.float, 'read'), write_u16: M([T.int], T.void, 'write_u16') } },
  Timer: { ctor: { min: 0, max: 0, kinds: [] }, methods: {
    start: M([], T.void, 'start'), stop: M([], T.void, 'stop'), reset: M([], T.void, 'reset'), read: M([], T.float, 'read'),
    read_ms: M([], T.int, 'read_ms'), read_us: M([], T.int, 'read_us'), elapsed_time: M([], 'dur', 'elapsed_time') } },
  Ticker: { ctor: { min: 0, max: 0, kinds: [] }, methods: {
    attach: M(['fn', 'time'], T.void, 'attach'), attach_us: M(['fn', T.int], T.void, 'attach_us'), detach: M([], T.void, 'detach') } },
  Timeout: { ctor: { min: 0, max: 0, kinds: [] }, methods: {
    attach: M(['fn', 'time'], T.void, 'attach'), attach_us: M(['fn', T.int], T.void, 'attach_us'), detach: M([], T.void, 'detach') } },
};
CLASSES.LowPowerTicker = CLASSES.Ticker; CLASSES.LowPowerTimeout = CLASSES.Timeout; CLASSES.LowPowerTimer = CLASSES.Timer;
const STR = ptr(T.char);
const BF = (params, ret, code, o) => Object.assign({ params, ret, code }, o || {});
const BUILTIN_FUNCS = {
  // mbed
  thread_sleep_for: BF([T.uint], T.void, a => '(yield R.sleepMs(' + a[0] + '))', { mbed: true }),
  wait_us: BF([T.int], T.void, a => '(yield R.sleepUs(' + a[0] + '))', { mbed: true }),
  wait_ns: BF([T.uint], T.void, a => '(yield R.sleepUs((' + a[0] + ')/1000))', { mbed: true }),
  wait_ms: BF([T.int], T.void, a => '(yield R.sleepMs(' + a[0] + '))', { mbed: true, deprecated: "'wait_ms' is deprecated: 'wait_ms' is deprecated in favor of explicit sleep functions. To sleep, 'wait_ms' should be replaced by 'ThisThread::sleep_for' as it is not an RTOS function. [since mbed-os-5.14] [-Wdeprecated-declarations]" }),
  wait: BF([T.float], T.void, a => '(yield R.sleepUs((' + a[0] + ')*1e6))', { mbed: true, deprecated: "'wait' is deprecated: 'wait' is deprecated in favor of explicit sleep functions. To sleep, 'wait' should be replaced by 'ThisThread::sleep_for'. [since mbed-os-5.14] [-Wdeprecated-declarations]" }),
  'ThisThread::sleep_for': BF(['time'], T.void, a => '(yield R.sleepUs(' + a[0] + '))', { mbed: true }),
  'rtos::ThisThread::sleep_for': BF(['time'], T.void, a => '(yield R.sleepUs(' + a[0] + '))', { mbed: true }),
  'ThisThread::yield': BF([], T.void, () => '(yield 0)', { mbed: true }),
  callback: BF(['fn'], 'fn', a => a[0], { mbed: true }),
  __disable_irq: BF([], T.void, () => 'R.irq(0)', { mbed: true }),
  __enable_irq: BF([], T.void, () => 'R.irq(1)', { mbed: true }),
  __WFI: BF([], T.void, () => '(yield R.WFI)', { mbed: true }),
  __WFE: BF([], T.void, () => '(yield R.WFI)', { mbed: true }),
  __NOP: BF([], T.void, () => '0', { mbed: true }),
  NVIC_EnableIRQ: BF([T.int], T.void, a => 'R.nvic(' + a[0] + ',1)', { mbed: true }),
  NVIC_DisableIRQ: BF([T.int], T.void, a => 'R.nvic(' + a[0] + ',0)', { mbed: true }),
  NVIC_SetVector: BF([T.int, T.uint], T.void, a => 'R.setVector(' + a[0] + ',' + a[1] + ')', { mbed: true }),
  NVIC_SetPriority: BF([T.int, T.uint], T.void, () => '0', { mbed: true }),
  NVIC_ClearPendingIRQ: BF([T.int], T.void, () => '0', { mbed: true }),
  HAL_NVIC_EnableIRQ: BF([T.int], T.void, a => 'R.nvic(' + a[0] + ',1)', { mbed: true }),
  HAL_NVIC_SetPriority: BF([T.int, T.uint, T.uint], T.void, () => '0', { mbed: true }),
  HAL_Delay: BF([T.uint], T.void, a => '(yield R.sleepMs(' + a[0] + '))', { mbed: true }),
  us_ticker_read: BF([], T.uint, () => 'R.usTicker()', { mbed: true }),
  // stdio
  printf: BF([STR], T.int, a => 'R.printf(' + a.join(',') + ')', { variadic: true, std: 'stdio' }),
  sprintf: BF([STR, STR], T.int, a => 'R.sprintf(' + a.join(',') + ')', { variadic: true, std: 'stdio' }),
  snprintf: BF([STR, T.uint, STR], T.int, a => 'R.snprintf(' + a.join(',') + ')', { variadic: true, std: 'stdio' }),
  puts: BF([STR], T.int, a => 'R.puts(' + a[0] + ')', { std: 'stdio' }),
  putchar: BF([T.int], T.int, a => 'R.putchar(' + a[0] + ')', { std: 'stdio' }),
  fflush: BF(['any'], T.int, () => '0', { std: 'stdio' }),
  // string
  strlen: BF([STR], T.uint, a => 'R.strlen(' + a[0] + ')', { std: 'string' }),
  strcpy: BF([STR, STR], STR, a => 'R.strcpy(' + a[0] + ',' + a[1] + ')', { std: 'string' }),
  strncpy: BF([STR, STR, T.uint], STR, a => 'R.strncpy(' + a.join(',') + ')', { std: 'string' }),
  strcat: BF([STR, STR], STR, a => 'R.strcat(' + a[0] + ',' + a[1] + ')', { std: 'string' }),
  strcmp: BF([STR, STR], T.int, a => 'R.strcmp(' + a[0] + ',' + a[1] + ')', { std: 'string' }),
  strncmp: BF([STR, STR, T.uint], T.int, a => 'R.strcmp(' + a.join(',') + ')', { std: 'string' }),
  memset: BF([STR, T.int, T.uint], STR, a => 'R.memset(' + a.join(',') + ')', { std: 'string' }),
  memcpy: BF([STR, STR, T.uint], STR, a => 'R.memcpy(' + a.join(',') + ')', { std: 'string' }),
  // stdlib / math / ctype
  abs: BF([T.int], T.int, a => 'Math.abs(' + a[0] + ')|0', { std: 'stdlib' }),
  rand: BF([], T.int, () => 'R.rand()', { std: 'stdlib' }),
  srand: BF([T.uint], T.void, a => 'R.srand(' + a[0] + ')', { std: 'stdlib' }),
  atoi: BF([STR], T.int, a => 'R.atoi(' + a[0] + ')', { std: 'stdlib' }),
  exit: BF([T.int], T.void, () => '(yield R.EXIT)', { std: 'stdlib' }),
  sqrt: BF([T.double], T.double, a => 'Math.sqrt(' + a[0] + ')', { std: 'math' }),
  pow: BF([T.double, T.double], T.double, a => 'Math.pow(' + a[0] + ',' + a[1] + ')', { std: 'math' }),
  fabs: BF([T.double], T.double, a => 'Math.abs(' + a[0] + ')', { std: 'math' }),
  floor: BF([T.double], T.double, a => 'Math.floor(' + a[0] + ')', { std: 'math' }),
  ceil: BF([T.double], T.double, a => 'Math.ceil(' + a[0] + ')', { std: 'math' }),
  round: BF([T.double], T.double, a => 'Math.round(' + a[0] + ')', { std: 'math' }),
  sin: BF([T.double], T.double, a => 'Math.sin(' + a[0] + ')', { std: 'math' }),
  cos: BF([T.double], T.double, a => 'Math.cos(' + a[0] + ')', { std: 'math' }),
  toupper: BF([T.int], T.int, a => 'R.toupper(' + a[0] + ')', { std: 'ctype' }),
  tolower: BF([T.int], T.int, a => 'R.tolower(' + a[0] + ')', { std: 'ctype' }),
  isdigit: BF([T.int], T.int, a => '+(((' + a[0] + ')>=48)&&((' + a[0] + ')<=57))', { std: 'ctype' }),
};
const BUILTIN_VARS = { SystemCoreClock: { t: T.uint, js: 'R.SystemCoreClock' } };

function editDist(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  const d = []; for (let i = 0; i <= m; i++) { d[i] = [i]; }
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? (a[i - 1] === b[j - 1] ? 0 : 0.5) : 1));
  return d[m][n];
}

/* ======================================================================
 * Parser
 * ==================================================================== */
const TYPE_KW = new Set(['void', 'bool', 'char', 'short', 'int', 'long', 'signed', 'unsigned', 'float', 'double',
  'const', 'volatile', 'static', 'extern', 'inline', 'register', 'constexpr', 'typedef', 'auto', 'struct', 'enum', 'union', 'class']);
const STMT_KW = new Set(['if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'sizeof', 'true', 'false', 'nullptr', 'new', 'delete', 'this', 'using', 'namespace', 'template', 'typename', 'operator', 'public', 'private', 'protected', 'virtual']);

function unknownType(name) {
  let best = null, bd = 3;
  for (const c of Object.keys(CLASSES).concat(Object.keys(TYPEDEFS), ['unsigned', 'char', 'int', 'void', 'bool', 'float', 'double', 'short', 'long', 'const', 'static'])) {
    const d = editDist(name, c); if (d < bd && d <= 2) { bd = d; best = c; }
  }
  return "unknown type name '" + name + "'" + (best ? "; did you mean '" + best + "'?" : '');
}
class Parser {
  constructor(toks, ctx) {
    this.toks = toks; this.i = 0; this.ctx = ctx;
    const last = toks[toks.length - 1];
    this.eof = { t: 'eof', v: '<eof>', file: last ? last.file : '', line: last ? last.line : 1, col: last ? last.col + last.v.length : 1, path: last && last.path };
    this.typedefs = new Map(); this.enumConsts = new Map();
  }
  peek(o) { return this.toks[this.i + (o || 0)] || this.eof; }
  next() { return this.toks[this.i++] || this.eof; }
  prev() { return this.toks[this.i - 1] || this.toks[0] || this.eof; }
  is(v, o) { const t = this.peek(o); return t.t !== 'str' && t.t !== 'chr' && t.t !== 'num' && t.v === v; }
  accept(v) { if (this.is(v)) { this.i++; return true; } return false; }
  afterPrev() { const p = this.prev(); return { file: p.file, line: p.line, col: p.col + p.v.length, path: p.path }; }
  expect(v, what) {
    if (this.is(v)) return this.next();
    if (v === ';') throw new CErr(this.afterPrev(), "expected ';'" + (what ? ' ' + what : ''));
    if (v === ')' || v === ']' || v === '}') throw new CErr(this.peek(), "expected '" + v + "'");
    throw new CErr(this.peek(), "expected '" + v + "'" + (what ? ' ' + what : ''));
  }
  isTypeName(name) { return TYPEDEFS[name] || this.typedefs.has(name) || CLASSES[name] || (this.ctx.knownEnums && this.ctx.knownEnums.has(name)); }
  isTypeStart(o) {
    const t = this.peek(o || 0);
    if (t.t !== 'id') return false;
    if (TYPE_KW.has(t.v)) return true;
    if (this.isTypeName(t.v)) {
      // "DigitalOut" followed by '::' is not a type start
      if (this.is('::', (o || 0) + 1)) return false;
      return true;
    }
    if ((t.v === 'std' || t.v === 'mbed') && this.is('::', (o || 0) + 1) && this.isTypeName(this.peek((o || 0) + 2).v)) return true;
    return false;
  }

  parseTU() {
    const items = [];
    while (this.peek().t !== 'eof') {
      if (this.accept(';')) continue;
      if (this.is('using')) { while (!this.is(';') && this.peek().t !== 'eof') this.next(); this.expect(';'); continue; }
      if (this.is('namespace')) throw new CErr(this.peek(), "namespaces are not supported by the MAPP simulator");
      if (this.is('template')) throw new CErr(this.peek(), "templates are not supported by the MAPP simulator");
      if (this.is('}')) throw new CErr(this.peek(), "extraneous closing brace ('}')");
      const t = this.peek();
      if (!this.isTypeStart()) {
        if (t.t === 'id' && !STMT_KW.has(t.v) && this.peek(1).t === 'id') throw new CErr(t, unknownType(t.v));
        if (t.t === 'id' && !STMT_KW.has(t.v) && this.is('(', 1)) throw new CErr(t, 'C++ requires a type specifier for all declarations');
        if (t.t === 'id' && !STMT_KW.has(t.v) && (this.is('=', 1) || this.is(';', 1) || this.is('[', 1))) throw new CErr(t, unknownType(t.v));
        throw new CErr(t, 'expected unqualified-id');
      }
      const start = this.i;
      try { items.push(...this.parseDecl(true)); }
      catch (e) {
        if (!(e instanceof CErr) || e.fatal) throw e;
        this.recover(e, start, true);
      }
    }
    return items;
  }
  recover(e, start, top) {
    this.errors = this.errors || [];
    this.errors.push(e);
    if (this.errors.length > 20) throw new CErr(e.tok, 'too many errors emitted, stopping now [-ferror-limit=]', true);
    if (this.i <= start) this.i = start + 1;
    // skip to the end of the broken statement / declaration
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (t.t === 'eof') return;
      if (t.t === 'p') {
        if (t.v === '{') depth++;
        else if (t.v === '}') { if (depth === 0) { if (top) this.next(); return; } depth--; if (depth === 0 && top) { this.next(); if (this.is(';')) this.next(); return; } }
        else if (t.v === ';' && depth === 0) { this.next(); return; }
      }
      // a new line that starts a statement keyword is a good resync point
      if (depth === 0 && this.i > start + 1 && t.t === 'id' && (t.line !== this.prev().line) && (STMT_KW.has(t.v) || this.isTypeStart()) && !['else', 'case', 'default', 'sizeof', 'true', 'false', 'nullptr'].includes(t.v)) return;
      this.next();
    }
  }

  parseSpec() {
    const st = this.peek();
    const s = { tok: st, storage: null, cst: false, vol: false, typedef: false, inline: false };
    let signed = null, sh = 0, lng = 0, base = null, any = false;
    for (;;) {
      const t = this.peek();
      if (t.t !== 'id') break;
      const v = t.v;
      if (v === 'const' || v === 'constexpr') { s.cst = true; }
      else if (v === 'volatile') s.vol = true;
      else if (v === 'static' || v === 'extern' || v === 'register' || v === 'auto') { if (v === 'auto' && !base && !signed && !sh && !lng && this.peek(1).t === 'id') { base = 'auto'; } else s.storage = (v === 'register' || v === 'auto') ? s.storage : v; }
      else if (v === 'inline') s.inline = true;
      else if (v === 'typedef') s.typedef = true;
      else if (v === 'unsigned') signed = 'u';
      else if (v === 'signed') signed = 's';
      else if (v === 'short') sh++;
      else if (v === 'long') lng++;
      else if (v === 'struct' || v === 'union' || v === 'class') throw new CErr(t, v + ' types are not supported by the MAPP simulator (use plain variables/arrays)');
      else if (v === 'enum') { if (base) break; this.next(); base = this.parseEnum(t); any = true; continue; }
      else if (['void', 'bool', 'char', 'int', 'float', 'double'].includes(v)) { if (base) throw new CErr(t, "cannot combine with previous '" + (typeof base === 'string' ? base : 'enum') + "' declaration specifier"); base = v; }
      else if ((v === 'std' || v === 'mbed') && this.is('::', 1) && this.isTypeName(this.peek(2).v)) { this.next(); this.next(); continue; }
      else if (!base && !signed && !sh && !lng && this.isTypeName(v) && !this.is('::', 1)) { base = v; }
      else break;
      any = true; this.next();
    }
    if (!any) return null;
    let type;
    if (base && typeof base === 'object') type = base;
    else if (base === 'auto') type = { k: 'auto', name: 'auto' };
    else if (base && CLASSES[base]) type = { k: 'obj', cls: base, name: base };
    else if (base && TYPEDEFS[base]) type = TYPEDEFS[base];
    else if (base && this.typedefs.has(base)) type = this.typedefs.get(base);
    else if (base && this.ctx.knownEnums && this.ctx.knownEnums.has(base)) type = T.int;
    else if (base === 'void') type = T.void;
    else if (base === 'bool') type = T.bool;
    else if (base === 'float') type = T.float;
    else if (base === 'double') type = T.double;
    else if (base === 'char') type = signed === 'u' ? T.uchar : signed === 's' ? T.schar : T.char;
    else if (sh) type = signed === 'u' ? T.ushort : T.short;
    else if (lng >= 2) type = signed === 'u' ? T.ullong : T.llong;
    else if (lng === 1) type = signed === 'u' ? T.ulong : T.long;
    else if (base === 'int' || signed) type = signed === 'u' ? T.uint : T.int;
    else if (s.storage || s.cst || s.vol) { throw new CErr(this.peek(), this.peek().t === 'id' ? "unknown type name '" + this.peek().v + "'" : 'expected a type'); }
    else return null;
    if (s.cst) type = Object.assign({}, type, { cst: true });
    s.type = type;
    return s;
  }
  parseEnum(tok) {
    let name = null;
    if (this.peek().t === 'id' && !this.is('{')) { name = this.next().v; if (this.ctx.knownEnums) this.ctx.knownEnums.add(name); }
    if (this.accept('{')) {
      let val = 0;
      while (!this.is('}')) {
        const nt = this.next(); if (nt.t !== 'id') throw new CErr(nt, 'expected identifier');
        if (this.accept('=')) { const e = this.parseAssign(); const cv = this.ctx.constEval(e); if (cv == null) throw new CErr(nt, 'expression is not an integral constant expression'); val = cv; }
        this.ctx.declareEnumConst(nt, val);
        val++;
        if (!this.accept(',')) break;
      }
      this.expect('}');
    }
    return T.int;
  }
  parseDeclarator(spec, abstract) {
    let type = spec.type;
    while (this.is('*') || this.is('&')) {
      const t = this.next();
      if (t.v === '&') throw new CErr(t, 'references are not supported by the MAPP simulator');
      type = ptr(type);
      while (this.is('const') || this.is('volatile')) this.next();
    }
    let nameTok = null;
    if (this.peek().t === 'id' && !STMT_KW.has(this.peek().v) && !TYPE_KW.has(this.peek().v)) nameTok = this.next();
    else if (this.is('(') && this.is('*', 1)) throw new CErr(this.peek(), 'function pointer declarations are not supported by the MAPP simulator');
    else if (!abstract) {
      const t = this.peek();
      if (t.t === 'id' && STMT_KW.has(t.v)) throw new CErr(t, 'expected unqualified-id');
      throw new CErr(t, t.t === 'p' && t.v === '(' ? 'expected unqualified-id' : 'expected unqualified-id');
    }
    const dims = [];
    while (this.is('[')) {
      const lb = this.next();
      if (this.accept(']')) { dims.push(null); continue; }
      const e = this.parseExpr();
      this.expect(']');
      dims.push({ e, tok: lb });
    }
    return { nameTok, type, dims };
  }
  applyDims(type, dims, initLen) {
    for (let k = dims.length - 1; k >= 0; k--) {
      const d = dims[k];
      let n = null;
      if (d) {
        n = this.ctx.constEval(d.e);
        if (n == null) n = { pending: d.e, tok: d.tok };
        else if (n < 0) throw new CErr(d.tok, "array size is negative");
      } else if (k === 0 && initLen != null) n = initLen;
      type = arr(type, n);
    }
    return type;
  }
  parseParams() {
    const params = [];
    this.expect('(');
    if (this.is('void') && this.is(')', 1)) { this.next(); this.next(); return params; }
    if (this.accept(')')) return params;
    for (;;) {
      if (this.is('...')) throw new CErr(this.peek(), 'variadic functions are not supported by the MAPP simulator');
      const spec = this.parseSpec();
      if (!spec) { const t = this.peek(); throw new CErr(t, t.t === 'id' ? "unknown type name '" + t.v + "'" : 'expected parameter declarator'); }
      const d = this.parseDeclarator(spec, true);
      let type = d.type;
      if (d.dims.length) { type = this.applyDims(type, d.dims.slice(1), null); type = ptr(type); }
      if (type.k === 'obj') throw new CErr(d.nameTok || spec.tok, 'passing mbed objects by value is not supported; use a global object instead');
      params.push({ name: d.nameTok ? d.nameTok.v : null, tok: d.nameTok || spec.tok, type });
      if (this.accept(')')) break;
      if (!this.is(',')) throw new CErr(this.peek(), "expected ')'");
      this.next();
    }
    return params;
  }
  parseInit() {
    if (this.is('{')) {
      const lb = this.next(); const list = [];
      while (!this.is('}')) {
        list.push(this.parseInit());
        if (!this.accept(',')) break;
      }
      this.expect('}');
      return { node: 'list', items: list, loc: lb };
    }
    return this.parseAssign();
  }
  // returns array of decl / func nodes
  parseDecl(global) {
    const spec = this.parseSpec();
    if (!spec) throw new CErr(this.peek(), 'expected a type');
    if (this.accept(';')) return []; // e.g. "enum {...};"
    const out = [];
    for (;;) {
      const d = this.parseDeclarator(spec, false);
      const name = d.nameTok.v;
      if (this.is('(') && spec.type.k !== 'obj') {
        // function declaration / definition
        const params = this.parseParams();
        const fn = { node: 'func', name, nameTok: d.nameTok, ret: d.type, params, storage: spec.storage, loc: d.nameTok, spec };
        if (this.is('{')) {
          if (!global) throw new CErr(this.peek(), 'function definition is not allowed here');
          fn.body = this.parseBlock();
          out.push(fn); return out;
        }
        if (this.is('const')) this.next();
        out.push(fn);
      } else {
        const decl = { node: 'decl', name, nameTok: d.nameTok, spec, storage: spec.storage, loc: d.nameTok, global };
        if (spec.type.k === 'obj' && d.type.k === 'obj') {
          decl.type = d.type;
          if (d.dims.length) throw new CErr(d.nameTok, 'arrays of mbed objects are not supported by the MAPP simulator');
          if (this.is('(')) {
            this.next(); const args = [];
            if (!this.is(')')) for (;;) { args.push(this.parseAssign()); if (!this.accept(',')) break; }
            this.expect(')');
            decl.ctorArgs = args;
          } else if (this.is('{')) {
            this.next(); const args = [];
            if (!this.is('}')) for (;;) { args.push(this.parseAssign()); if (!this.accept(',')) break; }
            this.expect('}'); decl.ctorArgs = args;
          } else if (this.accept('=')) {
            decl.ctorArgs = [this.parseAssign()];
          } else decl.ctorArgs = [];
        } else {
          if (this.accept('=')) decl.init = this.parseInit();
          else if (this.is('(') ) throw new CErr(this.peek(), 'function declarations with object types are not supported');
          let initLen = null;
          if (decl.init && d.dims.length && d.dims[0] === null) {
            if (decl.init.node === 'list') initLen = decl.init.items.length;
            else if (decl.init.node === 'str') initLen = decl.init.bytes.length + 1;
          }
          decl.type = this.applyDims(d.type, d.dims, initLen);
          if (decl.type.k === 'arr' && decl.type.n == null && !(spec.storage === 'extern'))
            throw new CErr(d.nameTok, "definition of variable with array type needs an explicit size or an initializer");
        }
        if (spec.typedef) { this.typedefs.set(name, decl.type); }
        else out.push(decl);
      }
      if (this.accept(',')) continue;
      if (!this.is(';')) {
        const t = this.peek();
        if (out.length && out[out.length - 1].node === 'func') throw new CErr(this.afterPrev(), "expected ';' after top level declarator");
        if (t.t === 'id' || t.t === 'num') throw new CErr(this.afterPrev(), global ? "expected ';' after top level declarator" : "expected ';' at end of declaration");
        throw new CErr(this.afterPrev(), global ? "expected ';' after top level declarator" : "expected ';' at end of declaration");
      }
      this.next();
      return out;
    }
  }

  parseBlock() {
    const lb = this.expect('{');
    const body = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') throw new CErr(this.eof, "expected '}'", false, lb);
      const start = this.i;
      try { body.push(this.parseStmt()); }
      catch (e) {
        if (!(e instanceof CErr) || e.fatal) throw e;
        this.recover(e, start);
      }
    }
    const rb = this.next();
    return { node: 'block', body, loc: lb, end: rb };
  }
  parseStmt() {
    const t = this.peek();
    if (t.t === 'p' && t.v === '{') return this.parseBlock();
    if (t.t === 'p' && t.v === ';') { this.next(); return { node: 'empty', loc: t }; }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.next(); this.expect('(', "after 'if'");
          const cond = this.parseExpr(); this.expect(')');
          const semi = this.is(';') ? this.peek() : null;
          const then = this.parseStmt(); let els = null;
          if (this.accept('else')) els = this.parseStmt();
          return { node: 'if', cond, then, els, loc: t, emptyBody: semi && semi.line === this.toks[this.i - 1].line ? semi : null };
        }
        case 'while': {
          this.next(); this.expect('(', "after 'while'");
          const cond = this.parseExpr(); this.expect(')');
          const body = this.parseStmt();
          return { node: 'while', cond, body, loc: t };
        }
        case 'do': {
          this.next(); const body = this.parseStmt();
          if (!this.is('while')) throw new CErr(this.peek(), "expected 'while' in do/while loop");
          this.next(); this.expect('(', "after 'while'"); const cond = this.parseExpr(); this.expect(')');
          if (!this.is(';')) throw new CErr(this.afterPrev(), "expected ';' after do/while statement");
          this.next();
          return { node: 'do', cond, body, loc: t };
        }
        case 'for': {
          this.next(); this.expect('(', "after 'for'");
          let init = null, cond = null, step = null;
          if (!this.accept(';')) {
            if (this.isTypeStart()) { init = { node: 'decls', decls: this.parseDecl(false), loc: this.peek() }; }
            else { init = { node: 'expr', e: this.parseExpr(), loc: this.peek() }; this.expect(';', 'in \'for\' statement specifier'); }
          }
          if (!this.is(';')) cond = this.parseExpr();
          this.expect(';', "in 'for' statement specifier");
          if (!this.is(')')) step = this.parseExpr();
          this.expect(')');
          const body = this.parseStmt();
          return { node: 'for', init, cond, step, body, loc: t };
        }
        case 'switch': {
          this.next(); this.expect('(', "after 'switch'"); const e = this.parseExpr(); this.expect(')');
          const body = this.parseStmt();
          return { node: 'switch', e, body, loc: t };
        }
        case 'case': {
          this.next(); const e = this.parseCond();
          if (!this.is(':')) throw new CErr(this.afterPrev(), "expected ':' after 'case'");
          this.next();
          return { node: 'case', e, loc: t };
        }
        case 'default': { this.next(); this.expect(':', "after 'default'"); return { node: 'default', loc: t }; }
        case 'break': case 'continue': {
          this.next();
          if (!this.is(';')) throw new CErr(this.afterPrev(), "expected ';' after " + t.v + ' statement');
          this.next(); return { node: t.v, loc: t };
        }
        case 'return': {
          this.next(); let e = null;
          if (!this.is(';')) e = this.parseExpr();
          if (!this.is(';')) throw new CErr(this.afterPrev(), "expected ';' after return statement");
          this.next(); return { node: 'return', e, loc: t };
        }
        case 'goto': throw new CErr(t, "'goto' is not supported by the MAPP simulator");
        case 'else': throw new CErr(t, 'expected expression');
      }
      if (this.isTypeStart()) {
        return { node: 'decls', decls: this.parseDecl(false), loc: t };
      }
      if (!STMT_KW.has(t.v) && this.peek(1).t === 'id' && !this.ctx.isKnown(t.v) && (this.is('(', 2) || this.is(';', 2) || this.is('=', 2) || this.is('[', 2) || this.is(',', 2)))
        throw new CErr(t, unknownType(t.v));
    }
    const e = this.parseExpr();
    if (!this.is(';')) {
      if (this.is('}') || this.peek().line !== this.prev().line || this.peek().t === 'eof') throw new CErr(this.afterPrev(), "expected ';' after expression");
      throw new CErr(this.afterPrev(), "expected ';' after expression");
    }
    this.next();
    return { node: 'expr', e, loc: t };
  }

  // ---- expressions
  parseExpr() {
    let e = this.parseAssign();
    while (this.is(',')) { const t = this.next(); e = { node: 'comma', a: e, b: this.parseAssign(), loc: t }; }
    return e;
  }
  parseAssign() {
    const lhs = this.parseCond();
    const t = this.peek();
    if (t.t === 'p' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      this.next();
      const rhs = this.parseAssign();
      return { node: 'assign', op: t.v, l: lhs, r: rhs, loc: t };
    }
    return lhs;
  }
  parseCond() {
    const c = this.parseBin(0);
    if (this.is('?')) {
      const t = this.next(); const a = this.parseExpr();
      if (!this.is(':')) throw new CErr(this.peek(), "expected ':'");
      this.next(); const b = this.parseAssign();
      return { node: 'cond', c, a, b, loc: t };
    }
    return c;
  }
  parseBin(minPrec) {
    const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    let l = this.parseUnary();
    for (;;) {
      const t = this.peek();
      const p = t.t === 'p' ? PREC[t.v] : undefined;
      if (p === undefined || p <= minPrec - 1 || p < minPrec) break;
      this.next();
      const r = this.parseBin(p + 1);
      l = { node: 'bin', op: t.v, l, r, loc: t };
    }
    return l;
  }
  parseUnary() {
    const t = this.peek();
    if (t.t === 'p') {
      if (t.v === '++' || t.v === '--') { this.next(); return { node: 'preinc', op: t.v, e: this.parseUnary(), loc: t }; }
      if (['+', '-', '!', '~', '*', '&'].includes(t.v)) { this.next(); return { node: 'unary', op: t.v, e: this.parseCastOrUnary(), loc: t }; }
      if (t.v === '(' && this.isTypeStart(1)) return this.parseCastOrUnary();
    }
    if (t.t === 'id' && t.v === 'sizeof') {
      this.next();
      if (this.is('(') && this.isTypeStart(1)) {
        this.next(); const ty = this.parseTypeName(); this.expect(')');
        return { node: 'sizeof_t', type: ty, loc: t };
      }
      return { node: 'sizeof_e', e: this.parseUnary(), loc: t };
    }
    if (t.t === 'id' && (t.v === 'new' || t.v === 'delete')) throw new CErr(t, "'" + t.v + "' (dynamic memory) is not supported by the MAPP simulator");
    return this.parsePostfix();
  }
  parseCastOrUnary() {
    if (this.is('(') && this.isTypeStart(1)) {
      const lp = this.next();
      const ty = this.parseTypeName();
      this.expect(')');
      return { node: 'cast', type: ty, e: this.parseCastOrUnary(), loc: lp };
    }
    return this.parseUnary();
  }
  parseTypeName() {
    const spec = this.parseSpec();
    if (!spec) throw new CErr(this.peek(), 'expected a type');
    let type = spec.type;
    while (this.is('*')) { this.next(); type = ptr(type); while (this.is('const')) this.next(); }
    return type;
  }
  parsePostfix() {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'p') break;
      if (t.v === '(') {
        this.next(); const args = [];
        if (!this.is(')')) for (;;) {
          args.push(this.parseAssign());
          if (this.accept(',')) continue;
          if (!this.is(')')) throw new CErr(this.peek(), "expected ')'");
          break;
        }
        this.expect(')');
        e = { node: 'call', f: e, args, loc: e.loc || t, lp: t };
      } else if (t.v === '[') {
        this.next(); const idx = this.parseExpr(); this.expect(']');
        e = { node: 'index', a: e, i: idx, loc: t };
      } else if (t.v === '.' || t.v === '->') {
        this.next(); const n = this.next();
        if (n.t !== 'id') throw new CErr(n, 'expected unqualified-id');
        e = { node: 'member', o: e, name: n.v, arrow: t.v === '->', loc: n };
      } else if (t.v === '++' || t.v === '--') {
        this.next(); e = { node: 'postinc', op: t.v, e, loc: t };
      } else break;
    }
    return e;
  }
  parsePrimary() {
    const t = this.next();
    switch (t.t) {
      case 'num':
        if (t.chrono) return { node: 'dur', val: t.val * ({ ms: 1000, s: 1e6, us: 1, min: 6e7, h: 3.6e9 }[t.chrono]), loc: t };
        return { node: 'num', val: t.val, fl: t.fl, f32: t.f32, uns: t.uns, big: t.big, loc: t };
      case 'chr': return { node: 'chr', val: t.val, loc: t };
      case 'str': {
        let bytes = t.bytes.slice();
        while (this.peek().t === 'str') bytes = bytes.concat(this.next().bytes);
        return { node: 'str', bytes, loc: t };
      }
      case 'id': {
        if (t.v === 'true' || t.v === 'false') return { node: 'bool', val: t.v === 'true' ? 1 : 0, loc: t };
        if (t.v === 'nullptr') return { node: 'null', loc: t };
        let name = t.v;
        while (this.is('::')) { this.next(); const n = this.next(); if (n.t !== 'id') throw new CErr(n, 'expected unqualified-id'); name += '::' + n.v; }
        name = name.replace(/^(std::)?(chrono::)?/, '').replace(/^(std|mbed|rtos)::(?!ThisThread)/, '');
        if (name === 'duration_cast' && this.is('<')) {
          this.next(); let unit = '';
          while (!this.is('>') && this.peek().t !== 'eof') { const u = this.next(); if (u.t === 'id') unit = u.v; }
          this.expect('>'); this.expect('(');
          const e = this.parseExpr(); this.expect(')');
          const div = { microseconds: 1, milliseconds: 1000, seconds: 1e6, nanoseconds: 0.001, minutes: 6e7 }[unit];
          if (!div) throw new CErr(t, "unknown duration type '" + unit + "'");
          return { node: 'dcast', div, e, loc: t };
        }
        if (TYPEDEFS[name] || (TYPE_KW.has(name) && ['int', 'char', 'float', 'double', 'bool', 'unsigned', 'long', 'short'].includes(name))) {
          // functional cast  int(x)
          if (this.is('(')) {
            this.i--; const ty = this.parseTypeName(); this.expect('('); const e = this.parseExpr(); this.expect(')');
            return { node: 'cast', type: ty, e, loc: t };
          }
        }
        if (STMT_KW.has(name) || TYPE_KW.has(name)) throw new CErr(t, 'expected expression');
        return { node: 'id', name, loc: t };
      }
      case 'p':
        if (t.v === '(') {
          const e = this.parseExpr();
          if (!this.is(')')) throw new CErr(this.peek(), "expected ')'");
          this.next();
          return { node: 'paren', e, loc: t };
        }
        throw new CErr(t, 'expected expression');
      case 'eof': throw new CErr(t, 'expected expression');
    }
    throw new CErr(t, 'expected expression');
  }
}

/* ======================================================================
 * Semantic analysis + code generation (one translation unit)
 * ==================================================================== */
class TUCompiler {
  constructor(prog, tu) {
    this.prog = prog; this.tu = tu; this.diags = [];
    this.globals = new Map(); // name -> sym
    this.scopes = [];
    this.enumConsts = new Map();
    this.knownEnums = new Set();
    this.lits = [];
    this.fnCur = null;
    this.uid = 0;
    this.refs = new Set(); this.defs = [];
  }
  err(tok, msg) { this.diags.push({ tok, msg, kind: 'error' }); if (this.diags.filter(d => d.kind === 'error').length > 30) throw new CErr(tok, 'too many errors emitted, stopping now [-ferror-limit=]', true); }
  warn(tok, msg) { this.diags.push({ tok, msg, kind: 'warning' }); }
  hasHeader(kind) {
    const h = this.tu.headers;
    if (h.has('mbed.h') || h.has('rtos.h')) return true;
    if (kind === 'mbed') return false;
    const map = { stdio: ['stdio.h', 'cstdio', 'iostream'], string: ['string.h', 'cstring'], stdlib: ['stdlib.h', 'cstdlib'], math: ['math.h', 'cmath'], ctype: ['ctype.h', 'cctype'] };
    return (map[kind] || []).some(x => h.has(x));
  }
  isKnown(name) { return !!this.lookup(name, true); }
  declareEnumConst(tok, val) {
    if (this.scopes.length) this.scopes[this.scopes.length - 1].set(tok.v, { kind: 'const', t: T.int, val, js: String(val) });
    else this.globals.set(tok.v, { kind: 'const', t: T.int, val, js: String(val), tok });
  }

  lookup(name, quiet) {
    for (let i = this.scopes.length - 1; i >= 0; i--) { const s = this.scopes[i].get(name); if (s) return s; }
    const g = this.globals.get(name); if (g && (this.curOrder == null || g.order == null || g.order <= this.curOrder)) return g;
    if (g && !quiet) this.lateDecl = g;
    const mb = this.hasHeader('mbed');
    if (Object.prototype.hasOwnProperty.call(CONSTS, name) && mb) return { kind: 'const', t: name.startsWith('P') && /_\d+$/.test(name) ? TYPEDEFS.PinName : T.int, val: CONSTS[name], js: String(CONSTS[name]), builtin: true };
    const cm = /^(RCC|GPIO|AFIO|EXTI|TIM|USART|ADC|DMA|FLASH|PWR|SCB|SysTick|NVIC)_[A-Za-z0-9_]+$/.test(name) && mb && !BUILTIN_FUNCS[name];
    if (cm) { const v = { RCC_APB2ENR_AFIOEN: 1, RCC_APB2ENR_IOPAEN: 4, RCC_APB2ENR_IOPBEN: 8, RCC_APB2ENR_IOPCEN: 16, RCC_APB2ENR_IOPDEN: 32, RCC_APB1ENR_TIM2EN: 1, RCC_APB1ENR_TIM3EN: 2 }[name] || 0; return { kind: 'const', t: T.uint, val: v, js: String(v), builtin: true }; }
    if (/_IRQn$/.test(name) && mb) return { kind: 'const', t: T.int, val: 40, js: '40', builtin: true };
    if (BUILTIN_VARS[name] && mb) return { kind: 'var', t: BUILTIN_VARS[name].t, js: BUILTIN_VARS[name].js, builtin: true };
    if (REG_BLOCKS.has(name) && mb) return { kind: 'reg', name, builtin: true };
    const bf = BUILTIN_FUNCS[name];
    if (bf && (bf.mbed ? mb : this.hasHeader(bf.std))) return { kind: 'bfunc', f: bf, name, builtin: true };
    if (CLASSES[name] && mb) return { kind: 'class', name };
    return null;
  }
  suggest(name) {
    const cands = new Set();
    for (const s of this.scopes) for (const k of s.keys()) cands.add(k);
    for (const k of this.globals.keys()) cands.add(k);
    if (this.hasHeader('mbed')) { for (const k in BUILTIN_FUNCS) cands.add(k); for (const k in CONSTS) cands.add(k); }
    let best = null, bd = 3;
    for (const c of cands) { const d = editDist(name, c); if (d < bd && d <= Math.max(1, Math.min(2, name.length / 3))) { bd = d; best = c; } }
    return best;
  }

  /* ---------- top level ---------- */
  compile(items) {
    const P = this.prog;
    const tuIdx = this.tu.idx;
    const out = { vars: [], funcs: [], init: [] };
    // pass 1: declare all functions (prototypes + definitions) and globals in order (C++ requires declare-before-use)
    for (let ix = 0; ix < items.length; ix++) {
      const it = items[ix]; this.curOrder = ix;
      try {
        if (it.node === 'func') this.declFunc(it);
        else this.declGlobal(it, out);
      } catch (e) { if (e instanceof CErr) { if (e.fatal) throw e; this.err(e.tok, e.message); } else throw e; }
    }
    // pass 2: function bodies
    for (let ix = 0; ix < items.length; ix++) {
      const it = items[ix]; this.curOrder = ix;
      if (it.node === 'func' && it.body) {
        try { out.funcs.push(this.genFunc(it)); }
        catch (e) { if (e instanceof CErr) { if (e.fatal) throw e; this.err(e.tok, e.message); } else throw e; }
      }
    }
    this.curOrder = null;
    out.lits = this.lits;
    return out;
  }
  fixType(t, tok) {
    if (t.k !== 'arr') return t;
    const of = this.fixType(t.of, tok);
    let n = t.n;
    if (n && typeof n === 'object') {
      const cv = this.constEval(n.pending);
      if (cv == null) throw new CErr(n.tok, this.scopes.length ? 'variable length arrays are not supported by the MAPP simulator (use a constant size)' : 'variable length array declaration not allowed at file scope');
      if (cv < 0) throw new CErr(n.tok, 'array size is negative');
      n = cv;
    }
    if (of === t.of && n === t.n) return t;
    return Object.assign(arr(of, n), t.cst ? { cst: true } : {});
  }
  sigOf(params) { return params.map(p => tname(p.type).replace(/^const /, '')).join(', '); }
  declFunc(f) {
    const name = f.name;
    if (f.ret.k === 'obj') throw new CErr(f.nameTok, 'returning mbed objects is not supported');
    if (f.ret.k === 'arr') throw new CErr(f.nameTok, "function cannot return array type '" + tname(f.ret) + "'");
    const sig = name === 'main' ? '' : this.sigOf(f.params);
    const key = name === 'main' ? 'main' : name + '(' + sig + ')';
    const isStatic = f.storage === 'static';
    let sym = this.globals.get(name);
    if (sym && sym.kind !== 'func') { throw new CErr(f.nameTok, "redefinition of '" + name + "' as different kind of symbol"); }
    if (!sym) { sym = { kind: 'func', name, overloads: [], tok: f.nameTok, order: this.curOrder }; this.globals.set(name, sym); }
    let ov = sym.overloads.find(o => o.sig === sig);
    if (ov) {
      if (tname(ov.ret) !== tname(f.ret) && name !== 'main') throw new CErr(f.nameTok, 'functions that differ only in their return type cannot be overloaded');
      if (f.body) { if (ov.defined) throw new CErr(f.nameTok, "redefinition of '" + name + "'"); ov.defined = true; ov.defTok = f.nameTok; }
    } else {
      const js = isStatic ? 'S' + this.tu.idx + '_' + name + '_' + sym.overloads.length : 'F_' + name + (sig ? '__' + jsId(sig.replace(/\*/g, 'P')) : '');
      ov = { sig, key, ret: name === 'main' ? T.int : f.ret, params: f.params.map(p => p.type), js: name === 'main' ? 'F_main' : js, defined: !!f.body, isStatic, name, tok: f.nameTok };
      if (name === 'main' && f.params.length) ov.js = 'F_main';
      sym.overloads.push(ov);
    }
    f.ov = ov;
    if (f.body && !isStatic) this.defs.push({ key: ov.key, kind: 'func', js: ov.js, tok: f.nameTok });
  }
  declGlobal(d, out) {
    const name = d.name;
    d.type = this.fixType(d.type, d.nameTok);
    if (this.globals.has(name)) {
      const s = this.globals.get(name);
      if (s.kind === 'var' && (s.isExtern || d.storage === 'extern')) {
        if (d.storage !== 'extern') { s.isExtern = false; this.defs.push({ key: name, kind: 'var', js: s.js, tok: d.nameTok }); this.emitGlobalInit(d, s, out); }
        return;
      }
      throw new CErr(d.nameTok, "redefinition of '" + name + "'");
    }
    const isStatic = d.storage === 'static';
    const js = isStatic ? 'S' + this.tu.idx + '_' + name : 'G_' + name;
    const sym = { kind: 'var', t: d.type, js, tok: d.nameTok, isExtern: d.storage === 'extern', isStatic, name, isConst: !!(d.type.cst), order: this.curOrder };
    if (d.type.k === 'obj') sym.kind = 'obj';
    if (d.type.k === 'auto') throw new CErr(d.nameTok, "'auto' is not supported at file scope in the MAPP simulator");
    if (d.type.k === 'void') throw new CErr(d.nameTok, "variable has incomplete type 'void'");
    this.globals.set(name, sym);
    if (sym.isExtern) return;
    if (!isStatic) this.defs.push({ key: name, kind: 'var', js, tok: d.nameTok });
    this.emitGlobalInit(d, sym, out);
  }
  emitGlobalInit(d, sym, out) {
    // constant value for const ints
    if (d.type.k === 'obj') {
      out.vars.push(sym.js);
      out.init.push(sym.js + ' = ' + this.genCtor(d) + ';');
      return;
    }
    out.vars.push(sym.js);
    if (d.init) {
      const code = this.genInitializer(d.type, d.init, d.nameTok);
      if (isIntT(d.type) && d.type.cst && d.init.node !== 'list') { const cv = this.constEval(d.init); if (cv != null) { sym.cval = constWrap(cv, d.type); } }
      out.init.push(sym.js + ' = ' + code + ';');
    } else out.init.push(sym.js + ' = ' + this.zeroValue(d.type) + ';');
  }
  zeroValue(t) {
    if (t.k === 'arr') return this.allocArr(t);
    if (t.k === 'ptr' || t.k === 'fnptr') return 'null';
    return '0';
  }
  allocArr(t) {
    if (t.of.k === 'arr') return 'R.arr2(' + (t.n || 0) + ',()=>' + this.allocArr(t.of) + ')';
    return 'new ' + this.taName(t.of) + '(' + (t.n || 0) + ')';
  }
  taName(t) {
    if (t.k === 'int') { if (t.bits === 8) return t.u ? 'Uint8Array' : 'Int8Array'; if (t.bits === 16) return t.u ? 'Uint16Array' : 'Int16Array'; if (t.bits === 32) return t.u ? 'Uint32Array' : 'Int32Array'; return 'Float64Array'; }
    if (t.k === 'bool') return 'Uint8Array';
    if (t.k === 'float') return t.bits === 32 ? 'Float32Array' : 'Float64Array';
    return 'Array';
  }
  genInitializer(t, init, tok) {
    if (t.k === 'arr') {
      if (init.node === 'str') {
        if (!(t.of.k === 'int' && t.of.bits === 8)) throw new CErr(init.loc, "array initializer must be an initializer list");
        if (t.n != null && init.bytes.length > t.n) throw new CErr(init.loc, 'initializer-string for char array is too long');
        return 'R.strArr(' + JSON.stringify(init.bytes) + ',' + t.n + ',' + this.taName(t.of) + ')';
      }
      if (init.node !== 'list') throw new CErr(init.loc || tok, "array initializer must be an initializer list");
      if (t.n != null && init.items.length > t.n) throw new CErr(init.items[t.n].loc || tok, 'excess elements in array initializer');
      if (t.of.k === 'arr') return '(()=>{const a=' + this.allocArr(t) + ';' + init.items.map((it, i) => 'a[' + i + ']=' + this.genInitializer(t.of, it, tok) + ';').join('') + 'return a;})()';
      const vals = init.items.map(it => {
        if (it.node === 'list') throw new CErr(it.loc, 'braces around scalar initializer');
        return this.convTo(this.expr(it), t.of, it.loc, 'init').c;
      });
      const allConst = init.items.every(it => this.constEval(it) != null);
      if (allConst && t.of.k !== 'ptr') return 'R.initArr(' + this.taName(t.of) + ',' + t.n + ',[' + vals.join(',') + '])';
      return 'R.initArr(' + this.taName(t.of) + ',' + t.n + ',[' + vals.join(',') + '])';
    }
    if (init.node === 'list') {
      if (init.items.length === 0) return this.zeroValue(t);
      if (init.items.length > 1) throw new CErr(init.items[1].loc, 'excess elements in scalar initializer');
      init = init.items[0];
    }
    const v = this.expr(init);
    this.checkConstConv(v, t, init);
    return this.convTo(v, t, init.loc, 'init').c;
  }
  checkConstConv(v, t, node) {
    if (isIntT(t) && t.k === 'int' && v.cval != null && isIntT(v.t) && t.bits < 32) {
      const w = constWrap(v.cval, t);
      if (w !== v.cval && !(v.cval < 0 && t.u && node.node === 'unary')) this.warn(node.loc, "implicit conversion from '" + tname(v.t) + "' to '" + tname(t) + "' changes value from " + v.cval + ' to ' + w + ' [-Wconstant-conversion]');
    }
  }
  genCtor(d) {
    const cls = CLASSES[d.type.cls];
    const args = d.ctorArgs || [];
    const tok = d.nameTok;
    if (args.length < cls.ctor.min) {
      if (cls.ctor.min === 1 && args.length === 0) throw new CErr(tok, "no matching constructor for initialization of '" + d.type.cls + "'");
      throw new CErr(tok, "no matching constructor for initialization of '" + d.type.cls + "'");
    }
    if (args.length > cls.ctor.max) throw new CErr(args[cls.ctor.max].loc, "no matching constructor for initialization of '" + d.type.cls + "'");
    const codes = args.map((a, i) => {
      const v = this.expr(a);
      const kind = cls.ctor.kinds === 'pins' ? 'pin' : cls.ctor.kinds[i];
      if (kind === 'float') return this.convTo(v, T.float, a.loc).c;
      if (v.t.k === 'obj') throw new CErr(a.loc, "no matching constructor for initialization of '" + d.type.cls + "'");
      if (!isArith(v.t)) throw new CErr(a.loc, "cannot initialize a parameter of type '" + (kind === 'pin' ? 'PinName' : kind === 'port' ? 'PortName' : 'int') + "' with an lvalue of type '" + tname(v.t) + "'");
      if (kind === 'pin' && v.t.name !== 'PinName' && !(v.cval === -1)) {
        if (v.cval != null && a.node === 'num') throw new CErr(a.loc, "cannot initialize a parameter of type 'PinName' with an rvalue of type 'int'");
      }
      if (kind === 'port' && a.node === 'id' && /^P[A-D]_\d+$/.test(a.name)) throw new CErr(a.loc, "cannot initialize a parameter of type 'PortName' with an rvalue of type 'PinName'; did you mean 'Port" + a.name[1] + "'?");
      return v.c;
    });
    return 'R.make(' + JSON.stringify(d.type.cls) + ',[' + codes.join(',') + '],' + JSON.stringify(d.name) + ')';
  }

  genFunc(f) {
    const ov = f.ov;
    this.fnCur = { ov, ret: ov.ret, hasReturn: false, name: f.name };
    this.scopes = [new Map()];
    const pnames = [];
    f.params.forEach((p, i) => {
      if (!p.name) { pnames.push('_p' + i); return; }
      const js = 'v_' + p.name + '_' + (++this.uid);
      if (this.scopes[0].has(p.name)) throw new CErr(p.tok, "redefinition of parameter '" + p.name + "'");
      this.scopes[0].set(p.name, { kind: 'var', t: p.type, js, tok: p.tok, isParam: true });
      pnames.push(js);
    });
    let body = this.block(f.body, true);
    const fn = this.fnCur; this.fnCur = null; this.scopes = [];
    if (ov.ret.k !== 'void' && f.name !== 'main' && !fn.hasReturn)
      this.warn(f.body.end, "non-void function does not return a value [-Wreturn-type]");
    return 'function* ' + ov.js + '(' + pnames.join(',') + '){' + body + '}';
  }

  /* ---------- statements ---------- */
  block(b, noScope) {
    if (!noScope) this.scopes.push(new Map());
    let code = '';
    for (const s of b.body) {
      try { code += this.stmt(s); }
      catch (e) { if (e instanceof CErr) { if (e.fatal) throw e; this.err(e.tok, e.message); } else throw e; }
    }
    if (!noScope) this.scopes.pop();
    return code;
  }
  scoped(fn) { this.scopes.push(new Map()); try { return fn(); } finally { this.scopes.pop(); } }
  body(s) { return s.node === 'block' ? '{' + this.block(s) + '}' : '{' + this.scoped(() => this.stmt(s)) + '}'; }
  cond(e) {
    if (e.node === 'assign' && e.op === '=') this.warn(e.loc, 'using the result of an assignment as a condition without parentheses [-Wparentheses]');
    const v = this.expr(e);
    return this.truth(v, e.loc);
  }
  truth(v, tok) {
    if (v.t.k === 'obj') return '(' + this.objRead(v, tok).c + ')';
    if (v.t.k === 'ptr') return '(' + v.c + '!==null)';
    if (v.t.k === 'arr') return '1';
    if (v.t.k === 'void') throw new CErr(tok, "value of type 'void' is not contextually convertible to 'bool'");
    if (v.t.k === 'dur') throw new CErr(tok, "value of type 'std::chrono::duration' is not contextually convertible to 'bool'");
    return '(' + v.c + ')';
  }
  stmt(s) {
    const B = 'if(--R.b<0)yield 0;';
    switch (s.node) {
      case 'block': return '{' + this.block(s) + '}';
      case 'empty': return ';';
      case 'expr': {
        const v = this.expr(s.e, true);
        return v.c + ';';
      }
      case 'decls': {
        let c = '';
        for (const d of s.decls) c += this.localDecl(d);
        return c;
      }
      case 'if': {
        if (s.emptyBody) this.warn(s.emptyBody, 'if statement has empty body [-Wempty-body]');
        let c = 'if(' + this.cond(s.cond) + ')' + this.body(s.then);
        if (s.els) c += 'else ' + this.body(s.els);
        return c;
      }
      case 'while': return 'while(' + this.cond(s.cond) + '){' + B + this.inLoop(() => this.body(s.body)) + '}';
      case 'do': return 'do{' + B + this.inLoop(() => this.body(s.body)) + '}while(' + this.cond(s.cond) + ');';
      case 'for': {
        return this.scoped(() => {
          let init = '';
          if (s.init) {
            if (s.init.node === 'decls') {
              const parts = [];
              for (const d of s.init.decls) parts.push(this.localDecl(d, true));
              init = 'let ' + parts.join(',');
            } else init = this.expr(s.init.e, true).c;
          }
          const cond = s.cond ? this.cond(s.cond) : '';
          const step = s.step ? this.expr(s.step, true).c : '';
          return 'for(' + init + ';' + cond + ';' + step + '){' + B + this.inLoop(() => this.body(s.body)) + '}';
        });
      }
      case 'switch': {
        const v = this.expr(s.e);
        let vc = v.c;
        if (v.t.k === 'obj') vc = this.objRead(v, s.loc).c;
        else if (!isIntT(v.t)) throw new CErr(s.e.loc, "statement requires expression of integer type ('" + tname(v.t) + "' invalid)");
        this.loopDepth = (this.loopDepth || 0);
        this.switchDepth = (this.switchDepth || 0) + 1;
        const seen = new Set(); this.caseSeen = this.caseSeen || []; this.caseSeen.push(seen);
        const b = this.body(s.body);
        this.caseSeen.pop(); this.switchDepth--;
        return 'switch(' + vc + ')' + b;
      }
      case 'case': {
        if (!this.switchDepth) throw new CErr(s.loc, "'case' statement not in switch statement");
        const cv = this.constEval(s.e);
        if (cv == null) throw new CErr(s.e.loc, 'expression is not an integral constant expression');
        const seen = this.caseSeen[this.caseSeen.length - 1];
        if (seen.has(cv)) throw new CErr(s.e.loc, 'duplicate case value \'' + cv + '\'');
        seen.add(cv);
        return 'case ' + cv + ':';
      }
      case 'default': if (!this.switchDepth) throw new CErr(s.loc, "'default' statement not in switch statement"); return 'default:';
      case 'break': if (!this.loopDepth && !this.switchDepth) throw new CErr(s.loc, "'break' statement not in loop or switch statement"); return 'break;';
      case 'continue': if (!this.loopDepth) throw new CErr(s.loc, "'continue' statement not in loop statement"); return 'continue;';
      case 'return': {
        const rt = this.fnCur.ret;
        this.fnCur.hasReturn = true;
        if (!s.e) {
          if (rt.k !== 'void' && this.fnCur.name !== 'main') throw new CErr(s.loc, "non-void function '" + this.fnCur.name + "' should return a value");
          return 'return;';
        }
        const v = this.expr(s.e);
        if (rt.k === 'void') { if (v.t.k !== 'void') throw new CErr(s.e.loc, "void function '" + this.fnCur.name + "' should not return a value"); return v.c + ';return;'; }
        return 'return ' + this.convTo(v, rt, s.e.loc, 'return').c + ';';
      }
    }
    throw new CErr(s.loc, 'unsupported statement');
  }
  inLoop(fn) { this.loopDepth = (this.loopDepth || 0) + 1; const sw = this.switchDepth; this.switchDepth = 0; try { return fn(); } finally { this.loopDepth--; this.switchDepth = sw; } }
  localDecl(d, bare) {
    const scope = this.scopes[this.scopes.length - 1];
    if (scope.has(d.name)) {
      const prev = scope.get(d.name);
      throw new CErr(d.nameTok, prev.isParam ? "redefinition of '" + d.name + "'" : "redefinition of '" + d.name + "'");
    }
    if (d.node === 'func') { // local prototype
      this.declFunc(d); return '';
    }
    d.type = this.fixType(d.type, d.nameTok);
    if (d.type.k === 'void') throw new CErr(d.nameTok, "variable has incomplete type 'void'");
    if (d.storage === 'extern') {
      const g = this.globals.get(d.name);
      if (!g) { const sym = { kind: 'var', t: d.type, js: 'G_' + d.name, tok: d.nameTok, isExtern: true, name: d.name }; this.globals.set(d.name, sym); scope.set(d.name, sym); }
      else scope.set(d.name, g);
      return '';
    }
    if (d.storage === 'static') {
      const js = 'SL' + this.tu.idx + '_' + d.name + '_' + (++this.uid);
      const sym = { kind: d.type.k === 'obj' ? 'obj' : 'var', t: d.type, js, tok: d.nameTok, name: d.name };
      // hoist to global with one-time init (constant initialisers only)
      let initCode;
      if (d.type.k === 'obj') initCode = this.genCtor(d);
      else initCode = d.init ? this.genInitializer(d.type, d.init, d.nameTok) : this.zeroValue(d.type);
      this.prog.staticLocals.push({ js, init: initCode });
      scope.set(d.name, sym);
      return '';
    }
    let type = d.type;
    if (type.k === 'auto') {
      if (!d.init) throw new CErr(d.nameTok, "declaration of variable '" + d.name + "' with deduced type 'auto' requires an initializer");
      const v = this.expr(d.init); type = v.t.k === 'arr' ? ptr(v.t.of) : v.t;
      d.type = type;
    }
    const js = 'v_' + d.name + '_' + (++this.uid);
    let code;
    if (type.k === 'obj') { code = this.genCtor(d); }
    else if (d.init) code = this.genInitializer(type, d.init, d.nameTok);
    else code = this.zeroValue(type);
    const sym = { kind: type.k === 'obj' ? 'obj' : 'var', t: type, js, tok: d.nameTok, name: d.name, isConst: !!type.cst };
    if (isIntT(type) && type.cst && d.init && d.init.node !== 'list') { const cv = this.constEval(d.init); if (cv != null) sym.cval = constWrap(cv, type); }
    scope.set(d.name, sym);
    if (bare) return js + '=' + code;
    return 'let ' + js + '=' + code + ';';
  }

  /* ---------- expressions ---------- */
  // returns {c, t, lv?, cval?}
  expr(e, discard) {
    switch (e.node) {
      case 'num': {
        if (e.fl) return { c: String(e.val), t: e.f32 ? T.float : T.double, cval: e.val };
        let t = T.int;
        if (e.uns || e.val > 0x7FFFFFFF) t = e.val > 0xFFFFFFFF ? T.ullong : T.uint;
        if (e.big && !e.uns) t = T.llong;
        return { c: String(e.val), t, cval: e.val };
      }
      case 'chr': return { c: String(e.val), t: T.char, cval: e.val };
      case 'bool': return { c: String(e.val), t: T.bool, cval: e.val };
      case 'null': return { c: 'null', t: { k: 'null', name: 'nullptr_t' } };
      case 'dur': return { c: String(e.val), t: T.dur };
      case 'dcast': { const v = this.expr(e.e); if (v.t.k !== 'dur') throw new CErr(e.loc, "no matching function for call to 'duration_cast'"); return { c: v.c, t: { k: 'dur', name: 'std::chrono::duration', div: e.div } }; }
      case 'str': {
        const k = 'K' + this.tu.idx + '_' + this.lits.length;
        this.lits.push({ js: k, bytes: e.bytes });
        return { c: k, t: Object.assign(arr(T.char, e.bytes.length + 1), { cst: true, lit: true }) };
      }
      case 'paren': { const v = this.expr(e.e, discard); return Object.assign({}, v, { paren: true, c: '(' + v.c + ')' }); }
      case 'id': return this.ident(e);
      case 'sizeof_t': return { c: String(sizeOf(e.type)), t: T.uint, cval: sizeOf(e.type) };
      case 'sizeof_e': { const v = this.expr(e.e); const n = sizeOf(v.t); return { c: String(n), t: T.uint, cval: n }; }
      case 'cast': return this.cast(e);
      case 'comma': { const a = this.expr(e.a, true), b = this.expr(e.b, discard); return { c: '(' + a.c + ',' + b.c + ')', t: b.t }; }
      case 'cond': {
        const c = this.truth(this.expr(e.c), e.c.loc);
        let a = this.expr(e.a), b = this.expr(e.b);
        if (a.t.k === 'obj') a = this.objRead(a, e.a.loc); if (b.t.k === 'obj') b = this.objRead(b, e.b.loc);
        let t;
        if (isArith(a.t) && isArith(b.t)) t = arith(a.t, b.t);
        else if (a.t.k === 'void' && b.t.k === 'void') t = T.void;
        else if (isPtrish(a.t) || isPtrish(b.t)) { t = isPtrish(a.t) ? (a.t.k === 'arr' ? ptr(a.t.of) : a.t) : (b.t.k === 'arr' ? ptr(b.t.of) : b.t); }
        else t = a.t;
        const ac = t.k === 'void' ? a.c : this.convTo(a, t, e.a.loc).c, bc = t.k === 'void' ? b.c : this.convTo(b, t, e.b.loc).c;
        const r = { c: '(' + c + '?' + ac + ':' + bc + ')', t };
        const cc = this.constEval(e); if (cc != null) r.cval = cc;
        return r;
      }
      case 'assign': return this.assign(e, discard);
      case 'preinc': case 'postinc': return this.incdec(e, discard);
      case 'unary': return this.unary(e);
      case 'bin': return this.binary(e);
      case 'call': return this.call(e, discard);
      case 'index': return this.index(e);
      case 'member': {
        const o = this.expr(e.o);
        if (o.t.k === 'reg') {
          if (!e.arrow) throw new CErr(e.loc, "member reference type is a pointer; did you mean to use '->'?");
          return { c: 'R.rg.' + o.name + '.' + e.name, t: T.uint, lv: { kind: 'reg' }, reg: true, regBase: 'R.rg.' + o.name, regName: e.name };
        }
        if (o.t.k === 'obj') throw new CErr(e.loc, "reference to non-static member function must be called");
        if (o.t.k === 'dur') throw new CErr(e.loc, "reference to non-static member function must be called");
        throw new CErr(e.loc, "member reference base type '" + tname(o.t) + "' is not a structure or union");
      }
    }
    throw new CErr(e.loc, 'unsupported expression');
  }
  ident(e) {
    const s = this.lookup(e.name);
    if (!s) {
      if (CLASSES[e.name] && !this.hasHeader('mbed')) throw new CErr(e.loc, "use of undeclared identifier '" + e.name + "'");
      if (this.lateDecl && this.lateDecl.name === e.name) { this.lateDecl = null; throw new CErr(e.loc, "use of undeclared identifier '" + e.name + "'"); }
      const sg = this.suggest(e.name);
      throw new CErr(e.loc, "use of undeclared identifier '" + e.name + "'" + (sg ? "; did you mean '" + sg + "'?" : ''));
    }
    if (s.kind === 'const') return { c: s.js, t: s.t, cval: s.val };
    if (s.kind === 'var') {
      if (s.isExtern || (!s.builtin && this.globals.get(e.name) === s)) this.refs.add(s.isStatic ? null : e.name);
      const r = { c: s.js, t: s.t, lv: { kind: 'var', sym: s }, sym: s };
      if (s.cval != null) r.cval = s.cval;
      return r;
    }
    if (s.kind === 'obj') { if (!s.isParam && this.globals.get(e.name) === s && s.isExtern) this.refs.add(e.name); return { c: s.js, t: s.t, sym: s, lv: { kind: 'obj', sym: s } }; }
    if (s.kind === 'func') return { c: null, t: { k: 'fnref', name: 'function' }, fsym: s, name: e.name };
    if (s.kind === 'bfunc') return { c: null, t: { k: 'bfref', name: 'function' }, bf: s.f, name: e.name };
    if (s.kind === 'reg') return { c: 'R.rg.' + s.name, t: { k: 'reg', name: 'register block' }, name: s.name };
    if (s.kind === 'class') throw new CErr(e.loc, "'" + e.name + "' does not refer to a value");
    throw new CErr(e.loc, "use of undeclared identifier '" + e.name + "'");
  }
  objRead(v, tok) {
    const cls = CLASSES[v.t.cls];
    if (!cls.read) throw new CErr(tok, "no viable conversion from 'mbed::" + v.t.cls + "' to 'int'");
    return { c: v.c + '.' + cls.read + '()', t: cls.rtype || T.int };
  }
  rv(v, tok) { // to rvalue (objects -> read(), arrays decay kept)
    if (v.t.k === 'obj') return this.objRead(v, tok);
    if (v.t.k === 'fnref') { return this.fnValue(v, tok); }
    return v;
  }
  fnValue(v, tok) {
    const ov = v.fsym.overloads[0];
    if (!ov.isStatic) this.refs.add(ov.key);
    return { c: ov.js, t: { k: 'fnptr', name: 'void (*)()', ov } };
  }
  convTo(v, t, tok, ctx) {
    v = this.rv(v, tok);
    const f = v.t;
    if (t.k === 'auto') return v;
    if (t.k === 'void') return v;
    if (t.k === 'int' || t.k === 'bool') {
      if (f.k === 'int' || f.k === 'bool') {
        if (t.k === 'bool') return { c: '((' + v.c + ')?1:0)', t };
        if (f.k === 'int' && t.bits >= f.bits && (t.u === f.u || (!t.u && t.bits > f.bits)) && f.bits <= 32) return { c: v.c, t };
        if (f.k === 'bool' && t.bits >= 8) return { c: v.c, t };
        if (v.cval != null) return { c: String(constWrap(v.cval, t)), t };
        return { c: wrapInt(v.c, t), t };
      }
      if (f.k === 'float') { if (t.k === 'bool') return { c: '((' + v.c + ')?1:0)', t }; return { c: wrapInt('R.ftoi(' + v.c + ')', t.bits === 64 ? T.llong : t), t }; }
      if (f.k === 'ptr' || f.k === 'arr' || f.k === 'null') {
        if (t.k === 'bool') return { c: '(' + v.c + '!==null)', t };
        throw new CErr(tok, (ctx === 'return' ? "cannot initialize return object of type '" : ctx === 'init' ? "cannot initialize a variable of type '" : "assigning to '") + tname(t) + (ctx ? "' with an lvalue of type '" : "' from incompatible type '") + tname(f) + "'");
      }
      if (f.k === 'dur') throw new CErr(tok, "no viable conversion from 'std::chrono::milliseconds' to '" + tname(t) + "'");
      if (f.k === 'void') throw new CErr(tok, (ctx === 'init' ? "cannot initialize a variable of type '" + tname(t) + "' with an rvalue of type 'void'" : "assigning to '" + tname(t) + "' from incompatible type 'void'"));
      throw new CErr(tok, "cannot convert '" + tname(f) + "' to '" + tname(t) + "'");
    }
    if (t.k === 'float') {
      if (isArith(f)) return { c: t.bits === 32 ? 'Math.fround(' + v.c + ')' : '(+' + v.c + ')', t };
      throw new CErr(tok, "assigning to '" + tname(t) + "' from incompatible type '" + tname(f) + "'");
    }
    if (t.k === 'ptr') {
      if (f.k === 'null' || (isIntT(f) && v.cval === 0)) return { c: 'null', t };
      if (f.k === 'arr') {
        if (!sameElem(f.of, t.to)) throw new CErr(tok, "cannot initialize a variable of type '" + tname(t) + "' with an lvalue of type '" + tname(f) + "'");
        return { c: 'R.ptr(' + v.c + ',0)', t };
      }
      if (f.k === 'ptr') { if (!sameElem(f.to, t.to) && t.to.k !== 'void' && f.to.k !== 'void') throw new CErr(tok, "cannot initialize a variable of type '" + tname(t) + "' with an lvalue of type '" + tname(f) + "'"); return { c: v.c, t }; }
      if (f.k === 'fnptr') return v;
      throw new CErr(tok, (ctx === 'init' ? "cannot initialize a variable of type '" : "assigning to '") + tname(t) + (ctx === 'init' ? "' with an rvalue of type '" : "' from incompatible type '") + tname(f) + "'");
    }
    if (t.k === 'arr') throw new CErr(tok, "array type '" + tname(t) + "' is not assignable");
    if (t.k === 'dur') { if (f.k === 'dur') return v; if (isArith(f)) return { c: '(' + v.c + ')*1e6', t }; }
    if (t === 'time') { if (f.k === 'dur') return v; if (isArith(f)) return { c: '((' + v.c + ')*1e6)', t: T.dur }; }
    if (t.k === 'obj') throw new CErr(tok, 'copying mbed objects is not supported');
    if (t.k === 'fnptr') return v;
    return v;
  }
  cast(e) {
    const v = this.rv(this.expr(e.e), e.loc);
    const t = e.type;
    if (t.k === 'void') return { c: v.c, t: T.void };
    if (t.k === 'ptr') {
      if (v.t.k === 'arr') return { c: 'R.ptr(' + v.c + ',0)', t };
      if (v.t.k === 'ptr' || v.t.k === 'null') return { c: v.c, t };
      if (isIntT(v.t) && v.cval === 0) return { c: 'null', t };
      if (isIntT(v.t)) return { c: 'null', t };
      throw new CErr(e.loc, "cannot cast from type '" + tname(v.t) + "' to pointer type '" + tname(t) + "'");
    }
    if ((t.k === 'int') && (v.t.k === 'fnptr' || v.t.k === 'ptr')) return { c: v.c, t: T.uint, fnp: true };
    const r = this.convTo(v, t, e.loc);
    if (v.cval != null && isArith(t)) r.cval = constWrap(v.cval, t);
    return r;
  }
  lvalue(e, v, opTok) {
    if (v.t.k === 'arr') throw new CErr(e.loc, "array type '" + tname(v.t) + "' is not assignable");
    if (v.reg) return;
    if (!v.lv) throw new CErr(opTok || e.loc, 'expression is not assignable');
    if (v.lv.kind === 'var' && v.lv.sym.isConst) throw new CErr(opTok || e.loc, "cannot assign to variable '" + v.lv.sym.name + "' with const-qualified type '" + tname(v.t) + "'");
    if (v.t.cst && v.lv.kind !== 'var') throw new CErr(opTok || e.loc, 'read-only variable is not assignable');
  }
  store(v, valCode) {
    // returns code that assigns valCode (already converted) to lvalue v
    if (v.reg) return v.c + '=' + valCode;
    if (v.lv.kind === 'pidx') return v.lv.base + '.a[' + v.lv.base + '.i+(' + v.lv.idx + ')]=' + valCode;
    return v.c + '=' + valCode;
  }
  assign(e, discard) {
    const l = this.expr(e.l);
    if (l.t.k === 'obj') {
      const cls = CLASSES[l.t.cls];
      if (e.op !== '=') {
        if (!cls.write) throw new CErr(e.loc, "no viable overloaded '" + e.op + "'");
        const r = this.binOp(e.op.slice(0, -1), this.objRead(l, e.l.loc), this.rv(this.expr(e.r), e.r.loc), e);
        return { c: l.c + '.' + cls.write + '(' + this.convTo(r, cls.rtype || T.int, e.loc).c + ')', t: cls.rtype || T.int };
      }
      if (!cls.write) throw new CErr(e.loc, "no viable overloaded '='");
      const r = this.expr(e.r);
      if (r.t.k === 'obj' && r.t.cls === l.t.cls && r.sym === l.sym) { /* x = x */ }
      const rc = this.convTo(r, cls.rtype || T.int, e.r.loc);
      return { c: l.c + '.' + cls.write + '(' + rc.c + ')', t: cls.rtype || T.int };
    }
    if (l.t.k === 'fnref' || l.t.k === 'bfref') throw new CErr(e.loc, 'non-object type is not assignable');
    this.lvalue(e.l, l, e.loc);
    const r = this.expr(e.r);
    if (e.op === '=') {
      this.checkConstConv(r, l.t, e.r);
      const rc = this.convTo(r, l.reg ? T.uint : l.t, e.r.loc);
      return { c: '(' + this.store(l, rc.c) + ')', t: l.t };
    }
    const op = e.op.slice(0, -1);
    if (l.t.k === 'ptr' && (op === '+' || op === '-')) {
      const rr = this.rv(r, e.r.loc);
      return { c: '(' + this.store(l, 'R.padd(' + l.c + ',' + (op === '-' ? '-' : '') + '(' + rr.c + '))') + ')', t: l.t };
    }
    const res = this.binOp(op, this.rv(l, e.l.loc), this.rv(r, e.r.loc), e);
    const rc = this.convTo(res, l.reg ? T.uint : l.t, e.loc);
    return { c: '(' + this.store(l, rc.c) + ')', t: l.t };
  }
  incdec(e, discard) {
    const v = this.expr(e.e);
    const one = e.op === '++' ? '+1' : '-1', back = e.op === '++' ? '-1' : '+1';
    if (v.t.k === 'obj') throw new CErr(e.loc, "cannot increment value of type 'mbed::" + v.t.cls + "'");
    this.lvalue(e.e, v, e.loc);
    if (v.t.k === 'ptr') {
      const nv = 'R.padd(' + v.c + ',' + one + ')';
      if (e.node === 'preinc' || discard) return { c: '(' + this.store(v, nv) + ')', t: v.t };
      return { c: '(' + this.store(v, nv) + ',R.padd(' + v.c + ',' + back + '))', t: v.t };
    }
    if (!isArith(v.t) && !v.reg) throw new CErr(e.loc, "cannot increment value of type '" + tname(v.t) + "'");
    const t = v.reg ? T.uint : v.t;
    const nv = t.k === 'float' ? '(' + v.c + one + ')' : wrapInt(v.c + one, t.k === 'bool' ? T.uchar : t);
    if (e.node === 'preinc' || discard) return { c: '(' + this.store(v, nv) + ')', t };
    const old = t.k === 'float' ? '(' + v.c + back + ')' : wrapInt(v.c + back, t.k === 'bool' ? T.uchar : t);
    return { c: '(' + this.store(v, nv) + ',' + old + ')', t };
  }
  unary(e) {
    if (e.op === '&') {
      const v = this.expr(e.e);
      if (v.t.k === 'fnref') return this.fnValue(v, e.loc);
      if (v.lv && v.lv.kind === 'arrel') return { c: 'R.ptr(' + v.lv.base + ',' + v.lv.idx + ')', t: ptr(v.t) };
      if (v.lv && v.lv.kind === 'pidx') return { c: 'R.padd(' + v.lv.base + ',' + v.lv.idx + ')', t: ptr(v.t) };
      if (v.t.k === 'arr') return { c: 'R.ptr(' + v.c + ',0)', t: ptr(v.t) };
      if (v.reg) return { c: '0', t: ptr(T.uint) };
      throw new CErr(e.loc, "taking the address of a variable ('&" + (e.e.name || '...') + "') is not supported by the MAPP simulator");
    }
    if (e.op === '*') {
      const v = this.rv(this.expr(e.e), e.e.loc);
      if (v.t.k === 'ptr') return { c: v.c + '.a[' + v.c + '.i]', t: v.t.to, lv: { kind: 'pidx', base: v.c, idx: '0' } };
      if (v.t.k === 'arr') return { c: v.c + '[0]', t: v.t.of, lv: { kind: 'arrel', base: v.c, idx: '0' } };
      if (v.t.k === 'fnptr') return v;
      throw new CErr(e.loc, "indirection requires pointer operand ('" + tname(v.t) + "' invalid)");
    }
    const v = this.rv(this.expr(e.e), e.e.loc);
    if (e.op === '!') {
      const r = { c: '(+!' + this.truth(v, e.loc) + ')', t: T.bool };
      if (v.cval != null) r.cval = v.cval ? 0 : 1;
      return r;
    }
    if (!isArith(v.t)) throw new CErr(e.loc, "invalid argument type '" + tname(v.t) + "' to unary expression");
    const t = v.t.k === 'float' ? v.t : promote(v.t);
    let c;
    if (e.op === '-') c = t.k === 'float' ? '(-' + v.c + ')' : wrapInt('-' + v.c, t);
    else if (e.op === '+') c = '(+' + v.c + ')';
    else if (e.op === '~') { if (t.k === 'float') throw new CErr(e.loc, "invalid argument type '" + tname(t) + "' to unary expression"); c = wrapInt('~' + v.c, t); }
    const r = { c, t };
    if (v.cval != null) r.cval = e.op === '-' ? constWrap(-v.cval, t) : e.op === '~' ? constWrap(~v.cval, t) : v.cval;
    return r;
  }
  binary(e) {
    if (e.op === '&&' || e.op === '||') {
      const a = this.truth(this.expr(e.l), e.l.loc), b = this.truth(this.expr(e.r), e.r.loc);
      const r = { c: '(+(!!' + a + e.op + '!!' + b + '))', t: T.bool };
      const cv = this.constEval(e); if (cv != null) r.cval = cv;
      return r;
    }
    if ((e.op === '<' || e.op === '>') && e.l.node === 'bin' && ['<', '>', '<=', '>='].includes(e.l.op)) { /* a<b<c */ }
    const a = this.rv(this.expr(e.l), e.l.loc), b = this.rv(this.expr(e.r), e.r.loc);
    if ((e.op === '==' || e.op === '!=') && (e.l.node === 'assign')) { }
    return this.binOp(e.op, a, b, e);
  }
  binOp(op, a, b, e) {
    const loc = e.loc;
    // pointer arithmetic
    const ap = isPtrish(a.t), bp = isPtrish(b.t);
    if (ap || bp || a.t.k === 'null' || b.t.k === 'null') {
      const P = v => v.t.k === 'arr' ? 'R.ptr(' + v.c + ',0)' : v.c;
      if ((op === '+' || op === '-') && ap && isIntT(b.t)) return { c: 'R.padd(' + P(a) + ',' + (op === '-' ? '-' : '') + '(' + b.c + '))', t: a.t.k === 'arr' ? ptr(a.t.of) : a.t };
      if (op === '+' && bp && isIntT(a.t)) return { c: 'R.padd(' + P(b) + ',' + a.c + ')', t: b.t.k === 'arr' ? ptr(b.t.of) : b.t };
      if (op === '-' && ap && bp) return { c: '(' + P(a) + '.i-' + P(b) + '.i)', t: T.int };
      if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
        const A = (a.t.k === 'null' || (isIntT(a.t) && a.cval === 0)) ? 'null' : P(a), Bc = (b.t.k === 'null' || (isIntT(b.t) && b.cval === 0)) ? 'null' : P(b);
        if (op === '==' || op === '!=') {
          if (a.t.k === 'arr' && b.t.k === 'str') { }
          if ((isIntT(a.t) && a.cval !== 0 && !ap) || (isIntT(b.t) && b.cval !== 0 && !bp)) throw new CErr(loc, "comparison between pointer and integer ('" + tname(a.t) + "' and '" + tname(b.t) + "')");
          return { c: '(+R.peq(' + A + ',' + Bc + (op === '!=' ? ',1' : ',0') + '))', t: T.bool };
        }
        return { c: '(+(' + A + '.i' + op + Bc + '.i))', t: T.bool };
      }
      throw new CErr(loc, "invalid operands to binary expression ('" + tname(a.t) + "' and '" + tname(b.t) + "')");
    }
    if (!isArith(a.t) || !isArith(b.t)) {
      if (a.t.k === 'dur' && b.t.k === 'dur' && (op === '+' || op === '-')) return { c: '(' + a.c + op + b.c + ')', t: T.dur };
      if ((a.t.k === 'dur' && isArith(b.t)) || (b.t.k === 'dur' && isArith(a.t))) { if (op === '*') return { c: '(' + a.c + '*' + b.c + ')', t: T.dur }; }
      if (a.t.k === 'dur' && b.t.k === 'dur' && ['<', '>', '<=', '>=', '==', '!='].includes(op)) return { c: '(+(' + a.c + op + b.c + '))', t: T.bool };
      throw new CErr(loc, "invalid operands to binary expression ('" + tname(a.t) + "' and '" + tname(b.t) + "')");
    }
    const cv = (a.cval != null && b.cval != null) ? foldBin(op, a, b) : undefined;
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      const t = arith(a.t, b.t);
      let ac = a.c, bc = b.c;
      if (t.k === 'int' && t.u && t.bits === 32) {
        if (!a.t.u && a.cval == null) ac = '(' + a.c + '>>>0)';
        if (!b.t.u && b.cval == null) bc = '(' + b.c + '>>>0)';
        if (a.cval != null) ac = String(a.cval >>> 0); if (b.cval != null) bc = String(b.cval >>> 0);
      }
      const jop = op === '==' ? '===' : op === '!=' ? '!==' : op;
      const r = { c: '(+(' + ac + jop + bc + '))', t: T.bool };
      if (cv !== undefined) r.cval = cv;
      return r;
    }
    let t = (op === '<<' || op === '>>') ? (a.t.k === 'float' ? null : promote(a.t)) : arith(a.t, b.t);
    if (!t || ((['%', '&', '|', '^', '<<', '>>'].includes(op)) && (a.t.k === 'float' || b.t.k === 'float')))
      throw new CErr(loc, "invalid operands to binary expression ('" + tname(a.t) + "' and '" + tname(b.t) + "')");
    let c;
    const fl = t.k === 'float';
    const u32 = t.k === 'int' && t.u && t.bits === 32, big = t.bits === 64 && !fl;
    switch (op) {
      case '+': case '-': c = fl || big ? '(' + a.c + op + b.c + ')' : wrapInt(a.c + op + b.c, t); break;
      case '*': c = fl || big ? '(' + a.c + '*' + b.c + ')' : (u32 ? '(Math.imul(' + a.c + ',' + b.c + ')>>>0)' : 'Math.imul(' + a.c + ',' + b.c + ')'); break;
      case '/':
        if (b.cval === 0 && !fl) this.warn(loc, 'division by zero is undefined [-Wdivision-by-zero]');
        c = fl ? '(' + a.c + '/' + b.c + ')' : 'R.div(' + a.c + ',' + b.c + (u32 ? ',1' : '') + ')'; break;
      case '%':
        if (b.cval === 0) this.warn(loc, 'remainder by zero is undefined [-Wdivision-by-zero]');
        c = 'R.mod(' + a.c + ',' + b.c + (u32 ? ',1' : '') + ')'; break;
      case '&': case '|': case '^': c = u32 ? '((' + a.c + op + b.c + ')>>>0)' : '(' + a.c + op + b.c + ')'; break;
      case '<<': c = u32 ? '((' + a.c + '<<' + b.c + ')>>>0)' : '(' + a.c + '<<' + b.c + ')'; break;
      case '>>': c = u32 ? '(' + a.c + '>>>' + b.c + ')' : '(' + a.c + '>>' + b.c + ')'; break;
      default: throw new CErr(loc, 'unsupported operator ' + op);
    }
    if (t.k === 'float' && t.bits === 32 && (op === '+' || op === '-' || op === '*' || op === '/')) c = 'Math.fround' + c;
    const r = { c, t };
    if (cv !== undefined) { const w = fl ? cv : constWrap(cv, t); r.cval = w; if (!fl) r.c = String(w); }
    return r;
  }
  index(e) {
    const a = this.rv(this.expr(e.a), e.a.loc), i = this.rv(this.expr(e.i), e.i.loc);
    let base = a, idx = i;
    if (isIntT(a.t) && isPtrish(i.t)) { base = i; idx = a; }
    if (base.t.k === 'reg' || base.reg) { // AFIO->EXTICR[3]
      return { c: 'R.rga(' + base.regBase + ',' + JSON.stringify(base.regName) + ')[' + idx.c + ']', t: T.uint, reg: true };
    }
    if (!isIntT(idx.t)) throw new CErr(e.i.loc, 'array subscript is not an integer');
    if (base.t.k === 'arr') {
      if (idx.cval != null && base.t.n != null && (idx.cval >= base.t.n || idx.cval < 0))
        this.warn(e.i.loc, "array index " + idx.cval + " is past the end of the array (which contains " + base.t.n + " elements) [-Warray-bounds]");
      return { c: base.c + '[' + idx.c + ']', t: base.t.of, lv: { kind: 'arrel', base: base.c, idx: idx.c } };
    }
    if (base.t.k === 'ptr') return { c: base.c + '.a[' + base.c + '.i+(' + idx.c + ')]', t: base.t.to, lv: { kind: 'pidx', base: base.c, idx: idx.c } };
    throw new CErr(e.loc, "subscripted value is not an array, pointer, or vector");
  }
  call(e, discard) {
    const f = e.f;
    // method call obj.method(...)
    if (f.node === 'member') {
      const o = this.expr(f.o);
      if (o.t.k === 'obj') return this.methodCall(o, f, e);
      if (o.t.k === 'dur' && f.name === 'count') return { c: 'Math.trunc((' + o.c + ')/' + (o.t.div || 1) + ')', t: T.llong };
      if (o.reg) throw new CErr(f.loc, 'called object type is not a function or function pointer');
      throw new CErr(f.loc, "member reference base type '" + tname(o.t) + "' is not a structure or union");
    }
    if (f.node === 'id' && /^(duration_cast<|chrono::)/.test(f.name)) throw new CErr(f.loc, 'chrono casts are not supported by the MAPP simulator');
    const fv = f.node === 'id' ? this.ident(f) : this.expr(f);
    if (fv.t.k === 'bfref') return this.builtinCall(fv.bf, fv.name, e);
    if (fv.t.k === 'fnref') {
      const sym = fv.fsym;
      const cands = sym.overloads.filter(o => o.params.length === e.args.length);
      if (!cands.length) {
        const o = sym.overloads[0];
        if (sym.overloads.length === 1) throw new CErr(e.args.length > o.params.length ? e.args[o.params.length].loc : e.lp,
          (e.args.length > o.params.length ? 'too many' : 'too few') + ' arguments to function call, expected ' + o.params.length + ', have ' + e.args.length);
        throw new CErr(f.loc, "no matching function for call to '" + sym.name + "'");
      }
      const argv = e.args.map(a => this.expr(a));
      let ov = cands[0];
      if (cands.length > 1) {
        const exact = cands.find(o => o.params.every((p, i) => tname(p) === tname(this.rv(argv[i], e.args[i].loc).t)));
        if (exact) ov = exact;
      }
      const args = argv.map((v, i) => {
        const pt = ov.params[i];
        try { return this.convTo(v, pt, e.args[i].loc, 'arg').c; }
        catch (er) { if (er instanceof CErr) throw new CErr(e.args[i].loc, "no matching function for call to '" + sym.name + "'"); throw er; }
      });
      if (!ov.isStatic) this.refs.add(ov.key);
      return { c: '(yield* ' + ov.js + '(' + args.join(',') + '))', t: ov.ret, call: true };
    }
    if (fv.t.k === 'fnptr') return { c: '(yield* (' + fv.c + ')())', t: T.void };
    throw new CErr(e.lp || f.loc, "called object type '" + tname(fv.t) + "' is not a function or function pointer");
  }
  builtinCall(bf, name, e) {
    if (bf.deprecated) this.warn(e.loc, bf.deprecated);
    const np = bf.params.length;
    if (e.args.length < np || (!bf.variadic && e.args.length > np)) {
      if (e.args.length < np) throw new CErr(e.lp, 'too few arguments to function call, expected ' + (bf.variadic ? 'at least ' : '') + np + ', have ' + e.args.length);
      throw new CErr(e.args[np].loc, 'too many arguments to function call, expected ' + np + ', have ' + e.args.length);
    }
    const args = e.args.map((a, i) => {
      const v = this.expr(a);
      const pt = bf.params[i];
      if (pt === undefined) { // variadic extra
        const r = this.rv(v, a.loc);
        if (r.t.k === 'arr') return 'R.ptr(' + r.c + ',0)';
        if (r.t.k === 'void') throw new CErr(a.loc, "argument type 'void' is incomplete");
        return r.c;
      }
      if (pt === 'fn') { const r = v.t.k === 'fnref' ? this.fnValue(v, a.loc) : v; if (r.t.k !== 'fnptr') throw new CErr(a.loc, "no matching function for call to '" + name + "'"); return r.c; }
      if (pt === 'time') { const r = this.rv(v, a.loc); if (r.t.k === 'dur') return r.c; if (isArith(r.t)) return '((' + r.c + ')*1000)'; throw new CErr(a.loc, "no matching function for call to '" + name + "'"); }
      if (pt === 'any') return this.rv(v, a.loc).c || '0';
      if (pt.k === 'ptr') {
        const r = this.rv(v, a.loc);
        if (r.t.k === 'arr' || r.t.k === 'ptr' || r.t.k === 'null') return this.convTo(r, ptr(r.t.k === 'arr' ? r.t.of : r.t.k === 'ptr' ? r.t.to : T.char), a.loc).c;
        throw new CErr(a.loc, "no matching function for call to '" + name + "'" );
      }
      if (v.t.k === 'dur') throw new CErr(a.loc, "no matching function for call to '" + name + "'");
      return this.convTo(v, pt, a.loc, 'arg').c;
    });
    if ((name === 'printf' || name === 'sprintf') && e.args[0] && e.args[0].node !== 'str' && name === 'printf') this.warn(e.args[0].loc, 'format string is not a string literal (potentially insecure) [-Wformat-security]');
    if (name === 'printf' && e.args[0] && e.args[0].node === 'str') this.checkFormat(e.args[0], e.args.slice(1));
    const ret = bf.ret === 'fn' ? { k: 'fnptr', name: 'callback' } : bf.ret;
    return { c: bf.code(args), t: ret, call: true };
  }
  checkFormat(fmtNode, args) {
    const s = String.fromCharCode(...fmtNode.bytes);
    const re = /%[-+ #0]*(\d+|\*)?(\.(\d+|\*))?(hh|h|ll|l|z|j|t|L)?([diuxXoscfFeEgGp%])/g;
    let m, n = 0;
    while ((m = re.exec(s))) { if (m[5] !== '%') n++; }
    if (n > args.length) this.warn(fmtNode.loc, "more '%' conversions than data arguments [-Wformat-insufficient-args]");
    else if (n < args.length) this.warn(args[n].loc, 'data argument not used by format string [-Wformat-extra-args]');
  }
  methodCall(o, f, e) {
    const cls = CLASSES[o.t.cls];
    const m = cls.methods[f.name];
    if (!m) {
      const sg = Object.keys(cls.methods).find(k => editDist(k, f.name) <= 1.5);
      throw new CErr(f.loc, "no member named '" + f.name + "' in 'mbed::" + o.t.cls + "'" + (sg ? "; did you mean '" + sg + "'?" : ''));
    }
    if (e.args.length !== m.params.length) {
      throw new CErr(e.args.length > m.params.length ? e.args[m.params.length].loc : e.lp,
        (e.args.length > m.params.length ? 'too many' : 'too few') + ' arguments to function call, expected ' + m.params.length + ', have ' + e.args.length);
    }
    const args = e.args.map((a, i) => {
      const v = this.expr(a), pt = m.params[i];
      if (pt === 'fn') { const r = v.t.k === 'fnref' ? this.fnValue(v, a.loc) : v; if (r.t.k !== 'fnptr') throw new CErr(a.loc, "no matching member function for call to '" + f.name + "'"); return r.c; }
      if (pt === 'time') { const r = this.rv(v, a.loc); if (r.t.k === 'dur') return r.c; if (isArith(r.t)) return '((' + r.c + ')*1e6)'; throw new CErr(a.loc, "no matching member function for call to '" + f.name + "'"); }
      return this.convTo(v, pt, a.loc, 'arg').c;
    });
    let ret = m.ret === 'dur' ? T.dur : m.ret;
    return { c: o.c + '.' + m.js + '(' + args.join(',') + ')', t: ret };
  }

  /* ---------- constant evaluation (for array sizes, case labels, enums) ---------- */
  constEval(e) {
    try {
      switch (e.node) {
        case 'num': return e.fl ? undefined : e.val;
        case 'chr': return e.val;
        case 'bool': return e.val;
        case 'paren': return this.constEval(e.e);
        case 'id': {
          const s = this.lookup(e.name, true);
          if (!s) return undefined;
          if (s.kind === 'const') return s.val;
          if (s.kind === 'var' && s.cval != null) return s.cval;
          return undefined;
        }
        case 'sizeof_t': return sizeOf(e.type);
        case 'sizeof_e': { const v = this.expr(e.e); return sizeOf(v.t); }
        case 'cast': { const v = this.constEval(e.e); return v == null ? undefined : (isArith(e.type) ? constWrap(v, e.type) : undefined); }
        case 'unary': {
          const v = this.constEval(e.e); if (v == null) return undefined;
          return e.op === '-' ? -v : e.op === '+' ? v : e.op === '~' ? ~v : e.op === '!' ? (v ? 0 : 1) : undefined;
        }
        case 'bin': {
          const a = this.constEval(e.l); if (a == null) return undefined;
          const b = this.constEval(e.r); if (b == null) return undefined;
          return foldBin(e.op, { cval: a, t: T.int }, { cval: b, t: T.int });
        }
        case 'cond': { const c = this.constEval(e.c); if (c == null) return undefined; return c ? this.constEval(e.a) : this.constEval(e.b); }
      }
    } catch (x) { return undefined; }
    return undefined;
  }
}
function foldBin(op, a, b) {
  const x = a.cval, y = b.cval;
  const fl = (a.t && a.t.k === 'float') || (b.t && b.t.k === 'float');
  switch (op) {
    case '+': return x + y; case '-': return x - y; case '*': return fl ? x * y : Math.imul(x, y);
    case '/': if (y === 0) return undefined; return fl ? x / y : Math.trunc(x / y);
    case '%': if (y === 0) return undefined; return x % y;
    case '&': return x & y; case '|': return x | y; case '^': return x ^ y;
    case '<<': return x << y; case '>>': return x >> y;
    case '==': return +(x === y); case '!=': return +(x !== y); case '<': return +(x < y); case '>': return +(x > y);
    case '<=': return +(x <= y); case '>=': return +(x >= y);
    case '&&': return +(!!x && !!y); case '||': return +(!!x || !!y);
  }
  return undefined;
}
function sameElem(a, b) {
  if (a.k === 'int' && b.k === 'int') return a.bits === b.bits && (a.bits === 8 || a.u === b.u);
  return a.k === b.k && (a.k !== 'ptr' || sameElem(a.to, b.to));
}
function jsId(s) { return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'v'; }

/* ======================================================================
 * Build driver: compile all project sources, link, emit program factory
 * ==================================================================== */
// sources: [{path, name, text}] ; fs: {resolveInclude(name, fromPath, angled)}
// returns {ok, diags:[{file,line,col,msg,kind,path,src}], compiled:[names], linkErrors:[], code, entry, stats}
function buildProgram(sources, fs) {
  const prog = { staticLocals: [] };
  const units = [];
  const allDiags = [];
  const perFile = [];
  sources.forEach((src, idx) => {
    const tu = { idx, name: src.name, path: src.path, headers: new Set() };
    const fileDiags = [];
    const fileInfo = { name: src.name, path: src.path, diags: fileDiags, includes: [] };
    perFile.push(fileInfo);
    let pp;
    try {
      pp = new Preprocessor(fs);
      const toks = pp.run(src.path, src.text, src.name);
      tu.headers = pp.headers;
      fileInfo.includes = pp.includes;
      for (const d of pp.diags) fileDiags.push(mkDiag(d.tok, d.msg, d.kind));
      const comp = new TUCompiler(prog, tu);
      const parser = new Parser(toks, comp);
      comp.parser = parser;
      let items;
      try { items = parser.parseTU(); }
      catch (e) {
        if (!(e instanceof CErr)) throw e;
        fileDiags.push(mkDiag(e.tok, e.message, e.fatal ? 'fatal' : 'error'));
        // try to also report semantic errors found so far? keep it to the parse error (like clang's first error)
        units.push({ tu, failed: true });
        return;
      }
      const out = comp.compile(items);
      const all = (parser.errors || []).map(e => ({ tok: e.tok, msg: e.message, kind: 'error' })).concat(comp.diags);
      all.sort((a, b) => ((a.tok && a.tok.path) === (b.tok && b.tok.path) ? ((a.tok.line - b.tok.line) || (a.tok.col - b.tok.col)) : 0));
      for (const d of all) fileDiags.push(mkDiag(d.tok, d.msg, d.kind));
      units.push({ tu, out, comp, failed: fileDiags.some(d => d.kind !== 'warning') });
    } catch (e) {
      if (e instanceof CErr) { fileDiags.push(mkDiag(e.tok, e.message, e.fatal ? 'fatal' : 'error')); units.push({ tu, failed: true }); if (pp) fileInfo.includes = pp.includes; return; }
      fileDiags.push({ file: src.name, line: 1, col: 1, msg: 'internal compiler error: ' + (e && e.message), kind: 'error', path: src.path });
      units.push({ tu, failed: true });
    }
  });
  for (const f of perFile) allDiags.push(...f.diags);
  const compileErrors = allDiags.filter(d => d.kind !== 'warning').length;
  const result = { ok: false, perFile, diags: allDiags, linkErrors: [], warnings: allDiags.filter(d => d.kind === 'warning').length };
  if (compileErrors) { result.errors = compileErrors; return result; }

  // ---- link
  const defs = new Map(); // key -> [{unit, def}]
  for (const u of units) for (const d of u.comp.defs) { if (!defs.has(d.key)) defs.set(d.key, []); defs.get(d.key).push({ u, d }); }
  const linkErrors = [];
  const objName = u => u.tu.name.replace(/\.[^.]+$/, '').toLowerCase() + '.o';
  for (const [key, list] of defs) {
    if (list.length > 1) linkErrors.push('Error: L6200E: Symbol ' + (list[0].d.kind === 'func' && key !== 'main' ? key : key) + ' multiply defined (by ' + objName(list[1].u) + ' and ' + objName(list[0].u) + ').');
  }
  const undefinedSeen = new Set();
  for (const u of units) {
    for (const r of u.comp.refs) {
      if (r == null) continue;
      if (!defs.has(r) && !undefinedSeen.has(r + '@' + u.tu.idx)) {
        undefinedSeen.add(r + '@' + u.tu.idx);
        linkErrors.push('Error: L6218E: Undefined symbol ' + r + ' (referred from ' + objName(u) + ').');
      }
    }
  }
  if (!defs.has('main')) linkErrors.push('Error: L6218E: Undefined symbol main (referred from mbed_rtos_rtx.o).');
  if (linkErrors.length) { result.linkErrors = linkErrors; result.errors = linkErrors.length; return result; }

  // ---- emit
  let code = '"use strict";\n';
  const varNames = new Set();
  for (const u of units) for (const v of u.out.vars) varNames.add(v);
  for (const s of prog.staticLocals) varNames.add(s.js);
  if (varNames.size) code += 'let ' + [...varNames].join(',') + ';\n';
  for (const u of units) for (const l of u.out.lits) code += 'const ' + l.js + '=R.lit(' + JSON.stringify(l.bytes) + ');\n';
  for (const u of units) for (const f of u.out.funcs) code += f + '\n';
  code += 'function* __init(){\n';
  for (const s of prog.staticLocals) code += s.js + '=' + s.init + ';\n';
  for (const u of units) for (const i of u.out.init) code += i + '\n';
  code += '}\nreturn {init:__init, main:F_main};';
  let factory;
  try { factory = new Function('R', code); }
  catch (e) { result.errors = 1; result.linkErrors = ['Error: internal code generation error: ' + e.message]; result.code = code; return result; }
  result.ok = true; result.code = code; result.factory = factory;
  // fake size stats
  const n = code.length;
  result.stats = { code: 30816 + Math.round(n * 0.9) & ~3, ro: 1460 + units.reduce((a, u) => a + u.out.lits.reduce((b, l) => b + l.bytes.length + 1, 0), 0), rw: 172 + varNames.size * 4 & ~3, zi: 4644 + varNames.size * 8 };
  return result;
}
function mkDiag(tok, msg, kind) {
  tok = tok || {};
  return { file: tok.file || '?', line: tok.line || 1, col: tok.col || 1, msg, kind: kind || 'error', path: tok.path, macro: tok.macro };
}

G.MappCompiler = { buildProgram, Preprocessor, Parser, CErr, lexLine, stripComments };
})(typeof window !== 'undefined' ? window : globalThis);
