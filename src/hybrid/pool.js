'use strict';
/* pool.js -- a small worker_threads pool for independent BGMA runs.
 *
 * Each task is fully self-contained: {instSpec, seed, preset, restart}. Workers
 * rebuild the instance locally, so the only data that crosses a thread boundary
 * is the point list (or the four numbers the synthetic builder needs) and the
 * finished tour. No shared mutable state, no locks, no ordering assumptions.
 */
const { Worker } = require('worker_threads');
const path = require('path');

function runPool(tasks, jobs) {
  if (!tasks.length) return Promise.resolve([]);
  const nw = Math.max(1, Math.min(jobs | 0 || 1, tasks.length));
  return new Promise((resolve, reject) => {
    const out = new Array(tasks.length);
    const workers = [];
    let next = 0, done = 0, settled = false;

    const finish = err => {
      if (settled) return;
      settled = true;
      for (const w of workers) w.terminate();
      if (err) reject(err); else resolve(out);
    };

    for (let k = 0; k < nw; k++) {
      const w = new Worker(path.join(__dirname, 'unit_runner.js'));
      const feed = () => {
        if (settled) return;
        if (next >= tasks.length) { w.terminate(); return; }
        const i = next++;
        w.postMessage({ id: i, task: tasks[i] });
      };
      w.on('message', m => {
        if (m.error) return finish(new Error('worker ' + m.id + ': ' + m.error));
        out[m.id] = m;
        if (++done === tasks.length) finish(null); else feed();
      });
      w.on('error', finish);
      workers.push(w);
      feed();
    }
  });
}

module.exports = { runPool };
