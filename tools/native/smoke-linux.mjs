// Drives the built Sightread binary through tauri-driver (WebDriver) and checks: the first screen rendered, IPC works
// (`app_info`), and the web-app origin facts the native shell depends on. Plain fetch against the WebDriver HTTP API.
// Usage: node tools/native/smoke-linux.mjs <path-to-binary> <screenshot.png> [worklet-asset-path] [dsp-worker-asset-path]
import { writeFileSync } from 'node:fs';

const [app, shot, workletPath, dspWorkerPath] = process.argv.slice(2);
const BASE = 'http://127.0.0.1:4444';
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wd(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.value)}`);
  return json.value;
}

async function waitForDriver() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE + '/status');
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('tauri-driver did not start');
}

await waitForDriver();
const created = await wd('POST', '/session', {
  capabilities: { alwaysMatch: { 'tauri:options': { application: app } } },
});
const sid = created.sessionId;
const sync = (script, args = []) => wd('POST', `/session/${sid}/execute/sync`, { script, args });
const async_ = (script, args = []) => wd('POST', `/session/${sid}/execute/async`, { script, args });

let failure = null;
try {
  // 1. First screen: the app shell's stable test id (a fresh profile lands on the onboarding route), and no boot error.
  let state = null;
  for (let i = 0; i < 60; i++) {
    state = await sync(
      `return { home: !!document.querySelector('[data-testid=app-placeholder]'), route: document.querySelector('[data-testid=app-placeholder]')?.dataset.routeId ?? null, boot: !!document.querySelector('[data-testid=boot-error]'), bootText: document.querySelector('[data-testid=boot-error]')?.textContent ?? null };`,
    );
    if (state.home || state.boot) break;
    await sleep(500);
  }
  if (state.boot) throw new Error(`boot error shown: ${state.bootText}`);
  if (!state.home) throw new Error('app shell [data-testid=app-placeholder] never appeared');
  out(`ok  first screen: app shell rendered, route ${state.route}`);

  // 2. IPC round trip.
  const info = await async_(
    `const done = arguments[arguments.length - 1];
     window.__TAURI_INTERNALS__.invoke('app_info').then((v) => done({ ok: true, v }), (e) => done({ ok: false, e: String(e) }));`,
  );
  if (!info.ok) throw new Error(`app_info failed: ${info.e}`);
  const { version, os, arch } = info.v;
  if (!version || os !== 'linux' || !arch) throw new Error(`unexpected app_info: ${JSON.stringify(info.v)}`);
  out(`ok  IPC app_info: ${JSON.stringify(info.v)}`);

  // 2b. Native audio output on the fake device (the shell is started with SR_AUDIO_DEVICE=fake): open, put a short
  // buffer, schedule it 200 ms ahead, wait for its `ended` event, close. Raw payloads are plain Uint8Arrays; the events
  // Channel is built from `transformCallback` because the JS API package is not loaded in the page (it serialises as
  // `__CHANNEL__:<id>` and delivers `{ message, index }`).
  const audio = await async_(
    `const done = arguments[arguments.length - 1];
     (async () => {
       const T = window.__TAURI_INTERNALS__;
       const log = [];
       const events = [];
       const channel = {
         id: T.transformCallback((raw) => { if (raw && 'message' in raw) events.push(raw.message); }),
         toJSON() { return '__CHANNEL__:' + this.id; },
       };
       const step = async (name, p) => { try { const v = await p; log.push(name + ': ok'); return v; } catch (e) { throw new Error(name + ' failed: ' + (typeof e === 'string' ? e : JSON.stringify(e))); } };
       try {
         const info = await step('audio_open', T.invoke('audio_open', { input: false, outputMode: 'speakers', events: channel }));
         if (!(info.engineRate > 0) || info.inFrames !== null) throw new Error('unexpected OpenInfo ' + JSON.stringify(info));
         const n = 4800;
         const bytes = new Uint8Array(16 + n * 4);
         const dv = new DataView(bytes.buffer);
         bytes.set([0x53, 0x52, 0x42, 0x31], 0); // 'SRB1'
         dv.setUint32(4, 1, true); dv.setUint32(8, info.engineRate, true); dv.setUint32(12, n, true);
         dv.setFloat32(16, 0.25, true);
         await step('audio_put_buffer', T.invoke('audio_put_buffer', bytes));
         const sync = await step('audio_clock_sync', T.invoke('audio_clock_sync'));
         const t = sync.engineSec + 0.2;
         const sched = await step('audio_schedule', T.invoke('audio_schedule', { group: 'sounds', voices: [{ id: 1, buffer: 1, t, gain: 0.5 }] }));
         if (!Array.isArray(sched.late) || sched.late.length !== 0) throw new Error('voice was late: ' + JSON.stringify(sched));
         const deadline = Date.now() + 8000;
         const ended = () => events.some((e) => e.type === 'ended' && e.ids.includes(1));
         while (!ended() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
         if (!ended()) throw new Error('no ended event for voice 1; events: ' + JSON.stringify(events));
         log.push('ended event received after ' + events.length + ' events (' + events.filter((e) => e.type === 'clock').length + ' clock)');
         // Raw request and raw response: decode a real sample shipped with the app (u32 id + MP3 bytes in, u32 rate,
         // u32 frames, f32 samples out).
         const mp3 = new Uint8Array(await (await fetch('/sounds/flute/A4.mp3')).arrayBuffer());
         const req = new Uint8Array(4 + mp3.length);
         new DataView(req.buffer).setUint32(0, 2, true);
         req.set(mp3, 4);
         const reply = await step('audio_decode', T.invoke('audio_decode', req));
         const rdv = new DataView(reply instanceof ArrayBuffer ? reply : reply.buffer);
         const rate = rdv.getUint32(0, true), frames = rdv.getUint32(4, true);
         if (!(rate > 0 && frames > 1000 && rdv.byteLength === 8 + frames * 4)) throw new Error('bad decode reply: rate ' + rate + ' frames ' + frames + ' bytes ' + rdv.byteLength);
         log.push('decoded ' + frames + ' frames at ' + rate + ' Hz');
         // Capture on the fake duplex device: raw packets through a Channel, header checks from JS.
         const packets = [];
         const pch = {
           id: T.transformCallback((raw) => { if (raw && 'message' in raw) packets.push(raw.message); }),
           toJSON() { return '__CHANNEL__:' + this.id; },
         };
         const inInfo = await step('audio_set_input', T.invoke('audio_set_input', { enabled: true }));
         if (!(inInfo.inFrames > 0)) throw new Error('input did not open: ' + JSON.stringify(inInfo));
         const cs = await step('audio_capture_start', T.invoke('audio_capture_start', { packets: pch, packetFrames: 512 }));
         const pdeadline = Date.now() + 8000;
         while (packets.length < 20 && Date.now() < pdeadline) await new Promise((r) => setTimeout(r, 25));
         const stopInfo = await step('audio_capture_stop', T.invoke('audio_capture_stop'));
         await new Promise((r) => setTimeout(r, 200));
         if (packets.length < 20) throw new Error('only ' + packets.length + ' packets');
         let prevEnd = null;
         packets.forEach((p, i) => {
           const buf = p instanceof ArrayBuffer ? p : (p.buffer ?? new Uint8Array(p).buffer);
           const d = new DataView(buf);
           const kind = d.getUint8(0), version = d.getUint8(1), flags = d.getUint16(2, true), seq = d.getUint32(4, true);
           const first = d.getFloat64(8, true), n = d.getUint32(16, true);
           if (kind !== 1 || version !== 1) throw new Error('packet ' + i + ' bad kind/version ' + kind + '/' + version);
           if (seq !== i) throw new Error('packet ' + i + ' has seq ' + seq);
           if (buf.byteLength !== 24 + n * 4 || n < 1) throw new Error('packet ' + i + ' bad length ' + buf.byteLength + ' for ' + n + ' frames');
           if (i === 0 && first !== cs.originFrame) throw new Error('first packet frame ' + first + ' != originFrame ' + cs.originFrame);
           if (prevEnd !== null && first !== prevEnd) throw new Error('packet ' + i + ' not contiguous: ' + first + ' vs ' + prevEnd);
           if (i === packets.length - 1 && (flags & 8) === 0) throw new Error('last packet lacks the last flag');
           prevEnd = first + n;
         });
         if (stopInfo.packets !== packets.length) throw new Error('stop reported ' + stopInfo.packets + ' packets, received ' + packets.length);
         log.push('capture: ' + packets.length + ' packets, path ' + cs.path + ', origin ' + cs.originFrame);
         const lb = await step('audio_measure_loopback', T.invoke('audio_measure_loopback', { clicks: 8, timbre: 'tick' }));
         if (lb.found !== 8 || lb.scheduled !== 8 || Math.abs(lb.roundTripMs - 23.4) > 0.3) throw new Error('loopback: ' + JSON.stringify(lb));
         log.push('loopback: ' + lb.found + '/' + lb.scheduled + ' at ' + lb.roundTripMs.toFixed(3) + ' ms');
         await step('audio_close', T.invoke('audio_close'));
         done({ ok: true, log, engineRate: info.engineRate, outFrames: info.outFrames });
       } catch (e) {
         try { await T.invoke('audio_close'); } catch { /* best effort */ }
         done({ ok: false, error: String(e && e.message || e), log, events });
       }
     })();`,
  );
  if (!audio.ok) throw new Error(`native audio failed: ${audio.error} | log: ${audio.log.join('; ')} | events: ${JSON.stringify(audio.events)}`);
  out(`ok  native audio on fake device: ${audio.log.join('; ')} (rate ${audio.engineRate}, buffer ${audio.outFrames})`);

  // 3. Origin facts (informational unless noted).
  const facts = await async_(
    `const done = arguments[arguments.length - 1];
     (async () => {
       const out = { origin: location.origin, ua: navigator.userAgent };
       out.swSupported = 'serviceWorker' in navigator;
       out.swRegistrations = out.swSupported ? (await navigator.serviceWorker.getRegistrations().catch(() => [])).length : 0;
       out.idb = await new Promise((res) => { const r = indexedDB.open('smoke-probe', 1); r.onsuccess = () => { r.result.close(); indexedDB.deleteDatabase('smoke-probe'); res('ok'); }; r.onerror = () => res('error: ' + r.error); });
       out.blobWorker = await new Promise((res) => { try { const u = URL.createObjectURL(new Blob(['postMessage(1)'])); const w = new Worker(u); w.onmessage = () => res('ok'); w.onerror = (e) => res('error: ' + e.message); } catch (e) { res('error: ' + e); } setTimeout(() => res('timeout'), 3000); });
       const wp = arguments[0];
       if (wp) {
         out.worklet = await new Promise((res) => { try { const c = new AudioContext(); c.audioWorklet.addModule(wp).then(() => res('ok'), (e) => res('error: ' + e)); } catch (e) { res('error: ' + e); } setTimeout(() => res('timeout'), 4000); });
       }
       const dp = arguments[1];
       if (dp) {
         out.dspWorker = await new Promise((res) => { try { const w = new Worker(dp, { type: 'module' }); w.onerror = (e) => res('error: ' + e.message); setTimeout(() => res('ok (no load error in 1.5s)'), 1500); } catch (e) { res('error: ' + e); } });
       }
       done(out);
     })();`,
    [workletPath ?? null, dspWorkerPath ?? null],
  ).catch((e) => ({ error: String(e) }));
  out('info origin facts:', JSON.stringify(facts));
  if (facts.swRegistrations !== 0) throw new Error('a service worker is registered inside the native shell');
  if (facts.idb !== 'ok') throw new Error(`IndexedDB unavailable: ${facts.idb}`);
  if (typeof facts.dspWorker === 'string' && facts.dspWorker.startsWith('error')) throw new Error(`DSP worker: ${facts.dspWorker}`);
  if (facts.blobWorker !== 'ok') throw new Error(`blob worker blocked: ${facts.blobWorker}`);

  // 4. Screenshot.
  const png = await wd('GET', `/session/${sid}/screenshot`);
  writeFileSync(shot, Buffer.from(png, 'base64'));
  out(`ok  screenshot: ${shot}`);
} catch (e) {
  failure = e;
  try {
    const body = await sync(`return location.href + ' | ' + document.body.innerHTML.slice(0, 600);`);
    console.error('page state:', body);
    writeFileSync(shot, Buffer.from(await wd('GET', `/session/${sid}/screenshot`), 'base64'));
  } catch {
    /* best effort */
  }
} finally {
  await wd('DELETE', `/session/${sid}`).catch(() => undefined);
}
if (failure) {
  console.error('SMOKE FAILED:', failure.message);
  process.exit(1);
}
out('SMOKE PASSED');
