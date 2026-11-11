# Benchmark harness

Black-box performance measurements for the SillyTavern server, using **synthetic data only**.
Never point it at real user data.

```bash
# 1. Generate a synthetic data root (deterministic; --seed to vary)
node bench/generate-data.mjs --out /path/to/data-large --characters 2000 --chats-per-char 8 --messages 200 --big-chats 5 --big-messages 5000

# 2. Run the scenarios (starts its own server on --port with --disableCsrf)
node bench/run.mjs --data /path/to/data-large --label my-change --reps 3
```

Each scenario reports wall time, response size, and a **stall probe**: the latency of a trivial
`POST /api/ping` sent every 20 ms while the scenario runs. A high probe max means the server's
event loop was blocked and every other request (including streaming generations) waited.
`bench/results/*.json` also holds the server's event-loop delay histogram for the whole run
(includes startup, so read per-scenario probes first).

Cold = first run (empty caches); warm = median of the remaining runs.
Compare a change by running the same data root with a different `--label` and diffing the JSON.

`baseline-large.json` was recorded on `06bde93` (release 1.19.0) with the dependency updates
from this branch, Node 22, 4 vCPU sandbox. Absolute numbers depend on hardware; compare
before/after on the same machine.
