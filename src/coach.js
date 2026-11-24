// coach.js — "Lab Test Practice" window: live procedure checklist + automatic lecturer checks
(function (G) {
'use strict';
const { h, I, WM } = G;
const bin8 = v => (v & 255).toString(2).padStart(8, '0');
const SEGCH = { 0x3F: '0', 0x06: '1', 0x5B: '2', 0x4F: '3', 0x66: '4', 0x6D: '5', 0x7D: '6', 0x07: '7', 0x27: '7', 0x7F: '8', 0x6F: '9', 0x67: '9', 0x77: 'A', 0x7C: 'b', 0x39: 'C', 0x58: 'c', 0x5E: 'd', 0x79: 'E', 0x71: 'F', 0x40: '-', 0x00: ' ' };
const segName = v => SEGCH[v & 0x7F] != null ? SEGCH[v & 0x7F] : '?';

/* ---------------- headless test harness ---------------- */
class Fail extends Error { }
function harness(img) {
  const m = new G.MappRuntime.Machine({ headless: true });
  m.load(img); m.powerOn();
  const t0 = performance.now();
  const H = {
    m,
    run(ms) {
      if (m.state === 'fault') throw new Fail('Your program crashed (HardFault: ' + m.fault + ').');
      m.runUntil(m.t + ms * 1000, 6000);
      if (performance.now() - t0 > 20000) throw new Fail('The test took too long to simulate.');
      if (m.state === 'fault') throw new Fail('Your program crashed (HardFault: ' + m.fault + ').');
    },
    bar: () => m.portLevel(2) & 255,
    dip(n, v) { m.board.dip[n] = v; m.setDrive(); },
    btn(n, v) { m.board.btn[n] = v; m.setDrive(); },
    key(k, hold) { m.board.pressKey(k); H.run(hold || 150); m.board.releaseKey(); },
    lcd: () => [m.board.lcd.text(0), m.board.lcd.text(1)],
    stable(ms) { const v = []; for (let i = 0; i < 10; i++) { H.run(ms / 10); v.push(H.bar()); } return v.every(x => x === v[0]) ? v[0] : { changing: v }; },
    // wait until the LCD text has stopped changing for 300 ms (max 4 s)
    settle() { let last = H.lcd().join('|'), quiet = 0; for (let t = 0; t < 4000 && quiet < 300; t += 50) { H.run(50); const n = H.lcd().join('|'); if (n === last) quiet += 50; else { quiet = 0; last = n; } } },
    waitLcd(pred, ms, step) { step = step || 50; for (let t = 0; t <= ms; t += step) { if (pred(H.lcd())) return true; H.run(step); } return pred(H.lcd()); },
  };
  return H;
}
const show = s => '"' + s.replace(/\s+$/, '') + '"';
const has = (s, re) => re.test(s);

/* ---------------- tests ---------------- */
const TESTS = {
  p1a(img) {
    const H = harness(img); H.dip('PB12', 1); H.dip('PA4', 1); H.dip('PD2', 1);
    H.run(30);
    const runs = []; let cur = H.bar(), len = 0;
    for (let t = 0; t < 4000; t += 10) { H.run(10); const v = H.bar(); if (v === cur) len += 10; else { runs.push({ v: cur, ms: len }); cur = v; len = 10; } }
    runs.push({ v: cur, ms: len, last: true });
    const seq = runs.slice(0, 7).map(r => bin8(r.v) + ' (' + r.ms + (r.last ? '+' : '') + ' ms)').join('  \u2192  ');
    if (runs.length < 3) throw new Fail('The LED bar does not change. It stays at ' + bin8(runs[0].v) + '.\nExpected it to alternate 00000011 and 00110000 every 500 ms.');
    const steady = runs.slice(1, -1);
    const vals = [...new Set(steady.map(r => r.v))];
    if (!(vals.length === 2 && vals.includes(0x03) && vals.includes(0x30))) throw new Fail('Wrong LED patterns. Observed: ' + seq + '\nExpected: 00000011 and 00110000 (pattern 1 = 0x03, pattern 2 = 0x30).');
    const bad = steady.find(r => r.ms < 430 || r.ms > 570);
    if (bad) throw new Fail('Patterns are correct but the timing is wrong: ' + bin8(bad.v) + ' stays on for ' + bad.ms + ' ms (expected 500 ms).\nObserved: ' + seq);
    return 'LED bar alternates 00000011 \u2194 00110000 every 500 ms.';
  },
  p1b(img) {
    const H = harness(img); H.dip('PA4', 1); H.dip('PD2', 1);
    H.dip('PB12', 1); H.run(300); const off1 = H.stable(200);
    H.dip('PB12', 0); H.run(300); const on = H.stable(200);
    H.dip('PB12', 1); H.run(300); const off2 = H.stable(200);
    const fmt = v => typeof v === 'object' ? 'changing (' + [...new Set(v.changing)].map(bin8).join(' / ') + ')' : bin8(v);
    if (on !== 0x33) throw new Fail('With PB12 pushed up (ON = 0) the LED bar shows ' + fmt(on) + '. Expected 00110011.');
    if (off1 !== 0 || off2 !== 0) throw new Fail('With PB12 down (OFF = 1) the LED bar shows ' + fmt(off1 !== 0 ? off1 : off2) + '. Expected all LEDs off (00000000).');
    return 'PB12 ON \u2192 00110011, PB12 OFF \u2192 all off.';
  },
  p1c(img) {
    const H = harness(img); H.dip('PB12', 1); H.run(200);
    const cases = [[0, 0, 0x00, 'all LEDs OFF'], [1, 0, 0x03, 'pattern 1'], [0, 1, 0x30, 'pattern 2'], [1, 1, 0xFF, 'all LEDs ON']];
    const rows = [];
    let ok = true;
    for (const [pd2, pa4, exp, what] of cases) {
      H.dip('PD2', pd2); H.dip('PA4', pa4); H.run(300);
      const v = H.stable(200);
      const got = typeof v === 'object' ? 'changing' : bin8(v);
      const pass = v === exp;
      if (!pass) ok = false;
      rows.push((pass ? '\u2714 ' : '\u2718 ') + 'PD2=' + pd2 + ' PA4=' + pa4 + ' \u2192 ' + got + (pass ? '' : '   (expected ' + bin8(exp) + ' = ' + what + ')'));
    }
    if (!ok) throw new Fail('Truth table not matched:\n' + rows.join('\n') + '\n\nRemember: switch pushed UP (ON) reads 0, pulled DOWN (OFF) reads 1.');
    return rows.join('\n');
  },
  p2(img) {
    const H = harness(img);
    H.run(1600);
    const m = H.m, N = 1600, STEP = 0.25;
    const en = [0, 0, 0, 0], segc = [0, 1, 2, 3].map(() => new Array(8).fill(0)), lastOn = [-1, -1, -1, -1], gap = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      H.run(STEP);
      const lC = m.portLevel(2), lB = m.portLevel(1);
      for (let d = 0; d < 4; d++) if ((lC >> (8 + d)) & 1) {
        en[d]++; for (let s = 0; s < 8; s++) if ((lB >> s) & 1) segc[d][s]++;
        if (lastOn[d] >= 0) gap[d] = Math.max(gap[d], (i - lastOn[d]) * STEP); else gap[d] = Math.max(gap[d], i * STEP);
        lastOn[d] = i;
      }
    }
    for (let d = 0; d < 4; d++) if (lastOn[d] >= 0) gap[d] = Math.max(gap[d], (N - lastOn[d]) * STEP); else gap[d] = N * STEP;
    const pat = [0, 1, 2, 3].map(d => en[d] ? segc[d].reduce((a, c, s) => a | ((c / en[d] > 0.5 ? 1 : 0) << s), 0) : 0);
    const lit = [0, 1, 2, 3].map(d => en[d] / N > 0.01 && pat[d] !== 0);
    const shown = [3, 2, 1, 0].map(d => lit[d] ? segName(pat[d]) : ' ').join('');
    const exp = [0x4F, 0x5B, 0x06];
    const wrong = [];
    for (let d = 0; d < 3; d++) if ((pat[d] & 0x7F) !== exp[d] || !lit[d]) wrong.push('DIG' + d + ' shows ' + (lit[d] ? "'" + segName(pat[d]) + "' (0x" + pat[d].toString(16).toUpperCase().padStart(2, '0') + ')' : 'nothing') + ', expected \'' + segName(exp[d]) + "' (0x" + exp[d].toString(16).toUpperCase() + ')');
    if (lit[3]) wrong.push("DIG3 should be OFF ('-'), but it shows '" + segName(pat[3]) + "'");
    const slow = Math.max(gap[0], gap[1], gap[2]);
    if (wrong.length && slow > 25) throw new Fail('The digits are not refreshed fast enough to look steady (each digit is refreshed only every ' + Math.round(slow) + ' ms).\nUse a short delay between digits (e.g. WAIT_TIME_MS 5) so all digits appear lit at the same time.\n\nSeen during 0.4 s: [' + shown + ']\n' + wrong.join('\n'));
    if (wrong.length) throw new Fail('Display reads [' + shown + '] (DIG3 DIG2 DIG1 DIG0). Expected [ 123] i.e. "-123".\n' + wrong.join('\n'));
    if (slow > 25) throw new Fail('Correct digits, but they flicker: each digit is refreshed only every ' + Math.round(slow) + ' ms. Reduce WAIT_TIME_MS (about 1\u20135 ms) so the display looks steady.');
    if (pat.slice(0, 3).some(p => p & 0x80)) return 'Shows "-123" (note: a decimal point is also lit).';
    return 'Display shows "-123" steadily (refresh every ' + Math.round(slow) + ' ms per digit).';
  },
  p3start(img) {
    const H = harness(img);
    if (!H.waitLcd(L => /press\s*1/i.test(L[0]), 6000, 100)) {
      const L = H.lcd();
      if (/press\s*1/i.test(L[1])) throw new Fail('"Press 1" must be on the 1st line of the LCD, but it is on line 2.');
      throw new Fail('After start-up, LCD line 1 should show "Press 1". It shows: ' + show(L[0]) + ' / ' + show(L[1]) + (H.m.board.lcd.inited ? '' : '\n(The LCD was never initialised \u2013 did you call lcd_init()?)'));
    }
    H.run(1500);
    H.key('5', 150); H.run(1200);
    let L = H.lcd();
    if (/bye|waiting/i.test(L.join(' '))) throw new Fail("Pressing a key other than '1' (I pressed '5') must NOT end the wait. LCD now shows: " + show(L[0]) + ' / ' + show(L[1]));
    H.key('A', 150); H.run(800);
    return H;
  },
  p3a(img) {
    const H = TESTS.p3start(img);
    H.key('1', 150);
    if (!H.waitLcd(L => /bye/i.test(L[1]) || /bye/i.test(L[0]), 3000)) throw new Fail("After pressing '1', the LCD should show \"Bye....\". It shows " + show(H.lcd()[0]) + ' / ' + show(H.lcd()[1]));
    H.settle();
    const L = H.lcd();
    if (!/bye/i.test(L[1])) return 'Note: "Bye" appeared on line 1 \u2013 for this first step the task asks for line 2 (the count-down version puts it on line 1).';
    H.run(1500); const L2 = H.lcd();
    if (L2.join('') !== L.join('')) throw new Fail('After "Bye...." the program should stop, but the LCD kept changing: ' + show(L2[0]) + ' / ' + show(L2[1]));
    return 'Waits for \'1\' (ignored \'5\' and \'A\'), then shows ' + show(L[1]) + ' on line 2 and stops.';
  },
  countdown(H, budget) {
    const seen = []; let byeAt = null, t = 0;
    for (; t < budget; t += 50) {
      H.run(50);
      const L = H.lcd(), txt = L.join(' ');
      const m = /([1-9])\s*waiting/i.exec(txt);
      if (m && (!seen.length || seen[seen.length - 1].n !== +m[1])) seen.push({ n: +m[1], t, txt: L.slice() });
      if (/bye/i.test(txt) && seen.length) { byeAt = t; break; }
    }
    return { seen, byeAt, t };
  },
  p3b(img) {
    const H = TESTS.p3start(img);
    H.key('1', 150);
    const r = TESTS.countdown(H, 14000);
    const ns = r.seen.map(s => s.n).join(' \u2192 ');
    if (!r.seen.length) throw new Fail("After pressing '1' no count-down (\"4 waiting....\") appeared. LCD shows " + show(H.lcd()[0]) + ' / ' + show(H.lcd()[1]));
    if (ns !== '4 \u2192 3 \u2192 2 \u2192 1') throw new Fail('Count-down sequence seen: ' + ns + '. Expected 4 \u2192 3 \u2192 2 \u2192 1.');
    const iv = r.seen.slice(1).map((s, i) => s.t - r.seen[i].t);
    const bad = iv.find(x => x < 850 || x > 3600);
    if (bad) throw new Fail('Count-down steps are ' + iv.join(', ') + ' ms apart. Expected about 1 s per step (thread_sleep_for(1000)) plus the time the LCD takes to write the text (about 0.1 s per character with lcd_utilities.cpp).');
    if (r.byeAt == null) throw new Fail('After "1 waiting" the LCD should be cleared and show "Bye....". It shows ' + show(H.lcd()[0]) + ' / ' + show(H.lcd()[1]));
    H.run(400);
    const L = H.lcd();
    if (!/^\s*bye/i.test(L[0])) throw new Fail('"Bye...." must be on the 1st line after clearing the LCD. LCD shows ' + show(L[0]) + ' / ' + show(L[1]));
    if (L[1].trim()) throw new Fail('Clear the LCD before showing "Bye...." \u2013 line 2 still shows ' + show(L[1]));
    H.run(1500);
    if (H.lcd().join('') !== L.join('')) throw new Fail('After "Bye...." the program should stop (while(1);), but the LCD kept changing.');
    return 'Ignored other keys, counted 4 \u2192 3 \u2192 2 \u2192 1 (' + iv.join(' / ') + ' ms), cleared and showed ' + show(L[0]) + '.';
  },
  drill(img) {
    const H = TESTS.p3start(img);
    H.key('1', 150);
    let seen2 = false;
    for (let t = 0; t < 9000; t += 50) { H.run(50); if (/2\s*waiting/i.test(H.lcd().join(' '))) { seen2 = true; break; } if (/bye/i.test(H.lcd().join(' '))) break; }
    if (!seen2) throw new Fail('Could not see "2 waiting...." during the count-down \u2013 make sure the basic count-down works first.');
    // press once "2 waiting...." is fully on the screen, like a student would
    let last = H.lcd().join('|'), quiet = 0;
    for (let t = 0; t < 3000 && quiet < 150; t += 25) { H.run(25); const n = H.lcd().join('|'); if (n === last) quiet += 25; else { quiet = 0; last = n; } }
    H.run(100);
    // hold PC13 until the display reacts (or 2.5 s), then release
    const numNow = () => { const m = /([1-9])\s*waiting/i.exec(H.lcd().join(' ')); return /bye/i.test(H.lcd().join(' ')) ? 'bye' : m ? +m[1] : null; };
    H.btn('PC13', 0);
    for (let t = 0; t < 2500; t += 25) { H.run(25); if (t >= 200 && numNow() !== 2) break; }
    H.btn('PC13', 1);
    const r = TESTS.countdown(H, 14000);
    const ns = r.seen.map(s => s.n);
    const after = ns.filter((n, i) => !(i === 0 && n === 2));
    if (!after.length) throw new Fail('After pressing PC13 at "2 waiting" nothing changed. LCD: ' + show(H.lcd()[0]) + ' / ' + show(H.lcd()[1]));
    if (after[0] !== 4) throw new Fail('Pressed PC13 while "2 waiting...." was shown; the next number displayed was ' + after[0] + ' (expected the timer to restart from 4).');
    if (after.join(',') !== '4,3,2,1') throw new Fail('After the reset the count-down went ' + after.join(' \u2192 ') + ' (expected 4 \u2192 3 \u2192 2 \u2192 1).');
    if (r.byeAt == null) throw new Fail('The count-down restarted, but "Bye...." never appeared afterwards.');
    return 'PC13 at "2 waiting" restarted the count from 4, then 3 \u2192 2 \u2192 1 \u2192 Bye.';
  },
};

/* ---------------- task definitions ---------------- */
const SOL = {
  p1a: '#define WAIT_TIME_MS 500                    // Line A\n...\n    while (true)\n    {\n        displayBarPort = 0b00000011;         // Line B: pattern 1 (0x03)\n        thread_sleep_for(WAIT_TIME_MS);      // Line C\n        displayBarPort = 0b00110000;         // Line D: pattern 2 (0x30)\n        thread_sleep_for(WAIT_TIME_MS);      // Line E\n    }',
  p1b: 'DigitalIn sw_PB12(PB_12);               // PB_12 as input\n...\n    while (true)\n    {\n        if (sw_PB12.read() == 0)             // switch pushed up\n            displayBarPort = 0x33;           // 00110011\n        else\n            displayBarPort = 0x00;           // all off\n    }',
  p1c: '    while (true)\n    {\n        if (sw_PD2 == 0 && sw_PA4 == 0)            // Line A\n            displayBarPort = 0x00;                 // Line B: all OFF\n        else if (sw_PD2 == 1 && sw_PA4 == 0)       // Line C\n            displayBarPort = 0x03;                 // Line D: pattern 1\n        else if (sw_PD2 == 0 && sw_PA4 == 1)       // Line E\n            displayBarPort = 0x30;                 // Line F: pattern 2\n        else\n            displayBarPort = 0xFF;                 // Line G: all ON\n    }',
  p2: '#define WAIT_TIME_MS 5                        // Line A: short delay\n...\n    while (true)\n    {\n        sevenSegmentDIG = 0b00000100;          // Line B: enable DIG2\n        sevenSegmentPort = 0x06;               // Line C: \'1\'\n        thread_sleep_for(WAIT_TIME_MS);        // Line D\n\n        sevenSegmentDIG = 0b00000010;          // Line E: enable DIG1\n        sevenSegmentPort = 0x5B;               // Line F: \'2\'\n        thread_sleep_for(WAIT_TIME_MS);        // Line G\n\n        sevenSegmentDIG = 0b00000001;          // Line H: enable DIG0\n        sevenSegmentPort = 0x4F;               // Line I: \'3\'\n        thread_sleep_for(WAIT_TIME_MS);        // Line J\n    }   // DIG3 is never enabled, so it stays off',
  p3: 'char msg1[] = "Press 1 :";\nchar msg2[] = "Bye....";\nchar wait[] = " waiting....";\n\nvoid lcd_print(char s[])\n{\n    for (int i = 0; s[i] != \'\\0\'; i++)\n        lcd_write_data(s[i]);\n}\n\nint main( )\n{\n    lcd_init();\n    lcd_write_cmd(0x80);              // line 1\n    lcd_print(msg1);\n    lcd_write_cmd(0xC0);              // line 2\n\n    do {\n        key = getkey();               // waits for a key\n    } while (key != \'1\');\n\n    for (int n = 4; n >= 1; n--)      // count-down\n    {\n        lcd_write_cmd(0xC0);\n        lcd_write_data(\'0\' + n);\n        lcd_print(wait);\n        thread_sleep_for(1000);\n    }\n    lcd_write_cmd(0x01);              // clear\n    thread_sleep_for(20);\n    lcd_write_cmd(0x80);\n    lcd_print(msg2);\n    while (1);                        // stop\n}',
  drill: 'DigitalIn button(PC_13);\n...\n    int n = 4;\n    while (n >= 1)\n    {\n        lcd_write_cmd(0xC0);\n        lcd_write_data(\'0\' + n);\n        lcd_print(wait);\n\n        bool restart = false;\n        for (int t = 0; t < 100; t++)     // 100 x 10 ms = 1 s\n        {\n            thread_sleep_for(10);\n            if (button.read() == 0) { restart = true; break; }\n        }\n        if (restart) {\n            while (button.read() == 0);   // wait for release\n            n = 4;                        // start again from 4\n        }\n        else n--;\n    }',
};
const PARTS = [
  { id: 'p1', tab: 'Part 1', title: 'Part 1 \u2013 LED bar & DIP switches (40 marks)', main: 'BlinkLeds.cpp', utils: [],
    intro: 'Open the template project, remove main.cpp, copy BlinkLeds.cpp from "MAPP Lab" into the NUCLEO_F103RB folder, add it to the project, then modify it. PB_12 is an input; Port C (PC7:PC0) drives the LED bar.',
    tasks: [
      { id: 'p1a', title: '1) Alternate Pattern 1 (00000011) and Pattern 2 (00110000) every 500 ms', hint: 'Set WAIT_TIME_MS to 500 and write the two patterns (0x03, 0x30) to displayBarPort with a delay after each.' },
      { id: 'p1b', title: '2) PB12 pushed up (input 0) \u2192 00110011, otherwise all LEDs off', hint: 'Declare DigitalIn for PB_12 and use if/else inside the while loop. Remove the delays/patterns from step 1.' },
      { id: 'p1c', title: '3) Truth table: PD2/PA4 = 00 off, 10 pattern 1, 01 pattern 2, 11 all on', hint: 'Use if / else if / else if / else with both switches. ON (pushed up) reads 0, OFF reads 1.' }] },
  { id: 'p2', tab: 'Part 2', title: 'Part 2 \u2013 Four 7-segment displays (20 marks)', main: 'Four7seg.cpp', utils: [],
    intro: 'Replace the source file with Four7Seg.cpp (remove BlinkLeds.cpp from the project, copy Four7seg.cpp to the project folder and add it). Show "-123" on DIG3..DIG0 ( - = that digit OFF ).',
    tasks: [{ id: 'p2', title: 'Show "-123" steadily on the 4 digits', hint: 'Multiplex: enable one digit (sevenSegmentDIG), output its segment code (sevenSegmentPort), short delay; repeat for DIG2 (1 = 0x06), DIG1 (2 = 0x5B), DIG0 (3 = 0x4F). Use a few ms delay so it does not flicker.' }] },
  { id: 'p3', tab: 'Part 3', title: 'Part 3 \u2013 LCD & keypad (40 marks)', main: 'LCDKeypad.cpp', utils: ['lcd.h', 'lcd_utilities.cpp', 'keypad.h', 'keypad_utilities.cpp'],
    intro: 'Replace the source file with LCDKeypad.cpp, and copy lcd.h, lcd_utilities.cpp, keypad.h, keypad_utilities.cpp from "MAPP Lab\\Utilities" to the project folder (add the two .cpp files to the project).',
    tasks: [
      { id: 'p3a', title: 'a) "Press 1" on line 1, wait for \'1\' (ignore other keys), then "Bye...." on line 2 and stop', hint: 'Loop on getkey() until it returns \'1\'. Then lcd_write_cmd(0xC0) and write the characters of "Bye....". End with while (1);' },
      { id: 'p3b', title: 'b) After \'1\': "4 waiting...." \u2192 "3 \u2026" \u2192 "2 \u2026" \u2192 "1 \u2026" (1 s each), clear, "Bye...." on line 1, stop', hint: 'for (n = 4; n >= 1; n--) { move to line 2; write \'0\'+n and " waiting...."; thread_sleep_for(1000); } then lcd_write_cmd(0x01) and write "Bye...." on line 1.' }] },
  { id: 'drill', tab: 'Challenge', title: 'Challenging drill \u2013 PC13 restarts the count-down', main: 'LCDKeypad.cpp', utils: ['lcd.h', 'lcd_utilities.cpp', 'keypad.h', 'keypad_utilities.cpp'],
    intro: 'Pressing PC13 at any time before "Bye...." restarts the count-down from 4.',
    tasks: [{ id: 'drill', title: 'PC13 during the count-down restarts it at "4 waiting...."', hint: 'Split the 1 s delay into 100 \u00d7 10 ms and check PC13 (DigitalIn, pressed = 0) each time; if pressed, set the counter back to 4.' }] },
];

/* ---------------- procedure checks ---------------- */
function procChecks(part) {
  const uv = G.UV, vfs = G.App.vfs, proj = uv.proj;
  const out = [];
  const files = proj ? uv.userGroups().flatMap(g => g.files.map(f => ({ f, path: uv.filePath(f) }))) : [];
  const inProj = name => files.find(x => VFS.basename(x.path).toLowerCase() === name.toLowerCase());
  out.push({ ok: !!proj, label: 'Open NUCLEO_F103RB.uvprojx in \u00b5Vision', hint: 'File Explorer \u2192 D:\\MAPP Programs\\NUCLEO_F103RB \u2192 double-click NUCLEO_F103RB.uvprojx' });
  const mainIn = files.some(x => VFS.basename(x.path).toLowerCase() === 'main.cpp');
  out.push({ ok: !!proj && !mainIn, label: 'main.cpp removed from the project', hint: 'Project window: right-click main.cpp \u2192 Remove File \'main.cpp\'' });
  const names = [part.main].concat(part.utils);
  for (const n of names) {
    const copied = proj && vfs.exists(VFS.join(proj.dir, n));
    out.push({ ok: !!copied, label: n + ' copied into the project folder', hint: 'File Explorer: copy it from MAPP Lab' + (part.utils.includes(n) ? '\\Utilities' : '') + ' and paste into ' + (proj ? VFS.basename(proj.dir) : 'NUCLEO_F103RB') });
    if (/\.cpp$/i.test(n)) {
      const x = inProj(n);
      const fromLab = x && !VFS.same(VFS.dirname(x.path), proj.dir);
      out.push({ ok: !!x && !fromLab, warn: fromLab, label: n + ' added to the project' + (fromLab ? ' \u2013 but from the wrong folder (' + VFS.dirname(x.path) + ')' : ''), hint: fromLab ? 'Remove it and add the copy that is inside the project folder, otherwise you are editing the original sample.' : 'Right-click group NUCLEO_F103RB \u2192 Add Existing Files to Group\u2026' });
    }
  }
  const otherSrc = files.filter(x => /\.(c|cpp)$/i.test(x.path) && !names.some(n => n.toLowerCase() === VFS.basename(x.path).toLowerCase()));
  if (otherSrc.length) out.push({ ok: false, warn: true, label: 'Other source files still in the project: ' + otherSrc.map(x => VFS.basename(x.path)).join(', '), hint: 'Each lab program has its own main(). Remove the previous program file (e.g. BlinkLeds.cpp) or the build fails with L6200E "Symbol main multiply defined".' });
  const lb = uv.lastBuild;
  let stale = false;
  if (lb && lb.ok && lb.sources) {
    for (const s of lb.sources) if (vfs.read(s.path) !== s.text) stale = true;
    if (uv.tabs.some(t => uv.dirty(t) && lb.sources.some(s => VFS.same(s.path, t.path)))) stale = true;
    const cur = uv.sources().map(s => s.path.toLowerCase()).sort().join('|');
    if (cur !== lb.sources.map(s => s.path.toLowerCase()).sort().join('|')) stale = true;
  }
  out.push({ ok: !!(lb && lb.ok && !stale), warn: !!(lb && lb.ok && stale), label: 'Build Target (F7): 0 Error(s)' + (lb && lb.ok && stale ? ' \u2013 but you changed the code since the last build' : lb && !lb.ok ? ' \u2013 last build failed' : ''), hint: 'Project \u2192 Build Target (F7). Read the Build Output; double-click an error to jump to the line.' });
  const fs = G.App.flashSnap;
  const dl = !!(fs && lb && lb.ok && lb.sources && fs.sources && fs.sources.length === lb.sources.length && fs.sources.every((s, i) => s.text === lb.sources[i].text));
  out.push({ ok: dl && !stale, label: 'Flash \u2192 Download (F8): latest build is on the board', hint: 'After a successful build: Flash \u2192 Download. The board restarts with the new program.' });
  return out;
}

/* ---------------- window ---------------- */
const Coach = {
  w: null, tab: 'p1', results: {}, timer: null, testEnd: null,
  open(tab) {
    if (tab) this.tab = tab;
    if (this.w) { this.w.restore(); this.w.focus(); this.render(); return; }
    const dh = WM.desk.clientHeight, dw = WM.desk.clientWidth;
    this.w = WM.open('coach', { title: 'Lab Test Practice \u2013 ET1010 MAPP', icon: I.lab, w: 600, h: Math.min(dh - 40, 640), x: Math.max(10, Math.min(dw - 1170, 470)), y: Math.max(10, dh - Math.min(dh - 40, 640) - 10), cls: 'coachwin', onClosed: () => { this.w = null; clearInterval(this.timer); } });
    try { this.results = JSON.parse(localStorage.getItem('mappsim.results') || '{}'); } catch (e) { }
    this.render();
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (this.w && !this.w.minimized) this.refreshProc(); this.tickClock(); }, 1000);
  },
  render() {
    if (!this.w) return;
    const tabs = h('div.co-tabs');
    PARTS.forEach(p => tabs.append(h('button.co-tab' + (this.tab === p.id ? '.on' : ''), { onclick: () => { this.tab = p.id; this.render(); } }, h('span', { html: this.partDone(p) ? I.ok : '' }), p.tab)));
    tabs.append(h('button.co-tab' + (this.tab === 'help' ? '.on' : ''), { text: 'How to use', onclick: () => { this.tab = 'help'; this.render(); } }));
    this.clockEl = h('span.co-clock');
    const timerBtn = h('button.btn.sm', { text: this.testEnd ? 'Stop timer' : 'Start 50-min timer', onclick: () => { this.testEnd = this.testEnd ? null : Date.now() + 50 * 60000; this.render(); } });
    const head = h('div.co-head', null, tabs, h('div.co-timer', null, this.clockEl, timerBtn));
    const body = h('div.co-body');
    if (this.tab === 'help') body.append(this.helpView());
    else body.append(this.partView(PARTS.find(p => p.id === this.tab)));
    this.w.body.innerHTML = '';
    this.w.body.append(h('div.co', null, head, body));
    this.tickClock();
  },
  partDone(p) { return p.tasks.every(t => this.results[t.id] && this.results[t.id].ok); },
  tickClock() {
    if (!this.clockEl) return;
    if (!this.testEnd) { this.clockEl.textContent = ''; return; }
    const ms = this.testEnd - Date.now();
    if (ms <= 0) { this.clockEl.textContent = 'Time is up!'; this.clockEl.classList.add('late'); return; }
    this.clockEl.textContent = '\u23F1 ' + Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + ' left';
  },
  partView(p) {
    this.procEl = h('div.co-proc');
    this.curPart = p;
    const wrap = h('div', null, h('h2', { text: p.title }), h('p.co-intro', { text: p.intro }), h('h3', { text: 'Procedure (checked automatically)' }), this.procEl, h('h3', { text: 'Demonstrate to the "lecturer"' }));
    this.refreshProc();
    for (const t of p.tasks) {
      const res = h('div.co-res');
      const r = this.results[t.id];
      if (r) this.paintRes(res, r);
      const btn = h('button.btn.primary.sm', { text: '\u25B6 Check on board' });
      btn.onclick = () => this.runTest(t, res, btn);
      const hint = h('details.co-more', null, h('summary', { text: 'Hint' }), h('div', { text: t.hint }));
      const sol = SOL[t.id] || (t.id === 'p3a' || t.id === 'p3b' ? SOL.p3 : null);
      const solEl = sol ? h('details.co-more', null, h('summary', { text: 'Model answer (try first!)' }), h('pre.co-code', { text: sol })) : null;
      wrap.append(h('div.co-task', null, h('div.co-ttitle', null, h('span.co-ticon', { html: r ? (r.ok ? I.ok : I.fail) : I.pending }), h('span', { text: t.title })), h('div.co-trow', null, btn, h('span.co-note', { text: 'Runs the program that is currently downloaded on the board, presses the switches/keys for you and watches the outputs.' })), res, hint, solEl));
    }
    return wrap;
  },
  refreshProc() {
    if (!this.procEl || !this.curPart || this.tab === 'help') return;
    const checks = procChecks(this.curPart);
    const html = checks.map(c => '<div class="co-pi ' + (c.ok ? 'ok' : c.warn ? 'warn' : 'todo') + '"><span>' + (c.ok ? I.ok : c.warn ? I.warnT : I.pending) + '</span><div><div>' + escH(c.label) + '</div>' + (c.ok ? '' : '<div class="co-ph">' + escH(c.hint) + '</div>') + '</div></div>').join('');
    if (this.procEl.innerHTML !== html) this.procEl.innerHTML = html;
  },
  async runTest(t, res, btn) {
    const img = G.App.flashImage;
    res.innerHTML = '';
    if (!img) { this.paintRes(res, { ok: false, msg: 'There is no program on the board. Build (F7) and Flash \u2192 Download (F8) first.' }); return; }
    btn.disabled = true; btn.textContent = 'Testing\u2026';
    await new Promise(r => setTimeout(r, 30));
    let r;
    try { r = { ok: true, msg: TESTS[t.id](img) }; }
    catch (e) { r = { ok: false, msg: e instanceof Fail ? e.message : 'Test error: ' + e.message }; if (!(e instanceof Fail)) console.error(e); }
    r.prog = G.App.flashInfo; r.time = Date.now();
    const lb = G.UV.lastBuild;
    if (r.ok && G.App.flashSnap && lb && lb.sources && !(G.App.flashSnap.sources || []).every((s, i) => lb.sources[i] && s.text === lb.sources[i].text)) r.msg += '\n(Note: the board is running an older build than your latest one \u2013 Download again.)';
    this.results[t.id] = r;
    try { localStorage.setItem('mappsim.results', JSON.stringify(this.results)); } catch (e) { }
    btn.disabled = false; btn.textContent = '\u25B6 Check on board';
    this.render();
  },
  paintRes(el, r) {
    el.className = 'co-res ' + (r.ok ? 'ok' : 'bad');
    el.innerHTML = '';
    el.append(h('div.co-rh', { html: (r.ok ? I.ok + ' <b>Correct</b>' : I.fail + ' <b>Not yet</b>') + (r.prog ? ' <span class="co-rp">tested: ' + escH(r.prog) + '</span>' : '') }), h('pre.co-rm', { text: r.msg }));
  },
  helpView() {
    return h('div.co-help', { html: `
<h2>How this simulator works</h2>
<p>This is a practice copy of the lab PC: <b>File Explorer</b>, <b>Keil \u00b5Vision 5</b>, <b>Tera Term</b> and the <b>MAPP Experiment Board</b>. Do every step exactly as in the lab:</p>
<ol>
<li><b>File Explorer</b> \u2192 <code>D:\\MAPP Programs\\NUCLEO_F103RB</code> \u2192 double-click <code>NUCLEO_F103RB.uvprojx</code>.</li>
<li>In \u00b5Vision expand the group <b>NUCLEO_F103RB</b>, right-click <code>main.cpp</code> \u2192 <b>Remove File 'main.cpp'</b> (close its editor tab too).</li>
<li>In File Explorer open <code>MAPP Lab</code>, select the sample (e.g. <code>BlinkLeds.cpp</code>), <b>Ctrl+C</b>, go to <code>NUCLEO_F103RB</code>, <b>Ctrl+V</b>. For LCD/keypad also copy the files from <code>MAPP Lab\\Utilities</code>.</li>
<li>In \u00b5Vision right-click the group \u2192 <b>Add Existing Files to Group 'NUCLEO_F103RB'\u2026</b> \u2192 pick the copied .cpp file(s) \u2192 <b>Add</b> \u2192 <b>Close</b>.</li>
<li>Double-click the file to edit it. <b>F7</b> = Build Target. Double-click an error in Build Output to jump to that line.</li>
<li><b>F8</b> = Flash \u2192 Download. The board restarts with your program. Use the DIP switches, buttons and keypad on the board.</li>
<li>Open a Part tab here and press <b>Check on board</b> \u2013 the "lecturer" runs your downloaded program, flips the switches / presses keys and tells you exactly what is right or wrong.</li>
</ol>
<h3>Board controls</h3>
<ul>
<li><b>DIP switches</b> (PB12, PA4, PD2): click to toggle. Up = ON = reads <b>0</b>.</li>
<li><b>Buttons</b> (B1/PC13, PC12, PA15): hold the mouse down to press. Right-click latches a button down.</li>
<li><b>Keypad</b>: click the keys, or type 0\u20139 / A\u2013F while the board window is focused.</li>
<li><b>Slow-mo</b> lets you watch 7-segment multiplexing digit by digit. <b>RESET</b> restarts the program; Tera Term shows printf() output.</li>
<li>Unticking <b>USB</b> unplugs the board (try what \u00b5Vision says when you Download!).</li>
</ul>
<h3>What is simulated</h3>
<p>Your code is really compiled (C/C++ subset of Arm Compiler 6 with the same kind of error messages, include-file lookup and linker errors such as <i>L6218E Undefined symbol</i> and <i>L6200E multiply defined</i>), then run against a pin-level model of the STM32F103RB and the MAPP boards: the LCD is a real HD44780 controller driven by your <code>lcd_utilities.cpp</code> bit by bit, the keypad is a 74C922 encoder, and the 7-segment display uses persistence of vision.</p>
<p><b>Limits:</b> register-level code (RCC/EXTI/TIM registers) compiles but the peripherals are not simulated; UART (BufferedSerial), the debugger, structs/classes and dynamic memory are not supported.</p>
<p>The desktop <b>MAPP</b> icon restores fresh copies of all files, just like the lab PCs.</p>` });
  },
};
function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

G.Coach = Coach; G.CoachTests = TESTS; G.CoachHarness = harness;
})(window);
