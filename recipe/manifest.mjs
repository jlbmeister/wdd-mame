// Writes manifest.json for a MAME build folder (run by build.sh after the build):
//   { version, mameTag, mameCommit, emscripten, built, buildSeconds, jobs,
//     drivers: [source files from drivers.txt], systems: [MAME system names in the build],
//     parents, bios, devices, romless (from systems.mjs: what a system needs besides its own zip),
//     files: [{ name, bytes, sha256 }] }
// W.D.D's server checks every file against it (server/mame/index.js).
//   node manifest.mjs DIR --version V --tag T --commit C --emcc E --filter drivers.txt --drivlist drivlist.cpp
//     --systems systems.json --seconds S --jobs J
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const main = process.argv[1] === fileURLToPath(import.meta.url);
const [dir, ...rest] = main ? process.argv.slice(2) : [];
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];

// "src.cpp   // comment" lines; // and /* */ comments; +name / -name lines are single systems
export const filterSources = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/\/\/.*$/, '').trim()).filter((l) => l && !/^[+\-#]/.test(l));

// MAME's generated drivlist.cpp names each system once as GAME_NAME(x) (driver_x)
function systems(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const names = new Set();
  for (const m of text.matchAll(/GAME_NAME\((\w+)\)|\bdriver_(\w+)\b/g)) names.add(m[1] || m[2]);
  names.delete('___empty');
  names.delete('list'); // driver_list, the class
  return [...names].sort();
}

if (main) {
  const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
  
  const files = walk(dir).filter((n) => n !== 'manifest.json').sort().map((name) => {
    const buf = fs.readFileSync(path.join(dir, name));
    return { name, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  });
  
  // MAME's own account of the systems (systems.mjs), when it could be made
  let rel = {};
  try { const j = JSON.parse(fs.readFileSync(opt.systems, 'utf8')); rel = { systems: j.systems, parents: j.parents, bios: j.bios, devices: j.devices, romless: j.romless }; } catch { /* drivlist names only */ }
  const manifest = {
    version: opt.version,
    mameTag: opt.tag,
    mameCommit: opt.commit,
    emscripten: opt.emcc,
    features: ['wasm', 'simd128', 'pthreads', 'webgl2-bgfx'],
    built: new Date().toISOString(),
    buildSeconds: Number(opt.seconds) || null,
    jobs: Number(opt.jobs) || null,
    drivers: opt.filter ? filterSources(fs.readFileSync(opt.filter, 'utf8')) : [],
    ...rel,
    // every name in MAME's driver list, even one systems.mjs couldn't describe
    systems: [...new Set([...(rel.systems || []), ...(opt.drivlist ? systems(opt.drivlist) : [])])].sort(),
    files,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = files.reduce((s, f) => s + f.bytes, 0);
  console.log(`manifest: ${files.length} files, ${(total / 1e6).toFixed(1)} MB, ${manifest.systems.length} systems from ${manifest.drivers.length} driver files`);
}
