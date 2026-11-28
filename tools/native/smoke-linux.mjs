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
