'use strict';
/* unit_runner.js -- worker entry point. Runs one deterministic BGMA unit and
 * posts back the tour. Errors are serialised, never thrown across the thread. */
const { parentPort } = require('worker_threads');
const { hybridUnit } = require('./bgma.js');

parentPort.on('message', ({ id, task }) => {
  try {
    const res = hybridUnit(task.instSpec, task.seed, task.preset, task.restart);
    parentPort.postMessage({ id, len: res.len, tour: res.tour, ms: res.ms });
  } catch (e) {
    parentPort.postMessage({ id, error: String((e && e.stack) || e) });
  }
});
