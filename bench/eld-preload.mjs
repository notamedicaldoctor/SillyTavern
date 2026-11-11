// Preload for the server process: records event-loop delay and writes a summary on exit.
// Usage: node --import ./bench/eld-preload.mjs server.js   (BENCH_ELD_OUT=<file> to set the output path)
import { monitorEventLoopDelay } from 'node:perf_hooks';
import fs from 'node:fs';

const h = monitorEventLoopDelay({ resolution: 5 });
h.enable();
const out = process.env.BENCH_ELD_OUT;
let written = false;
const dump = () => {
    if (written || !out) return;
    written = true;
    const ms = (n) => +(n / 1e6).toFixed(2);
    fs.writeFileSync(out, JSON.stringify({ p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max), mean: ms(h.mean) }));
};
process.on('SIGTERM', () => { dump(); process.exit(0); });
process.on('SIGINT', () => { dump(); process.exit(0); });
process.on('exit', dump);
