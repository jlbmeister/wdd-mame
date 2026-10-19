// What each system in a MAME build needs besides its own zip, from MAME itself: runs the built
// mame.js under Node with -listxml, a driver source file's systems at a time (listing everything at
// once stops on a device that throws) and reads clone, BIOS and device ROM relations. build.sh runs it; manifest.mjs adds the result.
//   node systems.mjs BUILD_DIR drivers.txt > systems.json   (BUILD_DIR has mame.js and mame.wasm)
//
// Result (also the manifest fields, see README.md):
//   systems:  [name]                    every runnable system, sorted
//   parents:  { clone: parent }          a clone's parent set (its zip holds the shared ROMs)
//   bios:     { system: biosSet }        the BIOS set a system boots from (neogeo, …), for clones too
//   devices:  { system: [set] }          ROM sets of devices in the system (qsound, …), each its own zip
//   romless:  [name]                     systems that need no ROM files at all (software only)
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import { filterSources } from './manifest.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? m[1] : null; };

/** Machines from -listxml text: { name: { cloneof, romof, isbios, isdevice, runnable, roms: n, devices: [names] } } */
export function parseListXml(xml) {
  const out = {};
  const re = /<machine\s[^>]*\/>|<machine\s[^>]*[^/]>[\s\S]*?<\/machine>/g;
  for (const m of xml.matchAll(re)) {
    const body = m[0];
    const tag = /^<machine\s[^>]*>/.exec(body)[0];
    const name = attr(tag, 'name');
    if (!name) continue;
    let roms = 0;
    for (const r of body.matchAll(/<rom\s[^>]*>/g)) {
      // a ROM that's optional or was never dumped isn't looked for in a zip
      if (attr(r[0], 'optional') === 'yes' || attr(r[0], 'status') === 'nodump') continue;
      roms++;
    }
    out[name] = {
      cloneof: attr(tag, 'cloneof'), romof: attr(tag, 'romof'),
      isbios: attr(tag, 'isbios') === 'yes', isdevice: attr(tag, 'isdevice') === 'yes',
      runnable: attr(tag, 'runnable') !== 'no',
      roms,
      devices: [...new Set([...body.matchAll(/<device_ref\s[^>]*>/g)].map((d) => attr(d[0], 'name')).filter(Boolean))],
    };
  }
  return out;
}

/** The relations the widget needs, from parsed machines. */
export function relations(machines) {
  const systems = Object.keys(machines).filter((n) => !machines[n].isdevice && machines[n].runnable).sort();
  const parents = {}, bios = {}, devices = {}, romless = [];
  const biosOf = (name) => {
    // follow romof (clone → parent → BIOS) to a machine marked isbios
    const seen = new Set();
    for (let n = machines[name]?.romof; n && !seen.has(n); n = machines[n]?.romof) {
      seen.add(n);
      if (machines[n]?.isbios) return n;
    }
    return null;
  };
  for (const s of systems) {
    const m = machines[s];
    if (m.cloneof) parents[s] = m.cloneof;
    const b = biosOf(s);
    if (b) bios[s] = b;
    const d = m.devices.filter((x) => machines[x]?.isdevice && machines[x].roms > 0).sort();
    if (d.length) devices[s] = d;
    if (!m.roms && !m.cloneof && !b && !d.length) romless.push(s);
  }
  return { systems, parents, bios, devices, romless };
}

let seq = 0;
/** Run mame.js under Node. Its output goes to a file, not a pipe: Emscripten exits the process before
 *  a pipe has been drained, which cut long listings short (Node 22). */
function run(dir, args) {
  const file = path.join(os.tmpdir(), `wdd-mame-list-${process.pid}-${++seq}.txt`);
  const fd = fs.openSync(file, 'w');
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(dir, 'mame.js'), ...args], { cwd: dir, stdio: ['ignore', fd, 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const t = setTimeout(() => p.kill(), 10 * 60e3);
    p.on('close', (code, signal) => {
      clearTimeout(t);
      fs.closeSync(fd);
      let out = '';
      try { out = fs.readFileSync(file, 'utf8'); } catch { /* none */ }
      fs.rmSync(file, { force: true });
      resolve({ ok: code === 0, out, err: code === 0 ? '' : `${code ?? signal} ${err.trim().split('\n').slice(-2).join(' ')}` });
    });
  });
}

/**
 * -listxml every system of the build, grouped by driver source file (two files at once); a group
 * MAME can't list is split in halves down to single systems.
 */
export async function listBuild(dir, sources, { log = () => {}, parallel = 2 } = {}) {
  // -listsource: "name   path/file.cpp" for every system and device
  const bySource = new Map(sources.map((src) => [src, []]));
  for (const line of (await run(dir, ['-listsource'])).out.split('\n')) {
    const [name, src] = line.trim().split(/\s+/);
    if (bySource.has(src) && /^\w+$/.test(name)) bySource.get(src).push(name);
  }
  const machines = {};
  const failed = [];
  const complete = (r) => r.ok && /<\/mame>\s*$/.test(r.out);
  const list = async (names) => {
    if (!names.length) return;
    const r = await run(dir, ['-listxml', ...names]);
    if (complete(r)) { Object.assign(machines, parseListXml(r.out)); return; }
    if (names.length === 1) { failed.push(names[0]); log(`could not list ${names[0]}: ${r.err.slice(0, 200)}`); return; }
    log(`${names.length} systems from ${names[0]} on: ${r.err.slice(0, 200) || 'incomplete listing'}; splitting`);
    const half = Math.ceil(names.length / 2);
    await list(names.slice(0, half));
    await list(names.slice(half));
  };
  const queue = [...bySource.values()];
  let done = 0;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (queue.length) { await list(queue.shift()); log(`listed ${++done}/${bySource.size} driver files`); }
  }));
  // MAME runs out of breath with several listings at once on a small machine: what failed gets
  // one more try, alone
  const retry = failed.splice(0);
  for (const n of retry) await list([n]);
  if (retry.length) log(`retried ${retry.length} alone, ${failed.length} still failed`);
  return { machines, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || '.');
  const sources = filterSources(fs.readFileSync(process.argv[3], 'utf8'));
  const { machines, failed } = await listBuild(dir, sources, { log: (s) => process.stderr.write(`${s}\n`) });
  const rel = relations(machines);
  // a system MAME couldn't describe is still in the build
  for (const n of failed) if (!rel.systems.includes(n)) rel.systems.push(n);
  rel.systems.sort();
  if (failed.length) process.stderr.write(`could not list ${failed.length}: ${failed.join(' ')}\n`);
  process.stdout.write(JSON.stringify({ ...rel, unlisted: failed }));
}
