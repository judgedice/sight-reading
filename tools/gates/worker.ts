// Gate worker thread: runs the jobs it is sent and posts their TakeRecords back (tools/gates/run.ts).
import { parentPort } from 'node:worker_threads';
import { runJob, type Job } from '../../src/testkit/gates/index.ts';

if (!parentPort) throw new Error('tools/gates/worker.ts must run as a worker thread');
const port = parentPort;
port.on('message', (msg: { seq: number; job: Job }) => {
  try {
    port.postMessage({ seq: msg.seq, record: runJob(msg.job) });
  } catch (e) {
    port.postMessage({ seq: msg.seq, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
});
