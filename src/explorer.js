// explorer.js — Windows File Explorer + Notepad
(function (G) {
'use strict';
const { h, I, WM, showMenu, msgBox, modal, fileIcon, fileTypeName, fmtDate, fmtSize, toast } = G;
const Clip = { mode: null, paths: [] };
let explorerCount = 0;
const TEXT_EXT = ['cpp', 'c', 'h', 'hpp', 'txt', 'md', 'json', 'lib', 'mbed', 'html', 'htm', 'log', 'dep', 'map', 'dbgconf', 'uvoptx', 'uvguix', 'common', 'gitignore', 'yml', 'cmake', 'keep', ''];

function driveLabel(s) { return s === 'C:' ? 'Local Disk (C:)' : s === 'D:' ? 'Local Disk (D:)' : s; }

function openExplorer(startPath) {
  const vfs = G.App.vfs;
  const id = 'explorer' + (++explorerCount);
  let path = VFS.norm(startPath || 'D:\\MAPP Programs');
  let back = [], fwd = [];
  let sel = new Set(), anchor = null, focusName = null;
  let sortKey = 'name', sortDir = 1;
  let renaming = null;

  const addr = h('div.ex-addr');
  const search = h('input.ex-search', { placeholder: 'Search' });
  const btnBack = h('button.ex-nav', { title: 'Back (Alt+Left Arrow)', html: '&#8592;' });
  const btnFwd = h('button.ex-nav', { title: 'Forward (Alt+Right Arrow)', html: '&#8594;' });
  const btnUp = h('button.ex-nav', { title: 'Up to parent folder (Alt+Up Arrow)', html: '&#8593;' });
  const btnRefresh = h('button.ex-nav', { title: 'Refresh', html: '&#10227;' });
  const cmd = (label, icon, fn, title) => h('button.ex-cmd', { title: title || label, onclick: fn }, h('span', { html: icon }), label ? h('span', { text: label }) : null);
  const cmdBar = h('div.ex-cmdbar', null,
    cmd('New', '<b style="font-size:15px;color:#1e6fd9">&#8853;</b>', e => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom, [{ label: 'Folder', icon: I.folder, action: newFolder }, '-', { label: 'Text Document', icon: I.txt, action: () => newFile('New Text Document.txt') }, { label: 'C++ Source File', icon: I.cpp, action: () => newFile('New Source File.cpp') }]); }),
    h('span.ex-vsep'),
    cmd('', I.tCut, () => doCut(), 'Cut (Ctrl+X)'),
    cmd('', I.tCopy, () => doCopy(), 'Copy (Ctrl+C)'),
    cmd('', I.tPaste, () => doPaste(), 'Paste (Ctrl+V)'),
    cmd('', '<span style="font-size:13px">&#9998;</span>', () => startRename(), 'Rename (F2)'),
    cmd('', '<span style="font-size:14px">&#128465;</span>', () => doDelete(), 'Delete (Delete)'),
    h('span.ex-vsep'),
    cmd('Sort', '<span style="font-size:13px">&#8645;</span>', e => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom, [['name', 'Name'], ['date', 'Date modified'], ['type', 'Type'], ['size', 'Size']].map(([k, l]) => ({ label: l, checked: sortKey === k, action: () => { sortKey = k; render(); } })).concat(['-', { label: 'Ascending', checked: sortDir === 1, action: () => { sortDir = 1; render(); } }, { label: 'Descending', checked: sortDir === -1, action: () => { sortDir = -1; render(); } }])); }),
    cmd('View', '<span style="font-size:13px">&#9776;</span>', () => { }, 'Details view'));
  const nav = h('div.ex-navpane');
  const head = h('div.ex-head');
  const rows = h('div.ex-rows', { tabindex: 0 });
  const list = h('div.ex-list', null, head, rows);
  const status = h('div.ex-status');
  const body = h('div.ex', null,
    h('div.ex-top', null, btnBack, btnFwd, btnUp, btnRefresh, addr, search),
    cmdBar,
    h('div.ex-main', null, nav, list),
    status);
  const w = WM.open(id, { title: 'File Explorer', icon: I.explorer, w: 860, h: 520, x: 30 + explorerCount * 20, y: 30 + explorerCount * 20, cls: 'explorer', onClosed: () => vfs.listeners.splice(vfs.listeners.indexOf(onFs), 1) });
  w.body.append(body);

  function go(p, noHist) {
    p = VFS.norm(p);
    if (!vfs.isDir(p)) { msgBox('File Explorer', "Windows can't find '" + p + "'. Check the spelling and try again.", 'error'); return; }
    if (!noHist && !VFS.same(p, path)) { back.push(path); fwd = []; }
    path = p; sel.clear(); anchor = null; search.value = '';
    render();
  }
  btnBack.onclick = () => { if (back.length) { fwd.push(path); path = back.pop(); sel.clear(); render(); } };
  btnFwd.onclick = () => { if (fwd.length) { back.push(path); path = fwd.pop(); sel.clear(); render(); } };
  btnUp.onclick = () => { const s = VFS.split(path); if (s.length > 1) { const child = s[s.length - 1]; go(s.slice(0, -1).join('\\')); sel = new Set([child]); renderRows(); } };
  btnRefresh.onclick = () => render();
  search.addEventListener('input', () => renderRows());

  function renderAddr() {
    addr.innerHTML = '';
    const segs = VFS.split(path);
    addr.append(h('span.ex-crumb', { html: I.pc, onclick: () => go('C:') }));
    segs.forEach((s, i) => {
      addr.append(h('span.ex-chev', { text: '\u203A' }));
      addr.append(h('span.ex-crumb', { text: i === 0 ? driveLabel(s) : s, onclick: e => { e.stopPropagation(); go(segs.slice(0, i + 1).join('\\')); } }));
    });
    addr.onclick = (e) => {
      if (e.target !== addr) return;
      const inp = h('input.ex-addrin', { value: path });
      addr.innerHTML = ''; addr.append(inp); inp.focus(); inp.select();
      inp.onkeydown = ev => { if (ev.key === 'Enter') { const v = inp.value.trim().replace(/^"|"$/g, ''); if (vfs.isDir(v)) go(v); else if (vfs.exists(v)) { go(VFS.dirname(v)); openItem(v); } else msgBox('File Explorer', "Windows can't find '" + v + "'. Check the spelling and try again.", 'error'); renderAddr(); } if (ev.key === 'Escape') renderAddr(); };
      inp.onblur = () => setTimeout(renderAddr, 100);
    };
  }
  function renderNav() {
    nav.innerHTML = '';
    const item = (label, icon, p, depth) => h('div.ex-navitem' + (VFS.same(p, path) ? '.cur' : ''), { style: { paddingLeft: (8 + depth * 14) + 'px' }, onclick: () => go(p) }, h('span', { html: icon }), h('span', { text: label }));
    nav.append(item('Home', I.home, 'C:\\Users\\Student', 0));
    nav.append(h('div.ex-navsep'));
    nav.append(item('Desktop', I.desktop, 'C:\\Users\\Student\\Desktop', 0));
    nav.append(item('Downloads', I.dl, 'C:\\Users\\Student\\Downloads', 0));
    nav.append(item('Documents', I.docs, 'C:\\Users\\Student\\Documents', 0));
    nav.append(item('MAPP Programs', I.folder, 'D:\\MAPP Programs', 0));
    nav.append(h('div.ex-navsep'));
    nav.append(item('This PC', I.pc, 'C:', 0));
    nav.append(item('Local Disk (C:)', I.drive, 'C:', 1));
    nav.append(item('Local Disk (D:)', I.drive, 'D:', 1));
    for (const n of vfs.list('D:').filter(n => n.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))) {
      nav.append(item(n.name, I.folder, 'D:\\' + n.name, 2));
      if (VFS.isInside(path, 'D:\\' + n.name) || VFS.same(path, 'D:\\' + n.name))
        for (const c of vfs.list('D:\\' + n.name).filter(c => c.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))) nav.append(item(c.name, I.folder, 'D:\\' + n.name + '\\' + c.name, 3));
    }
  }
  function items() {
    let it = vfs.list(path);
    const q = search.value.trim().toLowerCase();
    if (q) it = it.filter(n => n.name.toLowerCase().includes(q));
    const key = n => sortKey === 'date' ? n.mtime : sortKey === 'size' ? (n.type === 'dir' ? -1 : vfs.size(n)) : sortKey === 'type' ? fileTypeName(n.name, n.type === 'dir') : n.name.toLowerCase();
    return it.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      const x = key(a), y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
    });
  }
  function renderHead() {
    head.innerHTML = '';
    [['name', 'Name'], ['date', 'Date modified'], ['type', 'Type'], ['size', 'Size']].forEach(([k, l]) => head.append(h('div.ex-hc.ex-c-' + k, { onclick: () => { if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; } renderRows(); renderHead(); } }, l, sortKey === k ? h('span.ex-sortar', { html: sortDir === 1 ? '&#8963;' : '&#8964;' }) : null)));
  }
  function renderRows() {
    rows.innerHTML = '';
    const its = items();
    if (!its.length) rows.append(h('div.ex-empty', { text: search.value ? 'No items match your search.' : 'This folder is empty.' }));
    for (const n of its) {
      const isDir = n.type === 'dir';
      const nameCell = h('div.ex-c.ex-c-name', null, h('span.ex-ic', { html: fileIcon(n.name, isDir) }), h('span.ex-nm', { text: n.name }));
      const row = h('div.ex-row' + (sel.has(n.name) ? '.sel' : '') + (Clip.mode === 'cut' && Clip.paths.some(p => VFS.same(p, VFS.join(path, n.name))) ? '.cut' : ''), { 'data-name': n.name },
        nameCell,
        h('div.ex-c.ex-c-date', { text: fmtDate(n.mtime) }),
        h('div.ex-c.ex-c-type', { text: fileTypeName(n.name, isDir) }),
        h('div.ex-c.ex-c-size', { text: isDir ? '' : fmtSize(vfs.size(n)) }));
      row.addEventListener('mousedown', e => {
        if (renaming) return;
        if (e.button === 2 && sel.has(n.name)) return;
        if (e.ctrlKey) { sel.has(n.name) ? sel.delete(n.name) : sel.add(n.name); anchor = n.name; }
        else if (e.shiftKey && anchor) { const names = its.map(x => x.name); const a = names.indexOf(anchor), b = names.indexOf(n.name); sel = new Set(names.slice(Math.min(a, b), Math.max(a, b) + 1)); }
        else { sel = new Set([n.name]); anchor = n.name; }
        focusName = n.name; paintSel(); rows.focus();
      });
      row.addEventListener('dblclick', () => openItem(VFS.join(path, n.name)));
      row.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (!sel.has(n.name)) { sel = new Set([n.name]); paintSel(); } itemMenu(e.clientX, e.clientY, n); });
      rows.append(row);
    }
    updateStatus();
  }
  function paintSel() { rows.querySelectorAll('.ex-row').forEach(r => r.classList.toggle('sel', sel.has(r.dataset.name))); updateStatus(); }
  function updateStatus() {
    const its = vfs.list(path);
    let s = its.length + (its.length === 1 ? ' item' : ' items');
    if (sel.size) {
      s += '\u2003\u2003' + sel.size + (sel.size === 1 ? ' item selected' : ' items selected');
      const files = [...sel].map(nm => vfs.node(VFS.join(path, nm))).filter(n => n && n.type === 'file');
      if (files.length === sel.size) s += '\u2003' + files.reduce((a, n) => a + vfs.size(n), 0).toLocaleString() + ' bytes';
    }
    status.textContent = s;
  }
  function render() {
    w.setTitle(VFS.split(path).length === 1 ? driveLabel(VFS.split(path)[0]) : VFS.basename(path));
    btnBack.disabled = !back.length; btnFwd.disabled = !fwd.length; btnUp.disabled = VFS.split(path).length <= 1;
    renderAddr(); renderNav(); renderHead(); renderRows();
  }
  function selPaths() { return [...sel].map(n => VFS.join(path, n)); }
  function itemMenu(x, y, n) {
    const p = VFS.join(path, n.name);
    const isDir = n.type === 'dir', ext = VFS.ext(n.name);
    const items = [{ label: 'Open', action: () => openItem(p) }];
    if (!isDir && TEXT_EXT.includes(ext)) items.push({ label: 'Open with', sub: [{ label: 'Notepad', icon: I.notepad, action: () => openNotepad(p) }, { label: '\u00b5Vision', icon: I.uvision, action: () => G.UV.openFileStandalone(p) }] });
    if (ext === 'uvprojx') items.push({ label: 'Open with \u00b5Vision', icon: I.uvision, action: () => openItem(p) });
    items.push('-', { label: 'Cut', icon: I.tCut, key: 'Ctrl+X', action: doCut }, { label: 'Copy', icon: I.tCopy, key: 'Ctrl+C', action: doCopy });
    if (isDir) items.push({ label: 'Paste into folder', icon: I.tPaste, disabled: !Clip.paths.length, action: () => doPaste(p) });
    items.push('-', { label: 'Copy as path', key: 'Ctrl+Shift+C', action: () => { try { navigator.clipboard.writeText('"' + p + '"'); } catch (e) { } toast('Path copied'); } },
      { label: 'Rename', key: 'F2', action: startRename }, { label: 'Delete', key: 'Del', action: doDelete }, '-', { label: 'Properties', key: 'Alt+Enter', action: () => props(p) });
    showMenu(x, y, items);
  }
  rows.addEventListener('contextmenu', e => {
    if (e.target.closest('.ex-row')) return;
    e.preventDefault(); sel.clear(); paintSel();
    showMenu(e.clientX, e.clientY, [
      { label: 'View', sub: [{ label: 'Details', checked: true }] },
      { label: 'Sort by', sub: [['name', 'Name'], ['date', 'Date modified'], ['type', 'Type'], ['size', 'Size']].map(([k, l]) => ({ label: l, checked: sortKey === k, action: () => { sortKey = k; renderRows(); renderHead(); } })) },
      { label: 'Refresh', action: render }, '-',
      { label: 'Paste', key: 'Ctrl+V', disabled: !Clip.paths.length, action: () => doPaste() }, '-',
      { label: 'New', sub: [{ label: 'Folder', icon: I.folder, action: newFolder }, '-', { label: 'Text Document', icon: I.txt, action: () => newFile('New Text Document.txt') }] },
      '-', { label: 'Open in Terminal', disabled: true }, { label: 'Properties', action: () => props(path) }]);
  });
  rows.addEventListener('mousedown', e => { if (!e.target.closest('.ex-row') && !renaming) { sel.clear(); paintSel(); } });

  function openItem(p) {
    const n = vfs.node(p); if (!n) return;
    if (n.type === 'dir') { go(p); return; }
    const ext = VFS.ext(p);
    if (ext === 'uvprojx') { G.UV.openProject(p); return; }
    if (ext === 'exe') { if (/UV4\.exe$/i.test(p)) G.UV.show(); return; }
    if (TEXT_EXT.includes(ext)) { openNotepad(p); return; }
    msgBox(VFS.basename(p), 'There is no app associated with this file in the lab PC simulator.\n\n' + VFS.basename(p), 'info');
  }
  function doCopy() { if (!sel.size) return; Clip.mode = 'copy'; Clip.paths = selPaths(); renderRows(); }
  function doCut() { if (!sel.size) return; Clip.mode = 'cut'; Clip.paths = selPaths(); renderRows(); }
  async function doPaste(dst) {
    dst = dst || path;
    if (!Clip.paths.length) return;
    const pasted = [];
    for (const src of Clip.paths) {
      const n = vfs.node(src);
      if (!n) continue;
      if (n.type === 'dir' && (VFS.same(src, dst) || VFS.isInside(dst, src))) { await msgBox('Interrupted Action', 'The destination folder is a subfolder of the source folder.', 'error'); continue; }
      const sameDir = VFS.same(VFS.dirname(src), dst);
      let name = n.name;
      if (sameDir) {
        if (Clip.mode === 'cut') continue;
        name = vfs.uniqueCopyName(dst, n.name, n.type === 'dir');
      } else if (vfs.exists(VFS.join(dst, n.name))) {
        const r = await modal({ title: 'Replace or Skip Files', body: h('div.replace', null,
            h('div', { text: (Clip.mode === 'cut' ? 'Moving' : 'Copying') + ' 1 item from ' + VFS.basename(VFS.dirname(src)) + ' to ' + VFS.basename(dst) }),
            h('div.rp-big', { text: 'The destination already has a ' + (n.type === 'dir' ? 'folder' : 'file') + ' named "' + n.name + '"' })),
          buttons: [{ label: '\u2714  Replace the file in the destination', value: 'replace', default: true }, { label: '\u21B7  Skip this file', value: 'skip', cancel: true }], width: 480 });
        if (r !== 'replace') continue;
        vfs.remove(VFS.join(dst, n.name));
      }
      const np = vfs.copyInto(src, dst, name);
      if (Clip.mode === 'cut') vfs.remove(src);
      pasted.push(VFS.basename(np));
      G.App.events.emit('paste', { src, dst: np });
    }
    if (Clip.mode === 'cut') { Clip.mode = null; Clip.paths = []; }
    if (VFS.same(dst, path)) { sel = new Set(pasted); render(); }
  }
  async function doDelete() {
    if (!sel.size) return;
    const ps = selPaths();
    const r = await msgBox(ps.length === 1 ? 'Delete File' : 'Delete Multiple Items', ps.length === 1 ? 'Are you sure you want to move this ' + (vfs.isDir(ps[0]) ? 'folder' : 'file') + ' to the Recycle Bin?\n\n' + VFS.basename(ps[0]) : 'Are you sure you want to move these ' + ps.length + ' items to the Recycle Bin?', 'warn', 'yesno');
    if (r !== 'yes') return;
    ps.forEach(p => vfs.remove(p)); sel.clear(); render();
  }
  function newFolder() {
    let n = 'New folder', k = 2; while (vfs.exists(VFS.join(path, n))) n = 'New folder (' + (k++) + ')';
    vfs.mkdirp(VFS.join(path, n)); vfs.changed(VFS.join(path, n), 'write'); sel = new Set([n]); render(); startRename();
  }
  function newFile(name) {
    let base = name.replace(/(\.[^.]+)$/, ''), ext = (/(\.[^.]+)$/.exec(name) || [''])[0], n = name, k = 2;
    while (vfs.exists(VFS.join(path, n))) n = base + ' (' + (k++) + ')' + ext;
    vfs.write(VFS.join(path, n), ''); sel = new Set([n]); render(); startRename();
  }
  function startRename() {
    if (sel.size !== 1) return;
    const name = [...sel][0];
    const row = rows.querySelector('.ex-row[data-name="' + CSS.escape(name) + '"]'); if (!row) return;
    const nm = row.querySelector('.ex-nm');
    const inp = h('input.ex-rename', { value: name });
    nm.replaceWith(inp); renaming = name;
    inp.focus();
    const dot = name.lastIndexOf('.');
    inp.setSelectionRange(0, vfs.isDir(VFS.join(path, name)) || dot <= 0 ? name.length : dot);
    let done = false;
    const finish = async (ok) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      renaming = null;
      if (ok && v && v !== name) {
        if (/[\\/:*?"<>|]/.test(v)) { await msgBox('Rename', 'A file name can\'t contain any of the following characters:\n\\ / : * ? " < > |', 'error'); render(); return; }
        if (vfs.exists(VFS.join(path, v)) && v.toLowerCase() !== name.toLowerCase()) { await msgBox('Rename File', 'There is already a file with the same name in this location.', 'warn'); render(); return; }
        const oldExt = VFS.ext(name), newExt = VFS.ext(v);
        if (!vfs.isDir(VFS.join(path, name)) && oldExt !== newExt) {
          const r = await msgBox('Rename', 'If you change a file name extension, the file might become unusable.\n\nAre you sure you want to change it?', 'warn', 'yesno');
          if (r !== 'yes') { render(); return; }
        }
        vfs.rename(VFS.join(path, name), v); sel = new Set([v]);
      }
      render();
    };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('mousedown', e => e.stopPropagation());
  }
  function props(p) {
    const n = vfs.node(p); if (!n) return;
    const cnt = (x) => x.type === 'dir' ? Object.values(x.children).reduce((a, c) => a + cnt(c), 0) : 1;
    msgBox(n.name + ' Properties', 'Type: ' + fileTypeName(n.name, n.type === 'dir') + '\nLocation: ' + VFS.dirname(p) + (n.type === 'file' ? '\nSize: ' + vfs.size(n).toLocaleString() + ' bytes' : '\nContains: ' + cnt(n) + ' files') + '\nModified: ' + fmtDate(n.mtime), 'info');
  }
  rows.addEventListener('keydown', e => {
    if (renaming) return;
    const its = items().map(n => n.name);
    const k = e.key;
    if (e.ctrlKey && k.toLowerCase() === 'c') { e.preventDefault(); doCopy(); }
    else if (e.ctrlKey && k.toLowerCase() === 'x') { e.preventDefault(); doCut(); }
    else if (e.ctrlKey && k.toLowerCase() === 'v') { e.preventDefault(); doPaste(); }
    else if (e.ctrlKey && k.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(its); paintSel(); }
    else if (k === 'Delete') { e.preventDefault(); doDelete(); }
    else if (k === 'F2') { e.preventDefault(); startRename(); }
    else if (k === 'Enter') { e.preventDefault(); if (sel.size === 1) openItem(VFS.join(path, [...sel][0])); }
    else if (k === 'Backspace' || (e.altKey && k === 'ArrowUp')) { e.preventDefault(); btnUp.onclick(); }
    else if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); btnBack.onclick(); }
    else if (e.altKey && k === 'ArrowRight') { e.preventDefault(); btnFwd.onclick(); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      let i = its.indexOf(focusName); i = k === 'ArrowDown' ? Math.min(its.length - 1, i + 1) : Math.max(0, i - 1);
      focusName = its[i]; sel = new Set([focusName]); anchor = focusName; paintSel();
      const r = rows.querySelector('.ex-row[data-name="' + CSS.escape(focusName) + '"]'); r && r.scrollIntoView({ block: 'nearest' });
    }
  });
  function onFs(p) { if (!renaming && (VFS.isInside(p, path) || VFS.same(VFS.dirname(p), path) || VFS.same(p, path))) { if (!vfs.isDir(path)) { path = 'D:\\MAPP Programs'; } render(); } else if (!renaming) renderNav(); }
  vfs.onChange(onFs);
  render();
  return w;
}

/* ---------------- Notepad ---------------- */
function openNotepad(p) {
  const vfs = G.App.vfs;
  const id = 'np:' + p.toLowerCase();
  if (WM.get(id)) { WM.get(id).focus(); return; }
  const ta = h('textarea.np-ta', { spellcheck: 'false', wrap: 'off' });
  ta.value = vfs.read(p) || '';
  let saved = ta.value;
  const pos = h('span', { text: 'Ln 1, Col 1' });
  const save = () => { vfs.write(p, ta.value); saved = ta.value; upd(); G.App.events.emit('extwrite', p); };
  const mb = G.menuBar([
    { label: 'File', items: () => [{ label: 'Save', key: 'Ctrl+S', action: save }, '-', { label: 'Close', action: () => w.close() }] },
    { label: 'Edit', items: () => [{ label: 'Undo', key: 'Ctrl+Z', action: () => { ta.focus(); document.execCommand('undo'); } }, '-', { label: 'Select All', key: 'Ctrl+A', action: () => { ta.focus(); ta.select(); } }] },
    { label: 'View', items: [{ label: 'Status bar', checked: true }] }]);
  const w = WM.open(id, { title: VFS.basename(p) + ' - Notepad', icon: I.notepad, w: 640, h: 460, cls: 'notepad',
    onClose: () => { if (ta.value !== saved) { msgBox('Notepad', 'Do you want to save changes to ' + VFS.basename(p) + '?', 'question', 'yesnocancel').then(r => { if (r === 'yes') { save(); w.close(true); } else if (r === 'no') w.close(true); }); return false; } } });
  w.body.append(h('div.np', null, mb, ta, h('div.np-status', null, pos, h('span', { text: '100%' }), h('span', { text: 'Windows (CRLF)' }), h('span', { text: 'UTF-8' }))));
  const upd = () => { w.setTitle((ta.value !== saved ? '*' : '') + VFS.basename(p) + ' - Notepad'); const b = ta.value.slice(0, ta.selectionStart).split('\n'); pos.textContent = 'Ln ' + b.length + ', Col ' + (b[b.length - 1].length + 1); };
  ta.addEventListener('input', upd); ta.addEventListener('keyup', upd); ta.addEventListener('click', upd);
  ta.addEventListener('keydown', e => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '\t'); } });
  setTimeout(() => ta.focus(), 50);
}

G.Clip = Clip; G.openExplorer = openExplorer; G.openNotepad = openNotepad;
})(window);
