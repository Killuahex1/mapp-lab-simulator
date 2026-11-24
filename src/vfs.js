// vfs.js — virtual Windows file system (D:\MAPP Programs ...) + uVision project file helpers
(function (G) {
'use strict';
const STORE_KEY = 'mappsim.vfs.v1';

function now() { return Date.now(); }
function dirNode(name) { return { type: 'dir', name, children: {}, mtime: now() }; }
function fileNode(name, content, mtime) { return { type: 'file', name, content: content == null ? '' : content, mtime: mtime || now() }; }

class VFS {
  constructor() { this.root = dirNode(''); this.listeners = []; this.saveTimer = null; }
  static split(path) { return String(path).replace(/\//g, '\\').split('\\').filter(Boolean); }
  static join(...p) { return p.filter(x => x != null && x !== '').join('\\').replace(/\\{2,}/g, '\\'); }
  static dirname(p) { const s = VFS.split(p); s.pop(); return s.join('\\') + (s.length === 1 ? '\\' : ''); }
  static basename(p) { const s = VFS.split(p); return s[s.length - 1] || ''; }
  static ext(p) { const b = VFS.basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; }
  static norm(p) { const s = VFS.split(p); return s.join('\\') + (s.length === 1 ? '\\' : ''); }
  static same(a, b) { return VFS.norm(a).toLowerCase() === VFS.norm(b).toLowerCase(); }
  static isInside(child, parent) { const c = VFS.split(child).map(x => x.toLowerCase()), p = VFS.split(parent).map(x => x.toLowerCase()); return c.length > p.length && p.every((x, i) => c[i] === x); }
  static relative(fromDir, to) {
    const a = VFS.split(fromDir), b = VFS.split(to);
    let i = 0; while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
    if (i === 0) return to;
    const up = a.slice(i).map(() => '..'), rest = b.slice(i);
    return (up.length ? up.join('\\') : '.') + '\\' + rest.join('\\');
  }
  static resolve(baseDir, rel) {
    rel = String(rel).replace(/\//g, '\\');
    if (/^[A-Za-z]:/.test(rel)) return VFS.norm(rel);
    const out = VFS.split(baseDir);
    for (const part of rel.split('\\')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (out.length > 1) out.pop(); } else out.push(part);
    }
    return out.join('\\');
  }
  node(path) {
    let n = this.root;
    for (const seg of VFS.split(path)) {
      if (!n || n.type !== 'dir') return null;
      n = n.children[seg.toLowerCase()];
    }
    return n || null;
  }
  exists(p) { return !!this.node(p); }
  isDir(p) { const n = this.node(p); return !!n && n.type === 'dir'; }
  read(p) { const n = this.node(p); return n && n.type === 'file' ? n.content : null; }
  list(p) {
    const n = this.node(p); if (!n || n.type !== 'dir') return [];
    return Object.values(n.children);
  }
  mkdirp(p) {
    let n = this.root;
    for (const seg of VFS.split(p)) {
      let c = n.children[seg.toLowerCase()];
      if (!c) { c = dirNode(seg); n.children[seg.toLowerCase()] = c; n.mtime = now(); }
      n = c;
    }
    return n;
  }
  write(p, content, quiet) {
    const dir = this.mkdirp(VFS.dirname(p));
    const name = VFS.basename(p);
    const ex = dir.children[name.toLowerCase()];
    if (ex && ex.type === 'file') { ex.content = content; ex.mtime = now(); }
    else { dir.children[name.toLowerCase()] = fileNode(name, content); dir.mtime = now(); }
    if (!quiet) this.changed(p, 'write');
  }
  remove(p) {
    const parent = this.node(VFS.dirname(p)); if (!parent) return false;
    const k = VFS.basename(p).toLowerCase();
    if (!parent.children[k]) return false;
    delete parent.children[k]; parent.mtime = now();
    this.changed(p, 'remove'); return true;
  }
  rename(p, newName) {
    const parent = this.node(VFS.dirname(p)); const n = this.node(p);
    if (!parent || !n) return false;
    if (parent.children[newName.toLowerCase()] && newName.toLowerCase() !== n.name.toLowerCase()) return false;
    delete parent.children[n.name.toLowerCase()];
    n.name = newName; parent.children[newName.toLowerCase()] = n; parent.mtime = now();
    this.changed(p, 'rename', VFS.join(VFS.dirname(p), newName)); return true;
  }
  clone(n) { return JSON.parse(JSON.stringify(n)); }
  copyInto(src, dstDir, newName) {
    const n = this.node(src); const d = this.node(dstDir);
    if (!n || !d || d.type !== 'dir') return null;
    const c = this.clone(n); c.name = newName || n.name;
    const stamp = (x) => { if (x.type === 'dir') { x.mtime = now(); Object.values(x.children).forEach(stamp); } };
    stamp(c); if (c.type === 'dir') c.mtime = now();
    d.children[c.name.toLowerCase()] = c; d.mtime = now();
    const p = VFS.join(dstDir, c.name);
    this.changed(p, 'write'); return p;
  }
  uniqueCopyName(dir, name, isDir) {
    let base = name, ext = '';
    if (!isDir) { const i = name.lastIndexOf('.'); if (i > 0) { base = name.slice(0, i); ext = name.slice(i); } }
    let cand = base + ' - Copy' + ext, k = 2;
    while (this.exists(VFS.join(dir, cand))) cand = base + ' - Copy (' + (k++) + ')' + ext;
    return cand;
  }
  size(n) { if (n.type === 'file') return n.size != null ? n.size : new Blob([n.content || '']).size; return 0; }
  onChange(f) { this.listeners.push(f); }
  changed(p, kind, extra) { for (const f of this.listeners) try { f(p, kind, extra); } catch (e) { console.error(e); } this.scheduleSave(); }
  scheduleSave() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.save(), 400); }
  save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.root)); } catch (e) { /* storage unavailable */ } }
  load() { try { const s = localStorage.getItem(STORE_KEY); if (s) { this.root = JSON.parse(s); return true; } } catch (e) { } return false; }
}

/* ---------- seed the lab PC's drives ---------- */
const MBED_OS_DIRS = ['.github', 'cmsis', 'connectivity', 'docs', 'drivers', 'events', 'features', 'hal', 'platform', 'rtos', 'storage', 'targets', 'tools'];
function seed(vfs) {
  vfs.root = dirNode('');
  const C = vfs.mkdirp('C:'); C.name = 'C:';
  for (const d of ['Users\\Student\\Desktop', 'Users\\Student\\Documents', 'Users\\Student\\Downloads', 'Keil_v5\\UV4', 'Program Files']) vfs.mkdirp('C:\\' + d);
  vfs.write('C:\\Keil_v5\\UV4\\UV4.exe', '[binary]', true);
  const D = vfs.mkdirp('D:'); D.name = 'D:';
  const base = 'D:\\MAPP Programs';
  vfs.mkdirp(base);
  const files = G.MAPP_FILES || {};
  for (const rel in files) vfs.write(VFS.join(base, rel), files[rel], true);
  const tpl = VFS.join(base, 'NUCLEO_F103RB');
  for (const d of MBED_OS_DIRS) vfs.write(VFS.join(tpl, 'mbed-os', d, '.keep'), '', true);
  vfs.write(VFS.join(tpl, 'mbed-os', 'mbed.h'), '/* mbed Microcontroller Library - mbed.h (simulated) */\n#ifndef MBED_H\n#define MBED_H\n#include "platform/mbed_version.h"\n#include "drivers/DigitalOut.h"\n#include "drivers/DigitalIn.h"\n#include "drivers/BusOut.h"\n#include "drivers/BusIn.h"\n#include "drivers/PortOut.h"\n#include "drivers/PortIn.h"\n/* ... */\n#endif\n', true);
  vfs.write(VFS.join(tpl, 'NUCLEO_F103RB.uvprojx'), Project.template(), true);
  vfs.write(VFS.join(tpl, 'DebugConfig', 'NUCLEO_F103RB_STM32F103RB_1.0.0.dbgconf'), '// File: STM32F101_102_103_105_107.dbgconf\n// Version: 1.0.0\n', true);
  vfs.save();
}

/* ---------- uVision project (.uvprojx) ---------- */
const Project = {
  template() {
    return Project.serialize({ target: 'NUCLEO_F103RB', groups: [
      { name: 'mbed-os', files: [], locked: true },
      { name: 'NUCLEO_F103RB', files: [{ name: 'main.cpp', path: './main.cpp', type: 8 }, { name: 'mbed_config.h', path: 'mbed_config.h', type: 5 }] }] });
  },
  parse(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('The project file is corrupt (XML parse error).');
    const target = (doc.querySelector('TargetName') || {}).textContent || 'NUCLEO_F103RB';
    const groups = [...doc.querySelectorAll('Group')].map(g => ({
      name: (g.querySelector('GroupName') || {}).textContent || 'Group',
      locked: ((g.querySelector('GroupName') || {}).textContent || '') === 'mbed-os',
      files: [...g.querySelectorAll('File')].map(f => ({
        name: (f.querySelector('FileName') || {}).textContent,
        path: (f.querySelector('FilePath') || {}).textContent,
        type: +((f.querySelector('FileType') || {}).textContent || 8)
      }))
    }));
    return { target, groups };
  },
  serialize(p) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let g = '';
    for (const gr of p.groups) {
      g += '        <Group>\n          <GroupName>' + esc(gr.name) + '</GroupName>\n';
      if (gr.name === 'mbed-os') g += '          <!-- 512 mbed-os source files (pre-built library, not shown in the simulator) -->\n';
      if (gr.files.length) {
        g += '          <Files>\n';
        for (const f of gr.files) g += '            <File>\n              <FileName>' + esc(f.name) + '</FileName>\n              <FileType>' + (f.type || 8) + '</FileType>\n              <FilePath>' + esc(f.path) + '</FilePath>\n            </File>\n';
        g += '          </Files>\n';
      }
      g += '        </Group>\n';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<Project xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project_projx.xsd">\n\n  <SchemaVersion>2.1</SchemaVersion>\n\n  <Header>### uVision Project, (C) Keil Software</Header>\n\n  <Targets>\n    <Target>\n      <TargetName>' + esc(p.target) + '</TargetName>\n      <ToolsetNumber>0x4</ToolsetNumber>\n      <ToolsetName>ARM-ADS</ToolsetName>\n      <pArmCC>6220000::V6.22::ARMCLANG</pArmCC>\n      <uAC6>1</uAC6>\n      <TargetOption>\n        <TargetCommonOption>\n          <Device>STM32F103RB</Device>\n          <Vendor>STMicroelectronics</Vendor>\n          <OutputDirectory>.\\BUILD\\</OutputDirectory>\n          <OutputName>NUCLEO_F103RB</OutputName>\n          <CreateHexFile>1</CreateHexFile>\n        </TargetCommonOption>\n      </TargetOption>\n      <Groups>\n' + g + '      </Groups>\n    </Target>\n  </Targets>\n\n</Project>\n';
  },
  fileType(name) { const e = VFS.ext(name); return e === 'c' ? 1 : (e === 'cpp' || e === 'cc' || e === 'cxx') ? 8 : e === 's' ? 2 : e === 'lib' ? 4 : e === 'o' ? 3 : 5; },
};

G.VFS = VFS; G.Project = Project; G.seedVFS = seed;
})(window);
