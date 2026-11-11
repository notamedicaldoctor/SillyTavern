// Black-box benchmark: starts SillyTavern against a synthetic data root, runs scenarios,
// and records request latency plus a "stall probe" (latency of a trivial endpoint while
// a heavy request is in flight) and server event-loop delay.
//
// Usage: node bench/run.mjs --data <synthetic-data-root> [--label baseline] [--port 8130]
//        [--reps 3] [--out bench/results/<label>.json] [--only a,b,c]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
if (!args.data) { console.error('--data <dir> is required'); process.exit(1); }
const DATA = path.resolve(String(args.data));
const PORT = Number(args.port ?? 8130);
const REPS = Number(args.reps ?? 3);
const LABEL = String(args.label ?? 'run');
const ONLY = args.only ? String(args.only).split(',') : null;
const BASE = `http://127.0.0.1:${PORT}`;
const eldFile = path.join(os.tmpdir(), `st-bench-eld-${process.pid}.json`);

const first = fs.readdirSync(path.join(DATA, 'default-user/characters')).filter(f => f.endsWith('.png')).sort()[0];
const charName = first.replace('.png', '');
const chatDir = path.join(DATA, 'default-user/chats', charName);
const chatFile = fs.readdirSync(chatDir).sort()[0].replace('.jsonl', '');
const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const server = spawn(process.execPath, ['--import', path.join(root, 'bench/eld-preload.mjs'), 'server.js', '--port', String(PORT), '--dataRoot', DATA, '--disableCsrf', '--listen=false'], {
    cwd: root, env: { ...process.env, BENCH_ELD_OUT: eldFile }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const results = { label: LABEL, node: process.version, data: DATA, startedAt: new Date().toISOString(), scenarios: {} };

try {
    await waitForServer();
    const bigChat = await (await post('/api/chats/get', { avatar_url: first, file_name: chatFile })).json();
    results.fixture = { characters: fs.readdirSync(path.join(DATA, 'default-user/characters')).length, bigChatMessages: bigChat.length, bigChatMB: +(JSON.stringify(bigChat).length / 1048576).toFixed(1) };

    const scenarios = {
        idle: async () => { await sleep(1500); return 0; },
        characters_all: async () => bytes(await post('/api/characters/all')),
        chats_recent: async () => bytes(await post('/api/chats/recent', { max: 20 })),
        chats_recent_unbounded: async () => bytes(await post('/api/chats/recent', {})),
        character_chats: async () => bytes(await post('/api/characters/chats', { avatar_url: first })),
        chat_get_big: async () => bytes(await post('/api/chats/get', { avatar_url: first, file_name: chatFile })),
        chat_save_big: async () => bytes(await post('/api/chats/save', { avatar_url: first, file_name: chatFile, chat: bigChat, force: true })),
        chat_search: async () => bytes(await post('/api/chats/search', { query: 'zzzz-no-such-word', avatar_url: first })),
        groups_all: async () => bytes(await post('/api/groups/all')),
    };

    for (const [name, fn] of Object.entries(scenarios)) {
        if (ONLY && !ONLY.includes(name)) continue;
        const runs = [];
        for (let i = 0; i < (name === 'idle' ? 1 : REPS); i++) runs.push(await measure(fn));
        // Report the first run separately: it is the cold-cache case.
        results.scenarios[name] = { cold: runs[0], warmMedian: median(runs.slice(1).length ? runs.slice(1) : runs) };
        console.log(fmt(name, results.scenarios[name]));
    }
} finally {
    server.kill('SIGTERM');
    await new Promise(r => server.once('exit', r));
    if (fs.existsSync(eldFile)) { results.serverEventLoopDelayMs = JSON.parse(fs.readFileSync(eldFile, 'utf8')); fs.unlinkSync(eldFile); }
}

const outFile = path.resolve(String(args.out ?? path.join(root, 'bench/results', `${LABEL}.json`)));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`\nserver event-loop delay (ms, whole run): ${JSON.stringify(results.serverEventLoopDelayMs)}\nwrote ${outFile}`);

async function measure(fn) {
    const lat = [];
    let stop = false;
    const probe = (async () => {
        while (!stop) {
            const t = performance.now();
            try { await post('/api/ping'); } catch { /* ignore */ }
            lat.push(performance.now() - t);
            await sleep(20);
        }
    })();
    const t0 = performance.now();
    const size = await fn();
    const ms = performance.now() - t0;
    stop = true;
    await probe;
    lat.sort((a, b) => a - b);
    const q = (p) => lat.length ? +lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(1) : null;
    return { ms: +ms.toFixed(1), responseKB: Math.round(size / 1024), probe: { n: lat.length, p50: q(0.5), p99: q(0.99), max: q(1) } };
}
function median(runs) {
    const m = (f) => [...runs].map(f).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    return { ms: m(r => r.ms), responseKB: runs[0].responseKB, probe: { p50: m(r => r.probe.p50), p99: m(r => r.probe.p99), max: m(r => r.probe.max) } };
}
function fmt(name, r) {
    const f = (x) => `${String(x.ms).padStart(8)} ms  ${String(x.responseKB).padStart(7)} KB  stall p99/max ${x.probe.p99}/${x.probe.max} ms`;
    return `${name.padEnd(24)} cold ${f(r.cold)}\n${''.padEnd(24)} warm ${f(r.warmMedian)}`;
}
async function bytes(res) { return (await res.arrayBuffer()).byteLength; }
async function waitForServer() {
    for (let i = 0; i < 120; i++) {
        try { if ((await fetch(BASE + '/version')).ok) return; } catch { /* not up yet */ }
        if (server.exitCode !== null) throw new Error('server exited early:\n' + serverLog.slice(-2000));
        await sleep(500);
    }
    throw new Error('server did not start:\n' + serverLog.slice(-2000));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function parseArgs(argv) {
    const o = {};
    for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    return o;
}
