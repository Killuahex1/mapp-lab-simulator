// uvision.js — Keil µVision 5 look-alike (project, editor, build, flash)
(function (G) {
'use strict';
const { h, I, WM, showMenu, menuBar, modal, msgBox, fileDialog } = G;

const KW = new Set('auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false class namespace using new delete nullptr template typename public private protected virtual operator this constexpr'.split(' '));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function highlight(src) {
  const re = /(\/\/[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?)|('(?:\\.|[^'\\\n])*'?)|(^[ \t]*#[ \t]*[a-z]+)|(\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?)[uUlLfF]*(?:ms|us|s)?\b)|(\b[A-Za-z_]\w*\b)/gm;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index)); last = re.lastIndex;
    const t = esc(m[0]);
    if (m[1] || m[2]) out += '<span class="c">' + t + '</span>';
    else if (m[3]) out += '<span class="s">' + t + '</span>';
    else if (m[4]) out += '<span class="ch">' + t + '</span>';
    else if (m[5]) out += '<span class="pp">' + t + '</span>';
    else if (m[6]) out += '<span class="n">' + t + '</span>';
    else if (m[7]) out += KW.has(m[7]) ? '<span class="k">' + t + '</span>' : t;
    if (m[0] === '') re.lastIndex++;
  }
  return out + esc(src.slice(last)) + '\n';
}

/* ---------------- Code editor (textarea overlay) ---------------- */
let charW = 0;
const LH = 17, PAD = 4;
class CodeEditor {
  constructor(text, onChange, onCursor) {
    this.onChange = onChange; this.onCursor = onCursor; this.marks = new Map();
    this.gutIn = h('div.ce-gutin');
    this.gut = h('div.ce-gut', null, this.gutIn);
    this.cur = h('div.ce-cur');
    this.flash = h('div.ce-flash');
    this.hl = h('pre.ce-hl');
    this.ta = h('textarea.ce-ta', { spellcheck: 'false', wrap: 'off', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off' });
    this.sc = h('div.ce-sc', null, this.cur, this.flash, this.hl, this.ta);
    this.el = h('div.ce', null, this.gut, this.sc);
    this.ta.value = text;
    this.ta.addEventListener('input', () => { this.refresh(); this.onChange && this.onChange(); });
    this.ta.addEventListener('scroll', () => { this.ta.scrollTop = 0; this.ta.scrollLeft = 0; });
    this.sc.addEventListener('scroll', () => { this.gutIn.style.transform = 'translateY(' + (-this.sc.scrollTop) + 'px)'; });
    const cursor = () => { this.paintCursor(); this.onCursor && this.onCursor(); };
    ['keyup', 'click', 'select', 'focus'].forEach(ev => this.ta.addEventListener(ev, cursor));
    this.ta.addEventListener('keydown', e => this.key(e));
    this.refresh();
  }
  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this.refresh(); }
  measure() {
    if (charW) return;
    const s = h('span.ce-measure', { text: 'MMMMMMMMMM' }); document.body.append(s); charW = s.getBoundingClientRect().width / 10 || 7.8; s.remove();
  }
  refresh() {
    this.measure();
    const v = this.ta.value;
    this.hl.innerHTML = highlight(v);
    const lines = v.split('\n');
    let maxLen = 0; for (const l of lines) { const n = l.replace(/\t/g, '    ').length; if (n > maxLen) maxLen = n; }
    const W = Math.max(this.sc.clientWidth, maxLen * charW + 60), H = Math.max(this.sc.clientHeight, lines.length * LH + PAD * 2 + 40);
    this.ta.style.width = W + 'px'; this.ta.style.height = H + 'px'; this.hl.style.width = W + 'px'; this.hl.style.minHeight = H + 'px';
    if (this.nLines !== lines.length || this.marksDirty) {
      this.nLines = lines.length; this.marksDirty = false;
      let g = '';
      for (let i = 1; i <= lines.length; i++) {
        const mk = this.marks.get(i);
        g += '<div class="ce-ln">' + (mk ? '<span class="ce-mk ' + mk.kind + '" title="' + esc(mk.msg) + '"></span>' : '') + i + '</div>';
      }
      this.gutIn.innerHTML = g;
    }
    this.paintCursor();
  }
  setMarks(list) { this.marks = new Map(); for (const d of list) { const ex = this.marks.get(d.line); if (!ex || d.kind !== 'warning') this.marks.set(d.line, { kind: d.kind === 'warning' ? 'w' : 'e', msg: (ex ? ex.msg + '\n' : '') + d.msg }); } this.marksDirty = true; this.refresh(); }
  caretLC() { const b = this.ta.value.slice(0, this.ta.selectionStart).split('\n'); return { line: b.length, col: b[b.length - 1].length + 1 }; }
  paintCursor() { const { line } = this.caretLC(); this.cur.style.top = (PAD + (line - 1) * LH) + 'px'; }
  gotoLine(line, col, flash) {
    const lines = this.ta.value.split('\n');
    line = Math.max(1, Math.min(lines.length, line));
    let pos = 0; for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    const end = pos + lines[line - 1].length;
    this.ta.focus();
    if (col) this.ta.setSelectionRange(pos + Math.min(col - 1, lines[line - 1].length), pos + Math.min(col - 1, lines[line - 1].length));
    else this.ta.setSelectionRange(pos, pos);
    const y = PAD + (line - 1) * LH;
    if (y < this.sc.scrollTop + LH || y > this.sc.scrollTop + this.sc.clientHeight - 3 * LH) this.sc.scrollTop = Math.max(0, y - this.sc.clientHeight / 3);
    this.sc.scrollLeft = 0;
    if (flash) { this.flash.style.top = y + 'px'; this.flash.classList.remove('on'); void this.flash.offsetWidth; this.flash.classList.add('on'); }
    this.paintCursor(); this.onCursor && this.onCursor();
  }
  ensureCaretVisible() {
    const { line, col } = this.caretLC(); const y = PAD + (line - 1) * LH;
    if (y < this.sc.scrollTop) this.sc.scrollTop = y - LH;
    else if (y + LH > this.sc.scrollTop + this.sc.clientHeight - 14) this.sc.scrollTop = y - this.sc.clientHeight + 3 * LH;
    const x = col * charW; if (x > this.sc.scrollLeft + this.sc.clientWidth - 30) this.sc.scrollLeft = x - this.sc.clientWidth + 60; else if (x < this.sc.scrollLeft) this.sc.scrollLeft = Math.max(0, x - 40);
  }
  insert(text) { this.ta.focus(); document.execCommand('insertText', false, text); }
  key(e) {
    const ta = this.ta;
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
      if (s !== en && v.slice(s, en).includes('\n')) { this.indentSel(e.shiftKey ? -1 : 1); return; }
      if (e.shiftKey) return;
      this.insert('    '); return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const v = ta.value, s = ta.selectionStart;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(ls, s);
      let ind = /^[ \t]*/.exec(line)[0];
      if (/\{\s*$/.test(line)) ind += '    ';
      this.insert('\n' + ind);
      setTimeout(() => this.ensureCaretVisible(), 0);
      return;
    }
    if (e.key === '}' && !e.ctrlKey) {
      const v = ta.value, s = ta.selectionStart;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const before = v.slice(ls, s);
      if (/^[ \t]+$/.test(before) && ta.selectionStart === ta.selectionEnd) {
        e.preventDefault();
        ta.setSelectionRange(ls, s);
        this.insert(before.replace(/( {4}|\t)$/, '') + '}');
        return;
      }
    }
    setTimeout(() => this.ensureCaretVisible(), 0);
  }
  indentSel(dir) {
    const ta = this.ta, v = ta.value;
    let s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1, en = ta.selectionEnd;
    if (en > s && v[en - 1] === '\n') en--;
    const block = v.slice(s, en);
    const out = block.split('\n').map(l => dir > 0 ? '    ' + l : l.replace(/^( {1,4}|\t)/, '')).join('\n');
    ta.setSelectionRange(s, en); this.insert(out); ta.setSelectionRange(s, s + out.length);
  }
  commentSel(on) {
    const ta = this.ta, v = ta.value;
    let s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1, en = ta.selectionEnd;
    if (en > s && v[en - 1] === '\n') en--;
    let e2 = v.indexOf('\n', en); if (e2 < 0) e2 = v.length; if (ta.selectionStart === ta.selectionEnd) en = e2; else en = Math.max(en, s);
    if (ta.selectionStart !== ta.selectionEnd) { const t = v.indexOf('\n', en - 1 < s ? s : en - 1); en = t < 0 ? v.length : (v[en - 1] === '\n' ? en - 1 : t); }
    const block = v.slice(s, en);
    const out = block.split('\n').map(l => on ? '//' + l : l.replace(/^(\s*)\/\//, '$1')).join('\n');
    ta.setSelectionRange(s, en); this.insert(out); ta.setSelectionRange(s, s + out.length);
  }
  find(q, back) {
    if (!q) return false;
    const v = this.ta.value.toLowerCase(), ql = q.toLowerCase();
    let i;
    if (back) { i = v.lastIndexOf(ql, this.ta.selectionStart - 1); if (i < 0) i = v.lastIndexOf(ql); }
    else { i = v.indexOf(ql, this.ta.selectionEnd); if (i < 0) i = v.indexOf(ql); }
    if (i < 0) return false;
    this.ta.focus(); this.ta.setSelectionRange(i, i + q.length); this.ensureCaretVisible(); this.paintCursor();
    return true;
  }
}

/* ---------------- µVision application ---------------- */
const COMPILER_LINE = "*** Using Compiler 'V6.22', folder: 'C:\\Users\\common\\AppData\\Local\\Keil_v5\\ARM\\ARMCLANG\\Bin'";
const UV = {
  w: null, proj: null, tabs: [], active: null, out: [], building: false, outSel: -1,
  expanded: new Set(), showDeps: true, deps: {}, diags: [], lastAddDir: null, addFilter: 1, selNode: null,

  show() {
    if (this.w) { this.w.restore(); this.w.focus(); return; }
    const dw = WM.desk.clientWidth, dh = WM.desk.clientHeight;
    this.w = WM.open('uvision', { title: '\u00b5Vision', icon: I.uvision, w: Math.min(1100, dw - 560 > 760 ? dw - 560 : dw - 20), h: Math.min(dh - 20, 860), x: 8, y: 6, cls: 'uvwin', minW: 600, minH: 400,
      onResize: () => this.relayout(),
      onClose: () => { this.closeAll().then(ok => { if (ok) { this.saveUiState(); this.w.close(true); } }); return false; },
      onClosed: () => { this.w = null; this.proj = null; this.tabs = []; this.active = null; G.App.events.emit('uvclose'); } });
    this.build();
    this.renderAll();
  },
  build() {
    const me = this;
    const tb = (icon, title, fn, cls) => h('button.uv-ib' + (cls ? '.' + cls : ''), { title, html: icon, onclick: e => { e.stopPropagation(); fn(); } });
    const sep = () => h('span.uv-tsep');
    const mb = menuBar([
      { label: 'File', items: () => [
        { label: 'New...', key: 'Ctrl+N', icon: I.tNew, action: () => me.newFile() },
        { label: 'Open...', key: 'Ctrl+O', icon: I.tOpen, action: () => me.openFileDialog() },
        { label: 'Close', action: () => me.active && me.closeTab(me.active) },
        { label: 'Save', key: 'Ctrl+S', icon: I.tSave, disabled: !me.active, action: () => me.saveTab(me.active) },
        { label: 'Save As...', disabled: !me.active, action: () => me.saveAs(me.active) },
        { label: 'Save All', icon: I.tSaveAll, action: () => me.saveAll() }, '-',
        { label: 'Device Database...', disabled: true }, { label: 'License Management...', action: () => msgBox('License Management', 'MDK-Community Edition\nNon-Commercial Use License\n\n(MAPP Lab Simulator)', 'info') }, '-',
        { label: 'Print Setup...', disabled: true }, { label: 'Print...', key: 'Ctrl+P', disabled: true }, '-',
        { label: 'Exit', action: () => me.w.close() }] },
      { label: 'Edit', items: () => [
        { label: 'Undo', key: 'Ctrl+Z', icon: I.tUndo, action: () => me.edCmd('undo') }, { label: 'Redo', key: 'Ctrl+Y', icon: I.tRedo, action: () => me.edCmd('redo') }, '-',
        { label: 'Cut', key: 'Ctrl+X', icon: I.tCut, action: () => me.edCmd('cut') }, { label: 'Copy', key: 'Ctrl+C', icon: I.tCopy, action: () => me.edCmd('copy') }, { label: 'Paste', key: 'Ctrl+V', icon: I.tPaste, action: () => me.edPaste() }, '-',
        { label: 'Indent Selection', icon: I.tIndent, action: () => me.ed() && me.ed().indentSel(1) }, { label: 'Unindent Selection', icon: I.tUnindent, action: () => me.ed() && me.ed().indentSel(-1) }, '-',
        { label: 'Comment Selection', icon: I.tComment, action: () => me.ed() && me.ed().commentSel(true) }, { label: 'Uncomment Selection', icon: I.tUncomment, action: () => me.ed() && me.ed().commentSel(false) }, '-',
        { label: 'Find...', key: 'Ctrl+F', icon: I.tFind, action: () => me.showFind() }, { label: 'Go to Line...', key: 'Ctrl+G', action: () => me.gotoLineDlg() }, '-',
        { label: 'Select All', key: 'Ctrl+A', action: () => { const e = me.ed(); if (e) { e.ta.focus(); e.ta.select(); } } }, '-', { label: 'Configuration...', disabled: true }] },
      { label: 'View', items: () => [{ label: 'Status Bar', checked: true }, { label: 'Toolbars', sub: [{ label: 'File Toolbar', checked: true }, { label: 'Build Toolbar', checked: true }] }, '-', { label: 'Project Window', checked: true }, { label: 'Books Window', disabled: true }, { label: 'Functions Window', disabled: true }, { label: 'Build Output Window', checked: true }, { label: 'Find in Files Window', disabled: true }] },
      { label: 'Project', items: () => [
        { label: 'New \u00b5Vision Project...', disabled: true }, { label: 'New Multi-Project Workspace...', disabled: true },
        { label: 'Open Project...', action: () => me.openProjectDialog() }, { label: 'Close Project', disabled: !me.proj, action: () => me.closeProject() }, '-',
        { label: 'Export', disabled: true, sub: [] }, { label: 'Manage', sub: [{ label: 'Project Items...', action: () => me.manageItems() }] }, '-',
        { label: 'Select Device for Target \'NUCLEO_F103RB\'...', disabled: !me.proj, action: () => me.options('Device') },
        { label: 'Remove Item', disabled: !me.selNode || me.selNode.kind !== 'file', action: () => me.selNode && me.removeFile(me.selNode.group, me.selNode.file) },
        { label: 'Options for Target \'NUCLEO_F103RB\'...', key: 'Alt+F7', icon: I.tWand, disabled: !me.proj, action: () => me.options() }, '-',
        { label: 'Clean Targets', disabled: !me.proj, action: () => me.clean() },
        { label: 'Build Target', key: 'F7', icon: I.tBuild, disabled: !me.proj || me.building, action: () => me.doBuild('build') },
        { label: 'Rebuild all target files', icon: I.tRebuild, disabled: !me.proj || me.building, action: () => me.doBuild('rebuild') },
        { label: 'Batch Build...', icon: I.tBatch, disabled: true },
        { label: 'Translate ' + (me.active ? '\'' + VFS.basename(me.active.path) + '\'' : '...'), key: 'Ctrl+F7', icon: I.tTranslate, disabled: !me.proj || !me.active || me.building, action: () => me.translate(me.active.path) },
        { label: 'Stop build', icon: I.tStop, disabled: !me.building, action: () => me.stopBuild() }] },
      { label: 'Flash', items: () => [
        { label: 'Download', key: 'F8', icon: I.tLoad, disabled: !me.proj || me.building, action: () => me.download() },
        { label: 'Erase', disabled: !me.proj || me.building, action: () => me.erase() }, '-',
        { label: 'Configure Flash Tools...', disabled: !me.proj, action: () => me.options('Utilities') }] },
      { label: 'Debug', items: () => [
        { label: 'Start/Stop Debug Session', key: 'Ctrl+F5', icon: I.tDebug, disabled: !me.proj, action: () => me.debugMsg() },
        { label: 'Energy Measurement without Debug', disabled: true }, '-',
        { label: 'Reset CPU', disabled: true }, { label: 'Run', key: 'F5', disabled: true }, { label: 'Stop', disabled: true }, { label: 'Step', key: 'F11', disabled: true }, { label: 'Step Over', key: 'F10', disabled: true }, '-',
        { label: 'Breakpoints...', key: 'Ctrl+B', disabled: true }, { label: 'Insert/Remove Breakpoint', key: 'F9', disabled: true }, '-', { label: 'Debug Settings...', disabled: true }] },
      { label: 'Peripherals', items: [{ label: 'System Viewer', disabled: true }, { label: 'Core Peripherals', disabled: true }] },
      { label: 'Tools', items: [{ label: 'Setup PC-Lint...', disabled: true }, { label: 'Customize Tools Menu...', disabled: true }] },
      { label: 'SVCS', items: [{ label: 'Configure Software Version Control...', disabled: true }] },
      { label: 'Window', items: () => [{ label: 'Reset View to Defaults...', action: () => { this.leftW = 230; this.outH = 150; this.relayout(); } }, '-', { label: 'Split', disabled: true }, '-', { label: 'Close All', action: () => me.closeAll() }].concat(me.tabs.length ? ['-'] : [], me.tabs.map((t, i) => ({ label: (i + 1) + ' ' + t.path, checked: t === me.active, action: () => me.activate(t) }))) },
      { label: 'Help', items: [{ label: '\u00b5Vision Help', action: () => me.help() }, { label: 'Open Books Window', disabled: true }, '-', { label: 'Simple Mode', disabled: true }, { label: 'Check for Update', disabled: true }, '-', { label: 'About \u00b5Vision...', action: () => msgBox('About \u00b5Vision', '\u00b5Vision V5.40.0.0  (simulated)\nCopyright (C) 2024 ARM Ltd and ARM Germany GmbH. All rights reserved.\n\nToolchain: MDK-Community Edition  Version: 5.40.0.0\nC Compiler: ArmClang.exe  V6.22\n\nThis is the MAPP Lab Simulator - a practice copy of the lab PC for ET1010.\nIt is not affiliated with Arm or Keil.', 'info') }] }
    ]);
    this.targetSel = h('select.uv-target', null, h('option', { text: 'NUCLEO_F103RB' }));
    const tb1 = h('div.uv-tb', null,
      tb(I.tNew, 'New (Ctrl+N)', () => me.newFile()), tb(I.tOpen, 'Open (Ctrl+O)', () => me.openFileDialog()), tb(I.tSave, 'Save (Ctrl+S)', () => me.saveTab(me.active)), tb(I.tSaveAll, 'Save All', () => me.saveAll()), sep(),
      tb(I.tCut, 'Cut', () => me.edCmd('cut')), tb(I.tCopy, 'Copy', () => me.edCmd('copy')), tb(I.tPaste, 'Paste', () => me.edPaste()), sep(),
      tb(I.tUndo, 'Undo (Ctrl+Z)', () => me.edCmd('undo')), tb(I.tRedo, 'Redo (Ctrl+Y)', () => me.edCmd('redo')), sep(),
      tb(I.tBack, 'Navigate Backwards', () => { }, 'dis'), tb(I.tFwd, 'Navigate Forwards', () => { }, 'dis'), sep(),
      tb(I.tBm, 'Insert/Remove Bookmark', () => { }, 'dis'), sep(),
      tb(I.tIndent, 'Indent Selection', () => me.ed() && me.ed().indentSel(1)), tb(I.tUnindent, 'Unindent Selection', () => me.ed() && me.ed().indentSel(-1)), tb(I.tComment, 'Comment Selection', () => me.ed() && me.ed().commentSel(true)), tb(I.tUncomment, 'Uncomment Selection', () => me.ed() && me.ed().commentSel(false)), sep(),
      tb(I.tFind, 'Find (Ctrl+F)', () => me.showFind()));
    this.btnBuild = tb(I.tBuild, 'Build (F7)', () => me.doBuild('build'));
    this.btnRebuild = tb(I.tRebuild, 'Rebuild', () => me.doBuild('rebuild'));
    this.btnStop = tb(I.tStop, 'Stop Build', () => me.stopBuild(), 'dis');
    this.btnLoad = tb(I.tLoad, 'Download (F8)', () => me.download());
    const tb2 = h('div.uv-tb', null,
      tb(I.tTranslate, 'Translate (Ctrl+F7)', () => me.active && me.translate(me.active.path)), this.btnBuild, this.btnRebuild, tb(I.tBatch, 'Batch Build', () => { }, 'dis'), this.btnStop, sep(),
      this.btnLoad, sep(), this.targetSel, tb(I.tWand, 'Options for Target... (Alt+F7)', () => me.options()), sep(),
      tb(I.tManage, 'Manage Project Items...', () => me.manageItems()), tb(I.tBooks, 'Manage Run-Time Environment...', () => { }, 'dis'), tb(I.tDebug, 'Start/Stop Debug Session (Ctrl+F5)', () => me.debugMsg()));
    this.tree = h('div.uv-tree', { tabindex: 0 });
    this.left = h('div.uv-left', null, h('div.pane-head', null, h('span', { text: 'Project' }), h('span.wspace'), h('span.pane-x', { html: '&#128204;' }), h('span.pane-x', { html: '&#10006;' })), this.tree,
      h('div.uv-ltabs', null, h('span.on', { html: I.project + ' Project' }), h('span', { html: I.tBooks + ' Books' }), h('span', { html: I.tFunc + ' Functions' }), h('span', { html: I.tTempl + ' Templates' })));
    this.tabBar = h('div.uv-tabs');
    this.findBar = h('div.uv-find.hidden');
    this.editors = h('div.uv-editors');
    this.right = h('div.uv-right', null, this.tabBar, this.findBar, this.editors);
    this.vsplit = h('div.uv-vsplit');
    this.outText = h('div.uv-outtext', { tabindex: 0 });
    this.outPane = h('div.uv-out', null, h('div.pane-head', null, h('span', { text: 'Build Output' }), h('span.wspace'), h('span.pane-x', { html: '&#128204;' }), h('span.pane-x', { html: '&#10006;' })), this.outText);
    this.hsplit = h('div.uv-hsplit');
    this.progress = h('div.uv-prog', null, h('div.uv-progbar'));
    this.progLabel = h('span.uv-proglabel');
    this.posLabel = h('span', { text: '' });
    this.status = h('div.uv-status', null, h('span.uv-st-left', null, this.progLabel, this.progress), h('span.uv-st-dbg', { text: 'ST-Link Debugger' }), h('span.uv-st-pos', null, this.posLabel), h('span.uv-st-caps', { text: 'CAP  NUM  SCRL  OVR  R/W' }));
    this.mainEl = h('div.uv-main', null, this.left, this.vsplit, this.right);
    this.root = h('div.uv', null, mb, tb1, tb2, this.mainEl, this.hsplit, this.outPane, this.status);
    this.w.body.append(this.root);
    this.leftW = this.leftW || 230; this.outH = this.outH || 160;
    this.relayout();
    // splitters
    const drag = (el, fn) => el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); const sx = e.clientX, sy = e.clientY, a = this.leftW, b = this.outH; const mv = ev => { fn(ev.clientX - sx, ev.clientY - sy, a, b); this.relayout(); }; const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); });
    drag(this.vsplit, (dx, dy, a) => { this.leftW = Math.max(120, Math.min(600, a + dx)); });
    drag(this.hsplit, (dx, dy, a, b) => { this.outH = Math.max(50, Math.min(600, b - dy)); });
    // output pane interactions
    this.outText.addEventListener('contextmenu', e => { e.preventDefault(); showMenu(e.clientX, e.clientY, [{ label: 'Clear Window', action: () => { this.out = []; this.renderOut(); } }, '-', { label: 'Copy to Clipboard', key: 'Ctrl+C', icon: I.tCopy, action: () => { const t = this.outSel >= 0 ? this.out[this.outSel].text : this.out.map(o => o.text).join('\n'); try { navigator.clipboard.writeText(t); } catch (x) { } } }, { label: 'Select All', action: () => { const r = document.createRange(); r.selectNodeContents(this.outText); getSelection().removeAllRanges(); getSelection().addRange(r); } }, '-', { label: 'Find in List', key: 'Ctrl+F', disabled: true }]); });
    // keyboard
    this.w.el.addEventListener('keydown', e => this.keys(e));
    this.tree.addEventListener('contextmenu', e => { if (!e.target.closest('.tn')) { e.preventDefault(); } });
  },
  relayout() {
    if (!this.mainEl) return;
    this.left.style.width = this.leftW + 'px';
    this.outPane.style.height = this.outH + 'px';
    const ed = this.ed(); if (ed) ed.refresh();
  },
  keys(e) {
    const k = e.key, c = e.ctrlKey;
    if (k === 'F7' && c) { e.preventDefault(); this.active && this.translate(this.active.path); }
    else if (k === 'F7' && e.altKey) { e.preventDefault(); this.options(); }
    else if (k === 'F7') { e.preventDefault(); this.doBuild('build'); }
    else if (k === 'F8') { e.preventDefault(); this.download(); }
    else if (c && k.toLowerCase() === 's') { e.preventDefault(); this.saveTab(this.active); }
    else if (c && k.toLowerCase() === 'n') { e.preventDefault(); this.newFile(); }
    else if (c && k.toLowerCase() === 'o') { e.preventDefault(); this.openFileDialog(); }
    else if (c && k.toLowerCase() === 'f') { e.preventDefault(); this.showFind(); }
    else if (c && k.toLowerCase() === 'g') { e.preventDefault(); this.gotoLineDlg(); }
    else if (c && k.toLowerCase() === 'y') { e.preventDefault(); this.edCmd('redo'); }
    else if (c && k === 'F5') { e.preventDefault(); this.debugMsg(); }
    else if (k === 'F3') { e.preventDefault(); this.findNext(e.shiftKey); }
  },
  ed() { return this.active && this.active.ed; },
  edCmd(c) { const e = this.ed(); if (!e) return; e.ta.focus(); document.execCommand(c); },
  async edPaste() { const e = this.ed(); if (!e) return; try { const t = await navigator.clipboard.readText(); e.insert(t); } catch (x) { e.ta.focus(); document.execCommand('paste'); } },
  setProgress(label, frac) {
    this.progLabel.textContent = label || '';
    this.progress.style.display = frac == null ? 'none' : 'inline-block';
    if (frac != null) this.progress.firstChild.style.width = Math.round(frac * 100) + '%';
  },

  /* ---------- project ---------- */
  vfs() { return G.App.vfs; },
  async openProject(path) {
    this.show();
    if (this.proj && VFS.same(this.proj.path, path)) { this.w.focus(); return; }
    if (this.proj) { const ok = await this.closeProject(); if (!ok) return; }
    let data;
    try { data = Project.parse(this.vfs().read(path)); }
    catch (e) { msgBox('\u00b5Vision', 'Cannot read project file\n' + path + '\n\n' + e.message, 'error'); return; }
    this.proj = { path, dir: VFS.dirname(path), data };
    this.deps = {}; this.diags = []; this.out = [];
    this.expanded = new Set(['root', 'target']);
    const ui = this.loadUiState();
    if (ui) { (ui.expanded || []).forEach(x => this.expanded.add(x)); for (const p of ui.tabs || []) if (this.vfs().exists(p)) this.openFile(p, true); if (ui.active) { const t = this.tabs.find(t => VFS.same(t.path, ui.active)); if (t) this.activate(t); } }
    this.w.setTitle(path + ' - \u00b5Vision');
    this.renderAll();
    G.App.events.emit('projopen', path);
  },
  async openProjectDialog() {
    const r = await fileDialog(this.vfs(), { title: 'Select Project File', startDir: this.proj ? this.proj.dir : 'D:\\MAPP Programs', filters: [{ label: 'Project Files (*.uvproj; *.uvprojx)', exts: ['uvproj', 'uvprojx'] }, { label: 'All files (*.*)', exts: null }], okLabel: 'Open' });
    if (r && r[0]) this.openProject(r[0]);
  },
  async closeProject() {
    if (!this.proj) return true;
    const ok = await this.closeAll(); if (!ok) return false;
    this.saveUiState();
    this.proj = null; this.deps = {}; this.diags = []; this.selNode = null;
    if (this.w) this.w.setTitle('\u00b5Vision');
    this.renderAll(); G.App.events.emit('projclose');
    return true;
  },
  saveProject() { if (!this.proj) return; this.vfs().write(this.proj.path, Project.serialize(this.proj.data)); G.App.events.emit('projchange', this.proj.path); },
  uiKey() { return 'mappsim.uv.' + (this.proj ? this.proj.path.toLowerCase() : ''); },
  saveUiState() { if (!this.proj) return; try { localStorage.setItem(this.uiKey(), JSON.stringify({ tabs: this.tabs.map(t => t.path), active: this.active && this.active.path, expanded: [...this.expanded] })); } catch (e) { } },
  loadUiState() { try { return JSON.parse(localStorage.getItem(this.uiKey()) || 'null'); } catch (e) { return null; } },
  filePath(f) { return VFS.resolve(this.proj.dir, f.path); },
  userGroups() { return this.proj ? this.proj.data.groups.filter(g => g.name !== 'mbed-os') : []; },
  async addExisting(group) {
    const me = this;
    const filters = [{ label: 'C Source file (*.c)', exts: ['c'] }, { label: 'C++ Source file (*.cpp)', exts: ['cpp', 'cc', 'cxx'] }, { label: 'Asm Source file (*.s*; *.src; *.a*)', exts: ['s', 'src', 'a51', 'asm'] }, { label: 'Object file (*.obj)', exts: ['obj', 'o'] }, { label: 'Library file (*.lib)', exts: ['lib'] }, { label: 'Text file (*.txt; *.h; *.inc)', exts: ['txt', 'h', 'inc'] }, { label: 'Image file (*.*)', exts: null }, { label: 'All files (*.*)', exts: null }];
    await fileDialog(this.vfs(), { title: "Add Files to Group '" + group.name + "'", startDir: this.lastAddDir && this.vfs().isDir(this.lastAddDir) ? this.lastAddDir : this.proj.dir, filters, filterIndex: this.addFilter, okLabel: 'Add', cancelLabel: 'Close', multi: true,
      onOk: async (paths, dir) => {
        me.lastAddDir = dir;
        for (const p of paths) {
          if (this.vfs().isDir(p)) continue;
          const exists = this.proj.data.groups.find(g => g.files.some(f => VFS.same(this.filePath(f), p)));
          if (exists) { await msgBox('\u00b5Vision', "File '" + VFS.basename(p) + "' is already a member of Group '" + exists.name + "'.", 'warn'); continue; }
          let rel = VFS.relative(this.proj.dir, p);
          if (!/^\.\.?\\/.test(rel) && !/^[A-Za-z]:/.test(rel)) rel = '.\\' + rel;
          group.files.push({ name: VFS.basename(p), path: rel, type: Project.fileType(p) });
          this.saveProject();
          G.App.events.emit('projadd', { path: p, group: group.name });
        }
        this.expanded.add('g:' + group.name);
        this.renderTree();
        return true; // keep dialog open like µVision
      } });
  },
  async addNew(group) {
    const types = [['C File (.c)', 'c'], ['C++ File (.cpp)', 'cpp'], ['Asm File (.s)', 's'], ['Header File (.h)', 'h'], ['Text File (.txt)', 'txt'], ['Image File (.*)', ''], ['User Code Template', '']];
    let ti = 1;
    const list = h('div.an-list');
    types.forEach(([l], i) => { const r = h('div.an-item' + (i === ti ? '.sel' : '') + (i >= 5 ? '.dis' : ''), { html: (i === 3 ? I.hfile : i === 4 ? I.txt : i === 0 ? I.c : I.cpp) + ' ' + l }); r.onclick = () => { if (i >= 5) return; ti = i; list.querySelectorAll('.an-item').forEach((x, j) => x.classList.toggle('sel', j === ti)); desc.textContent = 'Create a new ' + l.split(' (')[0].replace(' File', '') + ' source file and add it to the project.'; }; list.append(r); });
    const desc = h('div.an-desc', { text: 'Create a new C++ source file and add it to the project.' });
    const name = h('input.tin', { style: { width: '100%' } });
    const loc = h('input.tin', { value: this.proj.dir, style: { width: '100%' } });
    const ok = await modal({ title: "Add New Item to Group '" + group.name + "'", width: 560, body: h('div.an', null, list, desc, h('div.an-row', null, h('label', { text: 'Type:' }), h('span', { text: '' })), h('div.an-row', null, h('label', { text: 'Name:' }), name), h('div.an-row', null, h('label', { text: 'Location:' }), loc)),
      buttons: [{ label: 'Add', value: true, default: true, validate: () => !!name.value.trim() }, { label: 'Close', value: false, cancel: true }] });
    if (!ok) return;
    let fn = name.value.trim(); const ext = types[ti][1];
    if (ext && !fn.toLowerCase().endsWith('.' + ext)) fn += '.' + ext;
    const p = VFS.join(loc.value.trim() || this.proj.dir, fn);
    if (!this.vfs().exists(p)) this.vfs().write(p, '');
    let rel = VFS.relative(this.proj.dir, p); if (!/^\.\.?\\/.test(rel) && !/^[A-Za-z]:/.test(rel)) rel = '.\\' + rel;
    group.files.push({ name: fn, path: rel, type: Project.fileType(fn) });
    this.saveProject(); this.expanded.add('g:' + group.name);
    G.App.events.emit('projadd', { path: p, group: group.name });
    this.renderTree(); this.openFile(p);
  },
  async removeFile(group, f) {
    const r = await msgBox('\u00b5Vision', "Do you want to remove the file '" + f.name + "' from the project?", 'question', 'yesno');
    if (r !== 'yes') return;
    group.files.splice(group.files.indexOf(f), 1);
    this.saveProject(); this.selNode = null;
    G.App.events.emit('projremove', { path: this.filePath(f), group: group.name });
    this.renderTree();
  },
  async removeGroup(group) {
    const r = await msgBox('\u00b5Vision', "Do you want to remove the Group '" + group.name + "' and all its files from the project?", 'question', 'yesno');
    if (r !== 'yes') return;
    this.proj.data.groups.splice(this.proj.data.groups.indexOf(group), 1); this.saveProject(); this.renderTree();
  },
  async addGroup() {
    let n = 'New Group', k = 1; while (this.proj.data.groups.some(g => g.name === n)) n = 'New Group' + (k++);
    this.proj.data.groups.push({ name: n, files: [] }); this.saveProject(); this.renderTree();
  },
  manageItems() {
    if (!this.proj) return;
    const g = this.userGroups();
    msgBox('Manage Project Items', 'Project Targets: NUCLEO_F103RB\n\nGroups:\n' + this.proj.data.groups.map(x => '  ' + x.name + (x.name === 'mbed-os' ? '  (512 files)' : '')).join('\n') + '\n\nFiles in group \'' + (g[0] ? g[0].name : '') + "':\n" + (g[0] ? g[0].files.map(f => '  ' + f.path).join('\n') || '  (none)' : '') + '\n\nTip: use the Project window context menu to add or remove files.', 'info');
  },

  /* ---------- tree ---------- */
  renderAll() { this.renderTree(); this.renderTabs(); this.renderOut(); },
  renderTree() {
    const T = this.tree; if (!T) return;
    T.innerHTML = '';
    if (!this.proj) return;
    const me = this;
    const node = (depth, key, icon, label, opts) => {
      opts = opts || {};
      const hasKids = !!opts.kids;
      const open = hasKids && this.expanded.has(key);
      const tog = h('span.tn-tog', { html: hasKids ? (open ? '&#8863;' : '&#8862;') : '' });
      const row = h('div.tn' + (this.selNode && this.selNode.key === key ? '.sel' : '') + (opts.dim ? '.dim' : ''), { style: { paddingLeft: (4 + depth * 16) + 'px' } }, tog, h('span.tn-ic', { html: open && opts.openIcon ? opts.openIcon : icon }), h('span.tn-l', { text: label }));
      tog.addEventListener('click', e => { e.stopPropagation(); if (!hasKids) return; if (open) this.expanded.delete(key); else this.expanded.add(key); this.renderTree(); });
      row.addEventListener('mousedown', e => { this.selNode = Object.assign({ key }, opts.sel || {}); T.querySelectorAll('.tn.sel').forEach(x => x.classList.remove('sel')); row.classList.add('sel'); });
      row.addEventListener('dblclick', e => { if (opts.open) opts.open(); else if (hasKids) tog.click(); });
      row.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (opts.menu) showMenu(e.clientX, e.clientY, opts.menu()); });
      T.append(row);
      if (open) opts.kids();
    };
    const tgt = this.proj.data.target;
    const common = () => [{ label: 'Open Build Log', action: () => me.openBuildLog() }, { label: 'Rebuild all target files', icon: I.tRebuild, disabled: me.building, action: () => me.doBuild('rebuild') }, { label: 'Build Target', key: 'F7', icon: I.tBuild, disabled: me.building, action: () => me.doBuild('build') }];
    node(0, 'root', I.project, 'Project: ' + tgt, { kids: () => {
      node(1, 'target', I.target, tgt, {
        menu: () => [{ label: "Options for Target '" + tgt + "'...", key: 'Alt+F7', icon: I.tWand, action: () => me.options() }, ...common(), '-', { label: 'Add Group...', action: () => me.addGroup() }, '-', { label: 'Manage Project Items...', icon: I.tManage, action: () => me.manageItems() }, '-', { label: 'Show Include File Dependencies', checked: me.showDeps, action: () => { me.showDeps = !me.showDeps; me.renderTree(); } }],
        kids: () => {
          for (const g of this.proj.data.groups) {
            const gk = 'g:' + g.name;
            const gm = () => [{ label: "Options for Group '" + g.name + "'...", key: 'Alt+F7', disabled: true }, ...common(), '-',
              { label: "Add New Item to Group '" + g.name + "'...", disabled: g.locked, action: () => me.addNew(g) },
              { label: "Add Existing Files to Group '" + g.name + "'...", disabled: g.locked, action: () => me.addExisting(g) }, '-',
              { label: "Remove Group '" + g.name + "' and its Files", disabled: g.locked, action: () => me.removeGroup(g) }, '-',
              { label: 'Manage Project Items...', icon: I.tManage, action: () => me.manageItems() }, '-', { label: 'Show Include File Dependencies', checked: me.showDeps, action: () => { me.showDeps = !me.showDeps; me.renderTree(); } }];
            node(2, gk, I.group, g.name, { openIcon: I.groupOpen, menu: gm, sel: { kind: 'group', group: g }, kids: () => {
              if (g.name === 'mbed-os') { T.append(h('div.tn.dim', { style: { paddingLeft: (4 + 3 * 16 + 18) + 'px' }, text: '(512 files \u2013 pre-built Mbed OS 6.16 library)' })); return; }
              for (const f of g.files) {
                const fp = this.filePath(f);
                const fk = 'f:' + fp.toLowerCase();
                const dep = this.deps[fp.toLowerCase()];
                const missing = !this.vfs().exists(fp);
                const fm = () => [{ label: "Options for File '" + f.name + "'...", key: 'Alt+F7', disabled: true }, { label: "Remove File '" + f.name + "'", action: () => me.removeFile(g, f) }, '-',
                  { label: 'Manage Project Items...', icon: I.tManage, action: () => me.manageItems() }, { label: 'Open ' + f.name, action: () => me.openFile(fp) }, ...common(), '-',
                  { label: 'Translate ' + f.name, key: 'Ctrl+F7', icon: I.tTranslate, disabled: me.building || f.type === 5, action: () => me.translate(fp) }, '-', { label: 'Show Include File Dependencies', checked: me.showDeps, action: () => { me.showDeps = !me.showDeps; me.renderTree(); } }];
                node(3, fk, G.fileIcon(f.name), f.name + (missing ? '' : ''), { dim: missing, menu: fm, sel: { kind: 'file', group: g, file: f }, open: () => me.openFile(fp),
                  kids: (this.showDeps && dep && dep.length) ? () => { for (const d of dep) node(4, fk + '>' + d.name, G.I.hfile, d.name, { open: d.path ? () => me.openFile(d.path) : null, dim: !d.path }); } : null });
              }
            } });
          }
        } });
    } });
  },

  /* ---------- editor tabs ---------- */
  openFileStandalone(p) { this.show(); this.openFile(p); },
  openFile(p, quiet) {
    if (!this.vfs().exists(p)) { if (!quiet) msgBox('\u00b5Vision', "Cannot open source file '" + p + "'.\nThe file does not exist.", 'error'); return null; }
    let t = this.tabs.find(t => VFS.same(t.path, p));
    if (!t) {
      const text = this.vfs().read(p);
      t = { path: VFS.norm(p), saved: text };
      t.ed = new CodeEditor(text, () => { this.renderTabs(); }, () => this.updatePos());
      this.editors.append(t.ed.el);
      this.tabs.push(t);
      this.applyMarks(t);
    }
    if (!quiet) this.activate(t); else if (!this.active) this.activate(t);
    return t;
  },
  activate(t) {
    this.active = t;
    for (const x of this.tabs) x.ed.el.style.display = x === t ? 'flex' : 'none';
    this.renderTabs();
    requestAnimationFrame(() => { t.ed.refresh(); t.ed.ta.focus(); this.updatePos(); });
  },
  dirty(t) { return t.ed.value !== t.saved; },
  renderTabs() {
    const B = this.tabBar; if (!B) return;
    B.innerHTML = '';
    for (const t of this.tabs) {
      const el = h('div.uv-tab' + (t === this.active ? '.on' : ''), { title: t.path }, h('span', { html: G.fileIcon(t.path) }), h('span', { text: VFS.basename(t.path) + (this.dirty(t) ? '*' : '') }));
      el.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); this.closeTab(t); } else if (e.button === 0) this.activate(t); });
      el.addEventListener('contextmenu', e => { e.preventDefault(); this.activate(t); showMenu(e.clientX, e.clientY, [{ label: 'Close', action: () => this.closeTab(t) }, { label: 'Close All but this', action: () => this.closeOthers(t) }, { label: 'Close All', action: () => this.closeAll() }, '-', { label: 'Save ' + VFS.basename(t.path), icon: I.tSave, action: () => this.saveTab(t) }, '-', { label: 'Split Window horizontally', disabled: true }, { label: 'Split Window vertically', disabled: true }, '-', { label: 'Show in Explorer', action: () => G.openExplorer(VFS.dirname(t.path)) }]); });
      B.append(el);
    }
    this.editors.classList.toggle('empty', !this.tabs.length);
  },
  updatePos() { const e = this.ed(); if (!e) { this.posLabel.textContent = ''; return; } const { line, col } = e.caretLC(); this.posLabel.textContent = 'L:' + line + ' C:' + col; },
  saveTab(t) {
    if (!t) return;
    if (t.untitled) return this.saveAs(t);
    t.saved = t.ed.value; t.selfWrite = Date.now();
    this.vfs().write(t.path, t.ed.value);
    this.renderTabs();
  },
  saveAll() { for (const t of this.tabs) if (this.dirty(t)) this.saveTab(t); },
  async saveAs(t) {
    const r = await fileDialog(this.vfs(), { title: 'Save As', startDir: VFS.dirname(t.path), filters: [{ label: 'All Files (*.*)', exts: null }], okLabel: 'Save', allowNew: true });
    if (!r || !r[0]) return;
    this.vfs().write(r[0], t.ed.value); t.path = VFS.norm(r[0]); t.saved = t.ed.value; t.untitled = false; this.renderTabs();
  },
  async closeTab(t) {
    if (this.dirty(t)) {
      const r = await msgBox('\u00b5Vision', 'Save changes to \'' + t.path + "'?", 'question', 'yesnocancel');
      if (r === 'cancel' || r == null) return false;
      if (r === 'yes') this.saveTab(t);
    }
    t.ed.el.remove();
    const i = this.tabs.indexOf(t); this.tabs.splice(i, 1);
    if (this.active === t) { this.active = null; if (this.tabs.length) this.activate(this.tabs[Math.max(0, i - 1)]); }
    this.renderTabs(); this.updatePos(); this.saveUiState();
    return true;
  },
  async closeOthers(t) { for (const x of this.tabs.slice()) if (x !== t) if (!(await this.closeTab(x))) return; },
  async closeAll() { for (const x of this.tabs.slice()) if (!(await this.closeTab(x))) return false; return true; },
  async newFile() {
    this.show();
    let n = 'Text1', k = 1; while (this.tabs.some(t => VFS.basename(t.path) === n)) n = 'Text' + (++k);
    const dir = this.proj ? this.proj.dir : 'C:\\Users\\Student\\Documents';
    const p = VFS.join(dir, n);
    const t = { path: p, saved: null, untitled: true };
    t.ed = new CodeEditor('', () => this.renderTabs(), () => this.updatePos());
    this.editors.append(t.ed.el); this.tabs.push(t); this.activate(t);
    t.saved = '\u0000';
  },
  async openFileDialog() {
    this.show();
    const r = await fileDialog(this.vfs(), { title: 'Open', startDir: this.proj ? this.proj.dir : 'D:\\MAPP Programs', filters: [{ label: 'C Source file (*.c; *.cpp; *.h)', exts: ['c', 'cpp', 'h', 'cc'] }, { label: 'Text file (*.txt)', exts: ['txt'] }, { label: 'All files (*.*)', exts: null }], okLabel: 'Open', multi: true });
    if (r) for (const p of r) this.openFile(p);
  },
  extChanged(p) {
    const t = this.tabs.find(t => VFS.same(t.path, p)); if (!t) return;
    if (t.selfWrite && Date.now() - t.selfWrite < 300) return;
    const nv = this.vfs().read(p); if (nv == null || nv === t.saved) return;
    if (!this.dirty(t)) { t.ed.value = nv; t.saved = nv; this.renderTabs(); }
    else msgBox('\u00b5Vision', "The file '" + p + "' has been changed outside the editor.\nDo you want to reload it?", 'question', 'yesno').then(r => { if (r === 'yes') { t.ed.value = nv; t.saved = nv; this.renderTabs(); } });
  },
  showFind() {
    const e = this.ed(); if (!e) return;
    const F = this.findBar;
    if (!F.firstChild) {
      this.findIn = h('input.tin', { placeholder: 'Find what' });
      this.findIn.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); this.findNext(ev.shiftKey); } if (ev.key === 'Escape') { F.classList.add('hidden'); this.ed() && this.ed().ta.focus(); } });
      F.append(h('span', { text: 'Find:' }), this.findIn, h('button.btn.sm', { text: 'Find Next', onclick: () => this.findNext(false) }), h('button.btn.sm', { text: 'Find Prev', onclick: () => this.findNext(true) }), this.findMsg = h('span.uv-findmsg'), h('span.wspace'), h('button.btn.sm', { text: '\u2715', onclick: () => F.classList.add('hidden') }));
    }
    F.classList.remove('hidden');
    const s = e.ta.value.slice(e.ta.selectionStart, e.ta.selectionEnd); if (s && !s.includes('\n')) this.findIn.value = s;
    this.findIn.focus(); this.findIn.select();
  },
  findNext(back) { const e = this.ed(); if (!e || !this.findIn) return; const ok = e.find(this.findIn.value, back); this.findMsg.textContent = ok ? '' : "Cannot find '" + this.findIn.value + "'"; },
  async gotoLineDlg() { const e = this.ed(); if (!e) return; const v = await G.prompt('Goto Line', 'Enter line number (1 - ' + e.value.split('\n').length + '):', ''); if (v && +v) e.gotoLine(+v, 0, true); },

  /* ---------- output ---------- */
  outLine(text, kind, meta) { this.out.push(Object.assign({ text, kind: kind || '' }, meta || {})); this.appendOut(this.out.length - 1); },
  appendOut(i) {
    const o = this.out[i];
    const el = h('div.ol' + (o.kind ? '.' + o.kind : ''), { text: o.text || '\u00a0' });
    el.addEventListener('mousedown', () => { this.outSel = i; this.outText.querySelectorAll('.ol.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); });
    el.addEventListener('dblclick', () => this.jumpTo(o));
    this.outText.append(el);
    this.outText.scrollTop = this.outText.scrollHeight;
  },
  renderOut() { if (!this.outText) return; this.outText.innerHTML = ''; this.out.forEach((o, i) => this.appendOut(i)); },
  jumpTo(o) {
    if (!o.path) return;
    const t = this.openFile(o.path); if (!t) return;
    setTimeout(() => t.ed.gotoLine(o.line, o.col, true), 30);
  },
  applyMarks(t) { const ds = this.diags.filter(d => d.path && VFS.same(d.path, t.path)); t.ed.setMarks(ds); },

  /* ---------- build ---------- */
  sources() {
    const out = [];
    for (const g of this.userGroups()) for (const f of g.files) if (f.type === 1 || f.type === 8) out.push({ f, path: this.filePath(f), name: f.name });
    return out;
  },
  includeFs(extra) {
    const vfs = this.vfs(), proj = this.proj;
    return {
      resolveInclude(name, from) {
        const dirs = [VFS.dirname(from), proj.dir];
        for (const d of dirs) {
          const p = VFS.resolve(d, name);
          const n = vfs.node(p);
          if (n && n.type === 'file') { if (extra) extra[p] = n.content; return { path: VFS.norm(p), text: n.content, display: VFS.basename(p) }; }
        }
        return null;
      }
    };
  },
  hash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16); },
  buildDir() { return VFS.join(this.proj.dir, 'BUILD'); },
  axfPath() { return VFS.join(this.buildDir(), 'NUCLEO_F103RB.axf'); },
  sleep(ms) { return new Promise(r => { this.stopTimer = setTimeout(r, ms); }); },
  stopBuild() { if (this.building) this.stopReq = true; },
  setBuilding(b) {
    this.building = b;
    [this.btnBuild, this.btnRebuild, this.btnLoad].forEach(x => x.classList.toggle('dis', b));
    this.btnStop.classList.toggle('dis', !b);
  },
  fmtDiag(d, srcText) {
    const lines = [];
    const kind = d.kind === 'fatal' ? 'fatal error' : d.kind;
    lines.push({ text: d.file + '(' + d.line + '): ' + kind + ': ' + d.msg, kind: d.kind === 'warning' ? 'warn' : 'err', path: d.path, line: d.line, col: d.col });
    if (srcText != null) {
      const L = srcText.split(/\r?\n/)[d.line - 1];
      if (L != null) {
        const ln = String(d.line).padStart(5);
        const exp = L.replace(/\t/g, '    ');
        const pre = L.slice(0, d.col - 1).replace(/\t/g, '    ').length;
        lines.push({ text: ln + ' | ' + exp, path: d.path, line: d.line, col: d.col });
        lines.push({ text: ' '.repeat(5) + ' | ' + ' '.repeat(pre) + '^', path: d.path, line: d.line, col: d.col });
        if (/^expected '(.)'/.test(d.msg)) lines.push({ text: ' '.repeat(5) + ' | ' + ' '.repeat(pre) + /^expected '(.)'/.exec(d.msg)[1] });
      }
    }
    return lines;
  },
  async doBuild(mode) {
    if (!this.proj) { msgBox('\u00b5Vision', 'There is no project open.\nUse Project > Open Project... or double-click a .uvprojx file.', 'info'); return; }
    if (this.building) return;
    this.saveAll();
    this.setBuilding(true); this.stopReq = false;
    const t0 = Date.now();
    const rebuild = mode === 'rebuild';
    const vfs = this.vfs();
    this.outLine((rebuild ? 'Rebuild' : 'Build') + ' started: Project: ' + this.proj.data.target);
    await this.sleep(120);
    this.outLine(COMPILER_LINE);
    await this.sleep(150);
    this.outLine((rebuild ? 'Rebuild' : 'Build') + " target '" + this.proj.data.target + "'");
    const srcs = this.sources();
    const depPath = VFS.join(this.buildDir(), 'NUCLEO_F103RB_NUCLEO_F103RB.dep');
    let prev = null; try { prev = JSON.parse(vfs.read(depPath) || 'null'); } catch (e) { }
    // missing sources
    const missing = srcs.filter(s => !vfs.exists(s.path));
    const present = srcs.filter(s => vfs.exists(s.path));
    const incl = {};
    const result = G.MappCompiler.buildProgram(present.map(s => ({ path: s.path, name: s.name, text: vfs.read(s.path) })), this.includeFs(incl));
    // dependency info for the tree + hashes
    const hashes = {};
    this.deps = {};
    result.perFile.forEach((pf, i) => {
      const s = present[i];
      this.deps[s.path.toLowerCase()] = pf.includes.map(x => ({ name: x.name.split(/[\\/]/).pop(), path: x.path || null }));
      let content = vfs.read(s.path);
      for (const x of pf.includes) if (x.path) content += '\u0001' + (vfs.read(x.path) || '');
      hashes[s.path.toLowerCase()] = this.hash(content);
    });
    const axfExists = vfs.exists(this.axfPath());
    const firstBuild = !prev;
    let errors = 0, warnings = 0;
    this.diags = result.diags.slice();
    // compile messages
    let compiledAny = false;
    for (const m of missing) {
      await this.sleep(200);
      this.outLine("compiling " + m.name + '...');
      this.outLine("ArmClang: error: no such file or directory: '" + m.f.path + "'", 'err');
      this.outLine('ArmClang: error: no input files', 'err');
      errors += 2;
    }
    if (firstBuild && present.length) { await this.sleep(900); }
    for (let i = 0; i < present.length; i++) {
      if (this.stopReq) break;
      const s = present[i], pf = result.perFile[i];
      const key = s.path.toLowerCase();
      const changed = rebuild || !prev || !prev.ok || prev.hashes[key] !== hashes[key] || pf.diags.some(d => d.kind !== 'warning') || !axfExists;
      if (!changed) continue;
      compiledAny = true;
      this.outLine('compiling ' + s.name + '...');
      await this.sleep(350 + Math.min(900, vfs.read(s.path).length / 8));
      let ne = 0, nw = 0;
      for (const d of pf.diags) {
        const src = d.path ? vfs.read(d.path) : null;
        for (const l of this.fmtDiag(d, src)) this.outLine(l.text, l.kind, l);
        if (d.kind === 'warning') nw++; else ne++;
      }
      if (ne || nw) this.outLine((nw ? nw + ' warning' + (nw > 1 ? 's' : '') : '') + (nw && ne ? ' and ' : '') + (ne ? ne + ' error' + (ne > 1 ? 's' : '') : '') + ' generated.');
      errors += ne; warnings += nw;
    }
    if (this.stopReq) { this.outLine('*** Build stopped by user.', 'err'); this.finishBuild(t0, false); return; }
    const anyCompileErrors = result.diags.some(d => d.kind !== 'warning');
    let ok = false;
    if (!errors && !anyCompileErrors && !missing.length) {
      const needLink = compiledAny || !axfExists || rebuild || (prev && JSON.stringify(Object.keys(prev.hashes || {}).sort()) !== JSON.stringify(Object.keys(hashes).sort()));
      if (needLink) {
        this.outLine('linking...');
        await this.sleep(450);
        if (result.linkErrors.length) {
          for (const le of result.linkErrors) this.outLine('.\\BUILD\\NUCLEO_F103RB.axf: ' + le, 'err');
          this.outLine('Not enough information to list image symbols.');
          this.outLine('Not enough information to list load addresses in the image map.');
          this.outLine('Finished: 2 information, 0 warning and ' + result.linkErrors.length + ' error messages.');
          errors += result.linkErrors.length;
        } else {
          const st = result.stats;
          this.outLine('Program Size: Code=' + st.code + ' RO-data=' + st.ro + ' RW-data=' + st.rw + ' ZI-data=' + st.zi + '  ');
          await this.sleep(150);
          this.outLine('FromELF: creating hex file...');
          this.writeOutputs(present, result, incl);
          ok = true;
        }
      } else ok = true;
    }
    if (errors) {
      this.outLine('".\\BUILD\\NUCLEO_F103RB.axf" - ' + errors + ' Error(s), ' + warnings + ' Warning(s).', 'err');
      this.outLine('Target not created.', 'err');
    } else this.outLine('".\\BUILD\\NUCLEO_F103RB.axf" - 0 Error(s), ' + warnings + ' Warning(s).', ok ? 'ok' : '');
    vfs.write(depPath, JSON.stringify({ ok: ok && !errors, hashes }));
    this.lastBuild = { ok: ok && !errors, errors, warnings, time: Date.now(), sources: present.map(s => ({ path: s.path, text: vfs.read(s.path) })) };
    this.finishBuild(t0, ok && !errors);
  },
  finishBuild(t0, ok) {
    const s = Math.max(1, Math.round((Date.now() - t0) / 1000));
    this.outLine('Build Time Elapsed:  00:00:' + String(s).padStart(2, '0'));
    this.setBuilding(false);
    for (const t of this.tabs) this.applyMarks(t);
    this.renderTree();
    this.writeLog();
    G.App.events.emit('build', { ok, proj: this.proj && this.proj.path });
  },
  writeOutputs(present, result, incl) {
    const vfs = this.vfs();
    const snap = { mappsim: 1, time: Date.now(), project: this.proj.path, sources: present.map(s => ({ path: s.path, name: s.name, text: vfs.read(s.path) })), incl };
    vfs.write(this.axfPath(), JSON.stringify(snap));
    const hx = this.hash(JSON.stringify(snap.sources));
    let hex = ':020000040800F2\n';
    for (let i = 0; i < 24; i++) hex += ':10' + (i * 16).toString(16).toUpperCase().padStart(4, '0') + '00' + (hx + hx + hx + hx).toUpperCase().slice(0, 32) + '00\n';
    vfs.write(VFS.join(this.buildDir(), 'NUCLEO_F103RB.hex'), hex + ':00000001FF\n');
    vfs.write(VFS.join(this.buildDir(), 'NUCLEO_F103RB.map'), 'Component: Arm Compiler for Embedded 6.22 Tool: armlink [5ee90200]\n\n==============================================================================\n\nImage Symbol Table\n\n    (simulated)\n\n    Total RO  Size (Code + RO Data)  ' + (result.stats.code + result.stats.ro) + '\n    Total RW  Size (RW Data + ZI Data) ' + (result.stats.rw + result.stats.zi) + '\n');
    for (const s of present) vfs.write(VFS.join(this.buildDir(), s.name.replace(/\.[^.]+$/, '.o').toLowerCase()), '[object file]');
  },
  writeLog() {
    if (!this.proj) return;
    const html = '<html><body><pre>\n<h1>\u00b5Vision Build Log</h1>\n' + this.out.map(o => o.text).join('\n') + '\n</pre></body></html>';
    this.vfs().write(VFS.join(this.buildDir(), 'NUCLEO_F103RB.build_log.htm'), html);
  },
  openBuildLog() { const p = VFS.join(this.buildDir(), 'NUCLEO_F103RB.build_log.htm'); if (this.vfs().exists(p)) G.openNotepad(p); else msgBox('\u00b5Vision', 'Build log not found. Build the target first.', 'info'); },
  async translate(path) {
    if (!this.proj || this.building) return;
    this.saveAll();
    this.setBuilding(true); this.stopReq = false;
    const t0 = Date.now();
    const vfs = this.vfs();
    const name = VFS.basename(path);
    this.outLine('compiling ' + name + '...');
    await this.sleep(400);
    const r = G.MappCompiler.buildProgram([{ path, name, text: vfs.read(path) || '' }], this.includeFs());
    const pf = r.perFile[0];
    let ne = 0, nw = 0;
    this.diags = this.diags.filter(d => !VFS.same(d.path || '', path)).concat(pf.diags);
    for (const d of pf.diags) { for (const l of this.fmtDiag(d, d.path ? vfs.read(d.path) : null)) this.outLine(l.text, l.kind, l); if (d.kind === 'warning') nw++; else ne++; }
    if (ne || nw) this.outLine((nw ? nw + ' warning' + (nw > 1 ? 's' : '') : '') + (nw && ne ? ' and ' : '') + (ne ? ne + ' error' + (ne > 1 ? 's' : '') : '') + ' generated.');
    this.outLine('"' + name + '" - ' + ne + ' Error(s), ' + nw + ' Warning(s).', ne ? 'err' : '');
    this.setBuilding(false);
    for (const t of this.tabs) this.applyMarks(t);
  },
  async clean() {
    if (!this.proj || this.building) return;
    const vfs = this.vfs();
    this.outLine("Clean started: Project: " + this.proj.data.target);
    this.outLine("Clean target '" + this.proj.data.target + "'");
    for (const n of vfs.list(this.buildDir())) { this.outLine('Deleting intermediate output files for target \'' + this.proj.data.target + "'... " + n.name); vfs.remove(VFS.join(this.buildDir(), n.name)); }
    this.outLine('Clean finished.');
    this.lastBuild = null;
  },

  /* ---------- flash ---------- */
  time() { const d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':'); },
  async checkLink() {
    if (!G.Board.connected()) {
      await msgBox('\u00b5Vision', 'No ST-LINK detected', 'error');
      return false;
    }
    return true;
  },
  async download() {
    if (!this.proj || this.building) return;
    const vfs = this.vfs();
    const axf = this.axfPath();
    if (!(await this.checkLink())) { this.outLine('Error: Flash Download failed  -  Target DLL has been cancelled', 'err'); return; }
    this.outLine('Load "' + axf.replace(/\\/g, '\\\\') + '" ');
    const txt = vfs.read(axf);
    let snap = null; try { snap = JSON.parse(txt); } catch (e) { }
    if (!snap || !snap.sources) { this.outLine("Error: Flash Download failed  -  Could not load file '" + axf + "'", 'err'); return; }
    this.setBuilding(true);
    G.Board.busy(true);
    const steps = [['Erase', 500], ['Program', 900], ['Verify', 400]];
    for (const [l, ms] of steps) { const s0 = Date.now(); while (Date.now() - s0 < ms) { this.setProgress(l + ':', (Date.now() - s0) / ms); await this.sleep(40); } }
    this.setProgress('', null);
    const img = G.App.compileSnapshot(snap);
    if (!img) { G.Board.busy(false); this.setBuilding(false); this.outLine("Error: Flash Download failed  -  Could not load file '" + axf + "'", 'err'); return; }
    this.outLine('Erase Done.');
    this.outLine('Programming Done.');
    this.outLine('Verify OK.');
    this.outLine('Flash Load finished at ' + this.time());
    this.setBuilding(false);
    G.App.flash(img, snap);
    G.Board.busy(false);
  },
  async erase() {
    if (!this.proj || this.building) return;
    if (!(await this.checkLink())) { this.outLine('No target connected'); this.outLine('Error: Flash Erase failed  -  Target DLL has been cancelled', 'err'); this.outLine('Flash Erase finished ' + this.time()); return; }
    this.setBuilding(true); G.Board.busy(true);
    const s0 = Date.now(); while (Date.now() - s0 < 900) { this.setProgress('Erase:', (Date.now() - s0) / 900); await this.sleep(40); }
    this.setProgress('', null);
    G.App.eraseFlash();
    this.outLine('Full Chip Erase Done.');
    this.outLine('Flash Erase finished ' + this.time());
    this.setBuilding(false); G.Board.busy(false);
  },
  debugMsg() {
    msgBox('\u00b5Vision', 'The debugger is not available in the MAPP Lab Simulator.\n\nUse Flash > Download (F8) to program the board, then watch the simulated MAPP Experiment Board. printf() output appears in Tera Term (COM3).', 'info');
  },
  help() { G.App.openCoach('help'); },

  /* ---------- Options for Target ---------- */
  options(tab) {
    if (!this.proj) return;
    const tabs = ['Device', 'Target', 'Output', 'Listing', 'User', 'C/C++ (AC6)', 'Asm', 'Linker', 'Debug', 'Utilities'];
    let cur = tab || 'Debug';
    const tabRow = h('div.opt-tabs');
    const page = h('div.opt-page');
    const chk = (l, on) => h('label.opt-chk', null, h('input', { type: 'checkbox', checked: on }), ' ' + l);
    const field = (l, v, w) => h('label.opt-f', null, h('span', { text: l }), h('input.tin', { value: v, style: { width: (w || 120) + 'px' } }));
    const pages = {
      'Device': () => h('div', null, h('div.opt-grp', null, h('b', { text: 'Software Packs' }), h('div', { text: 'Vendor: STMicroelectronics' }), h('div', { text: 'Device: STM32F103RB' }), h('div', { text: 'Toolset: ARM' }), h('div', { text: 'Pack: Keil.STM32F1xx_DFP.2.4.1' })), h('div.opt-note', { text: 'ARM Cortex-M3 processor, 72 MHz, 128 kB Flash, 20 kB SRAM, 51 GPIO' })),
      'Target': () => h('div', null, h('div', { text: 'STMicroelectronics STM32F103RB' }), field('Xtal (MHz):', '8.0', 60), h('div.opt-grp', null, h('b', { text: 'Read/Only Memory Areas' }), h('div', { text: 'IROM1  0x8000000  size 0x20000  (Startup)' })), h('div.opt-grp', null, h('b', { text: 'Read/Write Memory Areas' }), h('div', { text: 'IRAM1  0x20000000  size 0x5000' })), chk('Use MicroLIB', false), h('div', { text: 'ARM Compiler: Use default compiler version 6' })),
      'Output': () => h('div', null, field('Name of Executable:', 'NUCLEO_F103RB', 200), chk('Create Executable: .\\BUILD\\NUCLEO_F103RB', true), chk('Debug Information', true), chk('Create HEX File', true), chk('Browse Information', false)),
      'Listing': () => h('div', null, chk('Linker Listing: .\\BUILD\\NUCLEO_F103RB.map', true), chk('Memory Map', true), chk('Callgraph', true)),
      'User': () => h('div', null, h('div.opt-grp', null, h('b', { text: 'After Build/Rebuild' }), chk('Run #1', false), chk('Run #2', false)), chk('Beep When Complete', false), chk('Start Debugging', false)),
      'C/C++ (AC6)': () => h('div', null, h('div.opt-grp', null, h('b', { text: 'Language / Code Generation' }), field('Optimization:', '-O1', 80), field('Warnings:', 'AC5-like Warnings', 140), field('Language C++:', 'c++17', 80)), field('Define:', 'MBED_CONF_TARGET_..., DEVICE_SERIAL=1, ...', 380), field('Include Paths:', '.;mbed-os;mbed-os\\drivers;...', 380), h('div.opt-note', { text: 'Compiler control string: -xc++ -std=c++17 --target=arm-arm-none-eabi -mcpu=cortex-m3 -c -fno-rtti -funsigned-char -O1 -I ./ ...' })),
      'Asm': () => h('div', null, h('div', { text: 'Assembler Option: armclang (Auto Select)' })),
      'Linker': () => h('div', null, chk('Use Memory Layout from Target Dialog', false), field('Scatter File:', '.\\mbed-os\\targets\\TARGET_STM\\...\\stm32f103xb.sct', 380)),
      'Debug': () => {
        const connected = G.Board.connected();
        return h('div.opt-debug', null,
          h('div.opt-cols', null,
            h('div', null, h('label.opt-chk', null, h('input', { type: 'radio', name: 'dbg' }), ' Use Simulator'), h('div.opt-note', { text: 'Limit Speed to Real-Time' })),
            h('div', null, h('label.opt-chk', null, h('input', { type: 'radio', name: 'dbg', checked: true }), ' Use: '), h('select.tin', null, h('option', { text: 'ST-Link Debugger' })), ' ', h('button.btn.sm', { text: 'Settings', onclick: () => this.stlinkSettings() }))),
          chk('Load Application at Startup', true), chk('Run to main()', true), h('div.opt-note', { text: connected ? 'ST-LINK/V2-1 detected on USB.' : 'No debug adapter detected - check the USB cable.' }));
      },
      'Utilities': () => h('div', null, h('div.opt-grp', null, h('b', { text: 'Configure Flash Menu Command' }), h('label.opt-chk', null, h('input', { type: 'radio', checked: true }), ' Use Target Driver for Flash Programming'), h('div', null, h('select.tin', null, h('option', { text: 'ST-Link Debugger' })), ' ', h('button.btn.sm', { text: 'Settings', onclick: () => this.stlinkSettings('Flash Download') }), ' ', chk('Use Debug Driver', true)), chk('Update Target before Debugging', true))),
    };
    const show = () => { tabRow.innerHTML = ''; tabs.forEach(t => tabRow.append(h('span.opt-tab' + (t === cur ? '.on' : ''), { text: t, onclick: () => { cur = t; show(); } }))); page.innerHTML = ''; page.append(pages[cur]()); };
    show();
    modal({ title: "Options for Target '" + this.proj.data.target + "'", width: 620, body: h('div.opt', null, tabRow, page), buttons: [{ label: 'OK', value: 1, default: true }, { label: 'Cancel', value: 0, cancel: true }, { label: 'Defaults', value: 2 }, { label: 'Help', value: 3 }] });
  },
  stlinkSettings(tab) {
    const c = G.Board.connected();
    const tabs = ['Debug', 'Trace', 'Flash Download', 'Pack'];
    const cur = tab || 'Debug';
    const body = h('div.stl', null,
      h('div.opt-tabs', null, tabs.map(t => h('span.opt-tab' + (t === cur ? '.on' : ''), { text: t }))),
      cur === 'Debug' ? h('div.stl-cols', null,
        h('div.opt-grp', null, h('b', { text: 'Debug Adapter' }),
          h('label.opt-f', null, h('span', { text: 'Unit:' }), h('select.tin', { style: { width: '150px' } }, c ? h('option', { text: 'ST-LINK/V2-1' }) : h('option', { text: '' }))),
          h('label.opt-f', null, h('span', { text: 'Serial' }), h('input.tin', { value: c ? '0670FF555185754867134117' : '', style: { width: '190px' } })),
          h('div', { text: 'HW Version: ' + (c ? 'V2-1' : '') }), h('div', { text: 'FW Version: ' + (c ? 'V2J45M31' : '') }),
          h('label.opt-f', null, h('span', { text: 'Port:' }), h('select.tin', null, h('option', { text: 'SW' }))), h('label.opt-f', null, h('span', { text: 'Max' }), h('select.tin', null, h('option', { text: '4 MHz' })))),
        h('div.opt-grp.grow', null, h('b', { text: 'SW Device' }),
          h('table.stl-tab', null, h('tr', null, h('th', { text: '' }), h('th', { text: 'IDCODE' }), h('th', { text: 'Device Name' })),
            c ? h('tr', null, h('td', { text: 'SWDIO' }), h('td', { text: '0x1BA01477' }), h('td', { text: 'ARM CoreSight SW-DP' })) : h('tr', null, h('td', { text: 'Error' }), h('td', { colspan: 2, text: c ? '' : 'No ST-LINK detected' })))))
        : h('div.opt-grp', null, h('b', { text: 'Download Function' }), h('label.opt-chk', null, h('input', { type: 'radio', checked: true }), ' Erase Full Chip'), h('label.opt-chk', null, h('input', { type: 'checkbox', checked: true }), ' Program'), h('label.opt-chk', null, h('input', { type: 'checkbox', checked: true }), ' Verify'), h('label.opt-chk', null, h('input', { type: 'checkbox', checked: true }), ' Reset and Run'), h('div', { text: 'Programming Algorithm: STM32F10x Med-density Flash  128k  08000000H - 0801FFFFH' })));
    modal({ title: 'Cortex-M Target Driver Setup', width: 600, body, buttons: [{ label: 'OK', value: 1, default: true }, { label: 'Cancel', value: 0, cancel: true }, { label: 'Help', value: 2 }] });
  },
};

G.UV = UV; G.CodeEditor = CodeEditor;
})(window);
