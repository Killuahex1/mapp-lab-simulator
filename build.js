// node build.js <path-to-extracted "MAPP Programs">
// Bundles src/* + the MAPP sample files into one self-contained "MAPP Lab Simulator.html"
const fs = require('fs'), path = require('path');
const root = __dirname, src = path.join(root, 'src');
const mapp = process.argv[2];
if (!mapp || !fs.existsSync(mapp)) { console.error('usage: node build.js <MAPP Programs folder>'); process.exit(1); }

const files = {};
const add = (rel, abs) => { files[rel.split('/').join('\\')] = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'); };
const lab = path.join(mapp, 'MAPP Lab');
for (const f of fs.readdirSync(lab)) { const p = path.join(lab, f); if (fs.statSync(p).isFile()) add('MAPP Lab/' + f, p); }
for (const f of fs.readdirSync(path.join(lab, 'Utilities'))) add('MAPP Lab/Utilities/' + f, path.join(lab, 'Utilities', f));
const tpl = path.join(mapp, 'NUCLEO_F103RB');
for (const f of ['main.cpp', 'mbed_config.h', 'README.md', 'LICENSE', 'CMakeLists.txt', 'mbed_app.json', 'mbed-os.lib', '.mbed', 'CONTRIBUTING.md', 'GettingStarted.html']) {
  if (fs.existsSync(path.join(tpl, f))) add('NUCLEO_F103RB/' + f, path.join(tpl, f));
}
files['NUCLEO_F103RB\\NUCLEO_F103RB.uvoptx'] = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<ProjectOpt xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project_optx.xsd">\n  <SchemaVersion>1.0</SchemaVersion>\n  <Header>### uVision Project, (C) Keil Software</Header>\n  <!-- debugger / window options (simulated) -->\n</ProjectOpt>\n';
files['NUCLEO_F103RB\\NUCLEO_F103RB.uvguix.common'] = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<ProjectGui xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project_guix.xsd">\n  <!-- window layout (simulated) -->\n</ProjectGui>\n';

const safe = s => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const filesJs = 'window.MAPP_FILES = ' + safe(JSON.stringify(files)) + ';\n';
fs.writeFileSync(path.join(src, 'files.js'), filesJs);

const order = ['files.js', 'engine.js', 'runtime.js', 'vfs.js', 'ui-core.js', 'explorer.js', 'uvision.js', 'board.js', 'coach.js', 'main.js'];
const css = fs.readFileSync(path.join(src, 'style.css'), 'utf8');
let js = '';
for (const f of order) js += '\n/* ===== ' + f + ' ===== */\n' + (f === 'files.js' ? filesJs : safe(fs.readFileSync(path.join(src, f), 'utf8')));
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MAPP Lab Simulator</title>
<meta name="description" content="ET1010 MAPP lab PC simulator: File Explorer, Keil uVision 5 look-alike, and a simulated MAPP Experiment Board (STM32 NUCLEO-F103RB).">
<style>
${css}
</style>
</head>
<body>
<noscript>This simulator needs JavaScript.</noscript>
<script>
${js}
</script>
</body>
</html>
`;
const out = path.join(root, 'MAPP Lab Simulator.html');
fs.writeFileSync(out, html);
fs.writeFileSync(path.join(root, 'index.html'), html); // GitHub Pages entry point
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB,', Object.keys(files).length, 'sample files');
