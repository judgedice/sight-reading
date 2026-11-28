// Native end-to-end test on Linux: drives the REAL UI of the debug app in the Tauri window (tauri-driver + WebKitWebDriver
// under xvfb) on the fake duplex audio device, through the real TypeScript backend and the real Rust commands.
//
// Scenarios (one app start each, see e2e-linux.sh):
//   main    onboarding (instrument, sound check: microphone, hear you, timing), calibration, the page's own loopback check,
//           one synthetic try to the results screen, Listen with a sampled instrument, the three metronome previews.
//   timing  onboarding with the hear stage skipped and calibration at another loop delay, with the engine pre-check switched
//           off through the end-to-end hook (`window.__sr.native.precheckDisabled`), so the standard profile plays.
//
// Both assert the kv latency record `native:latency:<routeKey>` after calibration (profile `native-short` in main,
// `standard` in timing) and report each calibration run's duration in seconds (R.measurements.calibrationSeconds).
//
// Usage: node tools/native/e2e-linux.mjs <binary> <artifact dir> <work dir> <scenario> <loop ms> [expected loop ms]
// The app must have been started with SR_AUDIO_DEVICE=fake SR_E2E_HOOKS=1 SR_E2E_SEED=<n> SR_FAKE_LOOP_MS=<loop ms> (the shell
// script does this). Writes <artifact dir>/e2e-<scenario>.json and screenshots; exits 1 when a check fails.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [app, outDir, workDir, scenario, loopMsArg] = process.argv.slice(2);
const loopMs = Number(loopMsArg);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = `http://127.0.0.1:${process.env.SR_E2E_PORT ?? 4444}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);
mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

/** What the run found: written to e2e-<scenario>.json. */
const R = { scenario, loopMs, stages: {}, measurements: {}, failures: [] };
const check = (ok, msg) => {
  if (ok) log(`ok   ${msg}`);
  else {
    log(`FAIL ${msg}`);
    R.failures.push(msg);
  }
  return ok;
};

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
for (let i = 0; ; i++) {
  try {
    await fetch(BASE + '/status');
    break;
  } catch {
    if (i > 50) throw new Error('tauri-driver did not start');
    await sleep(200);
  }
}
const created = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: app } } } });
const sid = created.sessionId;
const sync = (script, args = []) => wd('POST', `/session/${sid}/execute/sync`, { script, args });
const async_ = (script, args = []) => wd('POST', `/session/${sid}/execute/async`, { script, args });

const shots = [];
async function shot(name) {
  const file = join(outDir, `${scenario}-${String(shots.length + 1).padStart(2, '0')}-${name}.png`);
  writeFileSync(file, Buffer.from(await wd('GET', `/session/${sid}/screenshot`), 'base64'));
  shots.push(file);
}

/** Runs a Tauri command from the page (the page's own invoke, as the app's IPC layer does). */
const invoke = (cmd, args = {}) =>
  async_(
    `const done = arguments[arguments.length - 1];
     window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then((v) => done({ ok: true, v }), (e) => done({ ok: false, e: String(e) }));`,
    [cmd, args],
  ).then((r) => {
    if (!r.ok) throw new Error(`${cmd}: ${r.e}`);
    return r.v;
  });

/** Runs an async function body in the page, `window.__sr` at hand; resolves with its return value. */
const page = (body, args = []) =>
  async_(
    `const done = arguments[arguments.length - 1];
     const args = arguments;
     (async () => { const sr = window.__sr; ${body} })().then((v) => done({ ok: true, v }), (e) => done({ ok: false, e: String((e && e.stack) || e) }));`,
    args,
  ).then((r) => {
    if (!r.ok) throw new Error(`page: ${r.e}`);
    return r.v;
  });

async function dump() {
  return sync(
    `return { url: location.href, testids: [...document.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid).slice(0, 40), buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim() + (b.disabled ? ' (disabled)' : '')).slice(0, 30), errors: window.__e2e ? window.__e2e.errors.slice(-5) : null, text: document.body.innerText.slice(0, 400) };`,
  ).catch((e) => ({ dumpFailed: String(e) }));
}

/** Polls `expr` (a JS expression string, run in the page) until it is truthy. */
async function waitFor(expr, what, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await sync(`try { return (${expr}) || false; } catch (e) { return false; }`);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout (${timeoutMs} ms) waiting for ${what}; page: ${JSON.stringify(await dump())}`);
    await sleep(150);
  }
}
const testid = (id) => `document.querySelector('[data-testid="${id}"]')`;

/** Clicks the enabled button whose name (text or aria-label) is `name` (a string) inside `scope` (a selector). */
async function click(name, what = name, { scope = 'body', timeoutMs = 30000, role = 'button', prefix = role === 'radio' } = {}) {
  const sel = role === 'radio' ? '[role=radio], input[type=radio], button' : 'button, [role=button]';
  const script = `
    const [name, scope, sel, prefix] = arguments;
    const root = document.querySelector(scope);
    if (!root) return false;
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const el = [...root.querySelectorAll(sel)].find((b) => (norm(b.getAttribute('aria-label')) === name || norm(b.textContent) === name || norm(b.textContent).startsWith(name + ' ') || (prefix && norm(b.textContent).startsWith(name))) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    if (!el) return false;
    el.click();
    return true;`;
  const t0 = Date.now();
  for (;;) {
    if (await sync(script, [name, scope, sel, prefix])) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`no enabled ${role} "${what}"; page: ${JSON.stringify(await dump())}`);
    await sleep(150);
  }
}

/** Calibration runs per scenario: the first, then the card's own "Calibrate again". */
const CALIBRATION_RUNS = 5;
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
const stagesOf = () =>
  sync(`return [...document.querySelectorAll('[data-testid="ob-stages"] .ob-stage')].map((e) => ({ stage: e.dataset.stage, status: e.dataset.status }));`);

async function finish(failure) {
  R.failures.push(...(failure ? [`aborted: ${failure.message}`] : []));
  if (failure) {
    console.error('page state:', JSON.stringify(await dump()));
    await shot('failure').catch(() => undefined);
  }
  writeFileSync(join(outDir, `e2e-${scenario}.json`), JSON.stringify(R, null, 2));
  await wd('DELETE', `/session/${sid}`).catch(() => undefined);
  if (R.failures.length > 0) {
    console.error(`E2E ${scenario} FAILED:\n  ${R.failures.join('\n  ')}`);
    process.exit(1);
  }
  log(`E2E ${scenario} PASSED`);
}

// ---- scenario `data`: export, import, storage, links, keep-awake (the shell's non-audio services) ------------------------
// Three starts of the app on one profile (the XDG directories of the shell script): onboarding and facts, then a relaunch
// that must find everything again, exports a backup through the UI, and deletes all data; a last start imports the backup.
// Under WebDriver a native save dialog cannot be clicked: SR_E2E_HOOKS=1 with SR_E2E_SAVE_DIR makes `save_file` write to
// that directory without a dialog (src-tauri/src/files.rs).
async function dataScenario() {
  const saveDir = process.env.SR_E2E_SAVE_DIR;
  if (!saveDir) throw new Error('the data scenario needs SR_E2E_SAVE_DIR (e2e-linux.sh sets it)');
  const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

  function bind(id, tag) {
    const S = (script, args = []) => wd('POST', `/session/${id}/execute/sync`, { script, args });
    const A = (script, args = []) => wd('POST', `/session/${id}/execute/async`, { script, args });
    const inv = (cmd, args = {}) =>
      A(`const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then((v) => done({ ok: true, v }), (e) => done({ ok: false, e: String(e) }));`, [cmd, args]);
    const pg = (body, args = []) =>
      A(`const done = arguments[arguments.length - 1]; const args = arguments; (async () => { const sr = window.__sr; ${body} })().then((v) => done({ ok: true, v }), (e) => done({ ok: false, e: String((e && e.stack) || e) }));`, args).then((r) => {
        if (!r.ok) throw new Error(`page: ${r.e}`);
        return r.v;
      });
    const wf = async (expr, what, timeoutMs = 30000) => {
      const t0 = Date.now();
      for (;;) {
        const v = await S(`try { return (${expr}) || false; } catch (e) { return false; }`);
        if (v) return v;
        if (Date.now() - t0 > timeoutMs) throw new Error(`[${tag}] timeout (${timeoutMs} ms) waiting for ${what}; page: ${JSON.stringify(await S(`return { url: location.href, text: document.body.innerText.slice(0, 300) };`).catch(() => null))}`);
        await sleep(150);
      }
    };
    const btn = async (name, { scope = 'body', timeoutMs = 30000, radio = false } = {}) => {
      const script = `
        const [name, scope, radio] = arguments;
        const root = document.querySelector(scope);
        if (!root) return false;
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const sel = radio ? '[role=radio], input[type=radio], button' : 'button, [role=button]';
        const el = [...root.querySelectorAll(sel)].find((b) => (norm(b.getAttribute('aria-label')) === name || norm(b.textContent) === name || norm(b.textContent).startsWith(name + ' ') || (radio && norm(b.textContent).startsWith(name))) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
        if (!el) return false;
        el.click();
        return true;`;
      const t0 = Date.now();
      for (;;) {
        if (await S(script, [name, scope, radio])) return;
        if (Date.now() - t0 > timeoutMs) throw new Error(`[${tag}] no enabled button "${name}"; page: ${JSON.stringify(await S(`return document.body.innerText.slice(0, 300);`).catch(() => null))}`);
        await sleep(150);
      }
    };
    const shotAs = async (name) => {
      const file = join(outDir, `${scenario}-${tag}-${name}.png`);
      writeFileSync(file, Buffer.from(await wd('GET', `/session/${id}/screenshot`), 'base64'));
    };
    return { id, S, A, inv, pg, wf, btn, shotAs };
  }

  async function start(tag, session) {
    const id = session ?? (await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: app } } } })).sessionId;
    const s = bind(id, tag);
    await s.wf(`${testid('screen-welcome')} || ${testid('screen-home')} || ${testid('boot-error')}`, 'the first screen', 60000);
    check(!(await s.S(`return !!${testid('boot-error')}`)), `[${tag}] the app booted without a boot error`);
    await s.wf('window.__sr', 'window.__sr (SR_E2E_HOOKS=1)', 10000);
    return s;
  }
  async function quit(s) {
    await wd('DELETE', `/session/${s.id}`).catch(() => undefined);
    await sleep(2500); // the webview flushes IndexedDB and localStorage as the process ends
  }

  const state = (s) =>
    s.pg(`return {
      profile: (await sr.repos.profile.get()) ?? null,
      calibrations: await sr.repos.calibrations.all(),
      attempts: (await sr.repos.attempts.all()).length,
      kvMarker: (await sr.kv.get('e2e:marker')) ?? null,
      lsMarker: localStorage.getItem('e2e-ls'),
      installMirror: localStorage.getItem('srt.installId'),
      origin: location.origin,
    };`);
  const files = () => (existsSync(saveDir) ? readdirSync(saveDir).filter((f) => f.startsWith('sightread-backup-')) : []);

  // ---- launch 1: facts about the webview, onboarding, markers ----------------------------------------------------------
  let s = await start('1', sid);
  const facts = await s.pg(`
    const nav = navigator;
    const out = {
      origin: location.origin, href: location.href, protocol: location.protocol, isSecureContext: window.isSecureContext,
      randomUUID: typeof crypto.randomUUID, getRandomValues: typeof crypto.getRandomValues,
      storage: typeof nav.storage, persist: typeof nav.storage?.persist, persisted: typeof nav.storage?.persisted, estimate: typeof nav.storage?.estimate,
      wakeLock: 'wakeLock' in nav, wakeLockRequest: typeof nav.wakeLock?.request, indexedDB: typeof indexedDB, localStorage: typeof localStorage, title: document.title,
    };
    out.wakeLockResult = nav.wakeLock?.request ? await nav.wakeLock.request('screen').then((l) => { l.release(); return 'granted'; }, (e) => 'rejected: ' + (e && e.name)) : 'absent';
    out.persistResult = nav.storage?.persist ? await nav.storage.persist().then((v) => v, (e) => 'throws: ' + e) : 'absent';
    out.persistedResult = nav.storage?.persisted ? await nav.storage.persisted().then((v) => v, (e) => 'throws: ' + e) : 'absent';
    out.estimateResult = nav.storage?.estimate ? await nav.storage.estimate().then((v) => ({ usage: v.usage ?? null, quota: v.quota ?? null }), (e) => 'throws: ' + e) : 'absent';
    return out;`);
  R.storage = facts;
  log(`     webview: origin ${facts.origin}, secure context ${facts.isSecureContext}, randomUUID ${facts.randomUUID}, storage ${facts.storage}, persist ${facts.persist} -> ${JSON.stringify(facts.persistResult)}, navigator.wakeLock.request ${facts.wakeLockRequest} -> ${facts.wakeLockResult}, title "${facts.title}"`);
  check(facts.origin === 'tauri://localhost' || facts.protocol === 'tauri:', `the bundle is served from tauri://localhost (${facts.origin})`);
  check(facts.indexedDB === 'object' && facts.localStorage === 'object', 'IndexedDB and localStorage exist in the shell');
  check(/Sightread$/.test(facts.title), `the page title names the app (${facts.title})`);
  check(typeof (await s.pg(`return sr.session.view.getState().state;`)) === 'string', 'the app exposes its session (hooks on)');

  if (await s.S(`return !!${testid('screen-welcome')}`)) {
    await s.btn('Get started');
    await s.wf(testid('ob-instrument'), 'the instrument step');
    await s.btn('Flute', { radio: true });
    await sleep(300);
    await s.btn('Next: sound check');
    await s.wf(testid('ob-mic'), 'the microphone stage');
    await s.btn('Allow microphone');
    await s.wf(`${testid('ob-hear')} || ${testid('calibration-card')}`, 'the stage after the microphone', 30000);
    if (await s.S(`return !!${testid('ob-hear')}`)) await s.btn('Skip this check');
    await s.wf(testid('calibration-card'), 'the timing stage');
    await s.btn('Start timing check');
    await s.wf(`['measured', 'loopback-failed', 'playalong-failed'].includes(${testid('calibration-card')}?.dataset.step)`, 'the timing check to end', 90000);
    check((await s.S(`return ${testid('calibration-card')}.dataset.step`)) === 'measured', 'onboarding: calibration measured');
    await s.btn('Yes');
    await sleep(300);
    await s.btn('Next');
    await s.wf(testid('ob-ready'), 'the Ready step');
    await s.btn('Go to Home');
    await s.wf(testid('screen-home'), 'Home', 20000);
  }
  await s.pg(`await sr.kv.set('e2e:marker', { n: 41, s: 'kept' }); localStorage.setItem('e2e-ls', 'kept');`);
  const s1 = await state(s);
  check(s1.profile !== null && s1.calibrations.length === 1, `launch 1: a profile (${s1.profile?.id}) and one calibration (${s1.calibrations[0]?.roundTripMs?.toFixed(3)} ms) are stored`);
  check(s1.installMirror !== null, 'launch 1: the localStorage install mirror is written');
  R.measurements.launch1 = { origin: s1.origin, profileId: s1.profile?.id, calibration: s1.calibrations[0] };
  await s.shotAs('home');
  await quit(s);

  // ---- launch 2: persistence, external services, export, delete ----------------------------------------------------------
  s = await start('2');
  const s2 = await state(s);
  check(s2.origin === s1.origin, `launch 2: same origin (${s2.origin})`);
  check(stable(s2.profile) === stable(s1.profile), 'launch 2: the profile is the same after a relaunch (IndexedDB persisted)');
  check(stable(s2.calibrations) === stable(s1.calibrations), 'launch 2: the stored calibration is the same after a relaunch');
  check(stable(s2.kvMarker) === stable({ n: 41, s: 'kept' }), 'launch 2: the key-value marker is still there');
  check(s2.lsMarker === 'kept' && s2.installMirror === s1.installMirror, 'launch 2: localStorage (marker and install mirror) persisted');
  check(await s.S(`return !!${testid('screen-home')}`), 'launch 2: opens on Home, not onboarding (the profile counts)');
  const storageLostBanner = await s.S(`return /storage|lost|cleared/i.test(document.body.innerText);`);
  R.measurements.launch2StorageNotice = storageLostBanner;

  // Keep awake: the engine's lock (D-Bus on Linux; a headless box may have none, which the page treats as "could not").
  const awakeOn = await s.inv('keep_awake', { on: true });
  const awakeOff = await s.inv('keep_awake', { on: false });
  R.measurements.keepAwake = { on: awakeOn, off: awakeOff };
  log(`     keep_awake on: ${JSON.stringify(awakeOn)}; off: ${JSON.stringify(awakeOff)}`);
  check(awakeOff.ok, 'keep_awake(false) is always accepted');

  // The opener grant is a strict pattern: http(s) only.
  const denied = {};
  for (const url of ['file:///etc/passwd', 'mailto:someone@example.org', 'ftp://example.org/x', 'javascript:alert(1)']) {
    denied[url] = await s.inv('plugin:opener|open_url', { url });
  }
  R.measurements.openerDenied = denied;
  check(Object.values(denied).every((r) => !r.ok && /not allowed|scope|permission/i.test(r.e)), `the opener refuses everything but http(s): ${JSON.stringify(Object.fromEntries(Object.entries(denied).map(([k, v]) => [k, v.e?.slice(0, 60)])))}`);
  check(!(await s.inv('plugin:opener|open_path', { path: '/etc/passwd' })).ok, 'the opener open_path command is not granted');
  const allowed = await s.inv('plugin:opener|open_url', { url: 'https://example.org/' });
  R.measurements.openerAllowed = allowed;
  check(allowed.ok || !/not allowed|scope|permission/i.test(allowed.e), `an https URL passes the allow pattern (${allowed.ok ? 'opened' : allowed.e?.slice(0, 80)})`);
  check(!(await s.inv('save_file', { bytes: [1] })).ok, 'save_file refuses a request that is not a raw body');

  // Licence text: the credits page links ./LICENSES/<name>.txt with target=_blank; a click opens the window.
  await s.S(`location.hash = '#/credits';`);
  await s.wf(`document.querySelector('a[href$="LICENSES/CC0-1.0.txt"]')`, 'a licence link on the credits page', 20000);
  const handlesBefore = (await wd('GET', `/session/${s.id}/window/handles`)).length;
  const linkId = Object.values(await wd('POST', `/session/${s.id}/element`, { using: 'css selector', value: 'a[href$="LICENSES/CC0-1.0.txt"]' }))[0];
  await wd('POST', `/session/${s.id}/element/${linkId}/click`, {});
  let handles = handlesBefore;
  for (let i = 0; i < 30 && handles === handlesBefore; i++) {
    await sleep(200);
    handles = (await wd('GET', `/session/${s.id}/window/handles`)).length;
  }
  check(handles === handlesBefore + 1, `a click on a licence link opens a window of its own (${handlesBefore} -> ${handles} windows)`);
  const stillHere = await s.S(`return location.hash`);
  check(stillHere === '#/credits', `the app window stays on the credits page (${stillHere})`);
  const bad = await s.inv('open_licence', { name: '../src-tauri/Cargo.toml' });
  check(!bad.ok, `open_licence refuses a name that is not a licence text (${bad.e?.slice(0, 70)})`);
  if (handles === handlesBefore + 1) {
    const list = await wd('GET', `/session/${s.id}/window/handles`);
    const current = await wd('GET', `/session/${s.id}/window`);
    const other = list.find((h) => h !== current);
    await wd('POST', `/session/${s.id}/window`, { handle: other });
    const licenceText = await wd('POST', `/session/${s.id}/execute/sync`, { script: 'return { href: location.href, text: document.body.innerText.slice(0, 120) };', args: [] });
    R.measurements.licenceWindow = licenceText;
    check(/LICENSES\/CC0-1\.0\.txt$/.test(licenceText.href) && licenceText.text.length > 20, `the licence window shows the text of the file (${JSON.stringify(licenceText.text.slice(0, 50))})`);
    await wd('DELETE', `/session/${s.id}/window`).catch(() => undefined); // closes the licence window
    await wd('POST', `/session/${s.id}/window`, { handle: current });
  }

  // Export a backup through the UI.
  await s.S(`location.hash = '#/settings/data';`);
  await s.wf(`document.querySelector('[data-testid="import-file"]')`, 'Settings > Data', 20000);
  const before = new Set(files());
  await s.btn('Export all data (JSON)');
  let saved = null;
  for (let i = 0; i < 50 && !saved; i++) {
    await sleep(200);
    saved = files().find((f) => !before.has(f)) ?? null;
  }
  if (!check(saved !== null, `the export button wrote a backup file through save_file (${saved})`)) throw new Error('no backup file');
  check(/^sightread-backup-\d{4}-\d{2}-\d{2}\.json$/.test(saved), `the file has the dated backup name (${saved})`);
  await s.wf(`/Saved/.test(document.body.innerText)`, 'the "Saved" toast', 5000).then(
    () => check(true, 'the "Saved" toast shows after the file is written'),
    () => check(false, 'the "Saved" toast shows after the file is written'),
  );
  await s.shotAs('exported');
  const backupPath = join(saveDir, saved);
  const verdict = JSON.parse(execFileSync('pnpm', ['exec', 'tsx', 'tools/native/validate-backup.ts', backupPath], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString());
  R.measurements.backup = { file: saved, bytes: statSync(backupPath).size, verdict };
  check(verdict.ok === true, `the backup passes the app's own import validator (${JSON.stringify(verdict).slice(0, 160)})`);
  check(verdict.profileId === s1.profile.id && verdict.calibrations.length === 1 && Math.abs(verdict.calibrations[0].roundTripMs - s1.calibrations[0].roundTripMs) < 1e-9, 'the backup holds the profile and the calibration');
  const raw = JSON.parse(readFileSync(backupPath, 'utf8'));
  check(stable(raw.kv['e2e:marker']) === stable({ n: 41, s: 'kept' }), 'the backup holds the key-value marker');

  // Delete all data in Settings.
  await s.btn('Delete all data');
  await s.wf(`document.querySelector('#set-delete-confirm')`, 'the delete confirmation', 10000);
  await s.S(`const el = document.querySelector('#set-delete-confirm'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, 'delete'); el.dispatchEvent(new Event('input', { bubbles: true }));`);
  await s.btn('Delete everything', { scope: '[role=dialog]' });
  await s.wf(`window.__sr && ${testid('screen-welcome')} || document.body.innerText.includes('deleted')`, 'the app after deleting', 20000);
  await sleep(500);
  const afterDelete = await state(s);
  check(afterDelete.profile === null && afterDelete.calibrations.length === 0 && afterDelete.kvMarker === null, 'after "Delete all data" the profile, calibrations and key-value entries are gone');
  await s.shotAs('deleted');
  await quit(s);

  // ---- launch 3: empty after a relaunch, then import the backup ---------------------------------------------------------------
  s = await start('3');
  const s3 = await state(s);
  check(s3.profile === null && s3.calibrations.length === 0, 'launch 3: the deletion persisted across the relaunch');
  await s.S(`location.hash = '#/settings/data';`);
  await s.wf(`document.querySelector('[data-testid="import-file"]')`, 'Settings > Data on an empty install', 20000);
  const inputId = Object.values(await wd('POST', `/session/${s.id}/element`, { using: 'css selector', value: '[data-testid="import-file"]' }))[0];
  await wd('POST', `/session/${s.id}/element/${inputId}/value`, { text: backupPath });
  await s.wf(`[...document.querySelectorAll('[role=dialog] button')].some((b) => b.textContent.trim() === 'Import backup')`, 'the import confirmation (the file input delivered the file)', 15000);
  check(true, 'the file input accepted the chosen path and the page read the file (no open-file command needed)');
  await s.shotAs('import-confirm');
  await s.btn('Import backup', { scope: '[role=dialog]' });
  await s.wf(`window.__sr`, 'the app after the import', 20000);
  await sleep(1000);
  const s4 = await state(s);
  check(s4.profile !== null && stable(s4.profile) === stable(s1.profile), 'after the import the profile is back, field for field');
  check(s4.calibrations.length === 1 && stable(s4.calibrations[0]) === stable(s1.calibrations[0]), `after the import the stored calibration is back (${s4.calibrations[0]?.roundTripMs?.toFixed(3)} ms)`);
  check(stable(s4.kvMarker) === stable({ n: 41, s: 'kept' }), 'after the import the key-value marker is back');
  await s.shotAs('imported');
  await quit(s);

  // ---- launch 4: the import itself persisted ---------------------------------------------------------------------------------
  s = await start('4');
  const s5 = await state(s);
  check(stable(s5.profile) === stable(s1.profile) && stable(s5.calibrations) === stable(s1.calibrations), 'launch 4: the imported data persisted across another relaunch');
  await wd('DELETE', `/session/${s.id}`).catch(() => undefined);
}

try {
  if (scenario === 'data') {
    await dataScenario();
    await finish(null);
    process.exit(R.failures.length > 0 ? 1 : 0);
  }
  // ---- boot --------------------------------------------------------------------------------------------------------------
  await waitFor(`${testid('screen-welcome')} || ${testid('boot-error')}`, 'the first screen', 60000);
  check(!(await sync(`return !!${testid('boot-error')}`)), 'the app booted without a boot error');
  await waitFor('window.__sr', 'window.__sr (the engine reported SR_E2E_HOOKS=1)', 10000);
  await sync(`
    window.__e2e = { errors: [], faults: [], interruptions: [] };
    window.addEventListener('error', (e) => window.__e2e.errors.push('error: ' + e.message));
    window.addEventListener('unhandledrejection', (e) => window.__e2e.errors.push('rejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
    const ce = console.error.bind(console);
    console.error = (...a) => { window.__e2e.errors.push('console.error: ' + a.map(String).join(' ')); ce(...a); };
    window.__sr.audio.onCaptureFault((f) => window.__e2e.faults.push({ ...f, atSec: window.__sr.audio.now() }));
    window.__sr.audio.onInterruption((r) => window.__e2e.interruptions.push(r));`);
  const hooks = await invoke('audio_debug_hooks');
  check(hooks.enabled === true && typeof hooks.seed === 'number', `debug hooks on, seed ${hooks.seed}`);
  await shot('welcome');

  // ---- (a) onboarding ----------------------------------------------------------------------------------------------------
  await click('Get started');
  await waitFor(testid('ob-instrument'), 'the instrument step');
  await click('Flute', 'the Flute card', { role: 'radio' });
  await sleep(300);
  await shot('instrument');
  await click('Next: sound check');
  await waitFor(testid('ob-mic'), 'the microphone stage');
  R.stages.mic = { before: await stagesOf() };
  await shot('mic');
  const permission = await invoke('audio_permission', { request: false });
  R.stages.mic.permission = permission;
  await click('Allow microphone');
  await waitFor(`${testid('ob-hear')} || ${testid('calibration-card')} || ${testid('ob-mic')}?.querySelector('[role=alert]')`, 'the stage after the microphone', 30000);
  const afterMic = await sync(`return { hear: !!${testid('ob-hear')}, timing: !!${testid('calibration-card')}, problem: !!document.querySelector('[data-testid^="mic-"]') }`);
  check(afterMic.hear, `microphone granted: the Hear you stage opened (permission state before the click: ${permission})`);

  const sig = (name) => join(workDir, name);
  if (afterMic.hear && scenario === 'main') {
    // Hear you needs a steady, voiced note for about a second; the fake device hears nothing unless it is fed one.
    execFileSync('pnpm', ['exec', 'tsx', 'tools/native/make-synth-input.ts', 'tone', '--midi', '72', '--sec', '5', '--out', sig('hear-tone.f32')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    await shot('hear-listening');
    const t0 = Date.now();
    const now = await invoke('audio_clock_sync');
    await invoke('audio_debug_signal', { path: sig('hear-tone.f32'), engineSec: now.engineSec + 0.3 });
    await waitFor(`${testid('ob-hear')}?.dataset.heard === 'true'`, 'the Hear you stage to hear the note', 25000);
    R.stages.hear = { signal: 'steady flute note, midi 72, 5 s from engine time +0.3 s', heardAfterMs: Date.now() - t0, note: await sync(`return ${testid('ob-heard-note')}?.textContent ?? null`) };
    log(`     Hear you heard ${R.stages.hear.note} after ${R.stages.hear.heardAfterMs} ms`);
    await shot('hear-heard');
    await click('Next');
  } else if (afterMic.hear) {
    await click('Skip this check');
    R.stages.hear = { skipped: true };
  }
  await invoke('audio_debug_signal', { path: null, engineSec: 0 });

  await waitFor(testid('calibration-card'), 'the timing stage');
  await shot('timing-idle');
  const expectedProfile = scenario === 'main' ? 'native-short' : 'standard';
  if (scenario !== 'main') {
    // The pre-check would pass on the fake device; this hook makes it count as failed, so the normal schedule plays.
    await page(`sr.native.precheckDisabled = true; return sr.native.precheckDisabled;`);
  }
  const tCal = Date.now();
  await click('Start timing check');
  await waitFor(`${testid('calibration-card')}?.dataset.step === 'loopback-running'`, 'the timing check to start', 15000);
  await sleep(2500);
  await shot('timing-running');
  await waitFor(`['measured', 'loopback-failed', 'playalong-failed'].includes(${testid('calibration-card')}?.dataset.step)`, 'the timing check to end', 90000);
  const calStep = await sync(`return ${testid('calibration-card')}.dataset.step`);
  const firstRunMs = Date.now() - tCal;
  R.stages.timing = { step: calStep, tookMs: firstRunMs, resultText: await sync(`return ${testid('cal-result')}?.innerText ?? ${testid('cal-fail')}?.innerText ?? null`) };
  await shot('timing-result');
  if (!check(calStep === 'measured', `speaker calibration measured (step ${calStep}: ${R.stages.timing.resultText})`)) throw new Error('calibration did not complete');
  // The card asks whether the clicks were audible; nothing on the fake device can hear, the answer is the player's.
  await click('Yes');
  await sleep(300);
  await shot('timing-answered');
  // The stored calibration after each run: the first, then more runs of the card's own "Calibrate again" for the spread.
  const storedNow = async () => (await page(`return await sr.repos.calibrations.all();`))[0];
  const runs = [await storedNow()];
  const runMs = [firstRunMs];
  for (let k = 1; k < CALIBRATION_RUNS; k++) {
    const tRun = Date.now();
    await click('Calibrate again');
    await waitFor(`${testid('calibration-card')}?.dataset.step === 'loopback-running'`, `calibration run ${k + 1} to start`, 15000);
    await waitFor(`['measured', 'loopback-failed', 'playalong-failed'].includes(${testid('calibration-card')}?.dataset.step)`, `calibration run ${k + 1} to end`, 90000);
    runMs.push(Date.now() - tRun);
    const step = await sync(`return ${testid('calibration-card')}.dataset.step`);
    check(step === 'measured', `calibration run ${k + 1} measured (step ${step})`);
    await click('Yes').catch(() => undefined);
    await sleep(300);
    runs.push(await storedNow());
  }
  // Click to the result, in seconds: the engine pre-check (when it runs), the calibration, the audio check and the cross-check.
  const seconds = runMs.map((ms) => Math.round(ms / 100) / 10);
  R.measurements.calibrationSeconds = { profile: expectedProfile, first: seconds[0], runs: seconds, meanSec: Math.round((seconds.reduce((a, b) => a + b, 0) / seconds.length) * 10) / 10 };
  log(`     calibration duration (${expectedProfile}): first run ${seconds[0]} s, all ${seconds.join(', ')} s`);
  R.measurements.calibrationRuns = runs.map((c) => ({ roundTripMs: c.roundTripMs, madMs: c.madMs ?? null, measuredAt: c.measuredAt }));
  await click('Next');
  await waitFor(testid('ob-ready'), 'the Ready step');
  R.stages.ready = { stagesAtEnd: await stagesOf(), text: await sync(`return ${testid('ob-ready')}.innerText.slice(0, 600)`) };
  await shot('ready');
  await click('Go to Home');
  await waitFor(testid('screen-home'), 'Home', 20000);
  await shot('home');
  check(true, 'onboarding ran through: instrument, microphone, hear you, timing, ready, home');

  // ---- (b0) the kv latency record ---------------------------------------------------------------------------------------------
  const latency = await page(`const all = await sr.repos.calibrations.all(); const k = 'native:latency:' + all[0].routeKey; return { key: k, record: (await sr.kv.get(k)) ?? null, keys: (await sr.kv.keys()).filter((x) => x.startsWith('native:latency:')) };`);
  R.measurements.latencyRecord = latency;
  log(`     ${latency.key}: ${JSON.stringify(latency.record)}`);
  check(latency.record !== null && latency.keys.length === 1, 'the kv latency record exists after calibration, for the one route');
  check(latency.record?.profile === expectedProfile, `the latency record says profile ${expectedProfile} (${latency.record?.profile})`);
  check(typeof latency.record?.measuredMs === 'number' && typeof latency.record?.at === 'string' && ['A', 'B', 'C'].includes(latency.record?.trust) && 'predictedMs' in (latency.record ?? {}), 'the latency record has predictedMs, measuredMs, trust and at');
  check(latency.record?.predictedMs === null || typeof latency.record?.predictedMs === 'number', `predictedMs is a number or null (${latency.record?.predictedMs}, trust ${latency.record?.trust})`);

  // ---- (b) the stored calibration ----------------------------------------------------------------------------------------
  const cals = await page(`return await sr.repos.calibrations.all();`);
  check(cals.length === 1 && typeof cals[0].roundTripMs === 'number', `one calibration is stored for the route (${cals.length})`);
  const rtl = cals[0].roundTripMs;
  const errs = runs.map((c) => c.roundTripMs - loopMs);
  const stats = { runs: runs.length, valuesMs: runs.map((c) => c.roundTripMs), madInRunMs: runs.map((c) => c.madMs ?? null), errorMs: errs, meanErrorMs: errs.reduce((a, b) => a + b, 0) / errs.length, minMs: Math.min(...runs.map((c) => c.roundTripMs)), maxMs: Math.max(...runs.map((c) => c.roundTripMs)), expectedMs: loopMs, stored: cals[0] };
  R.measurements.calibration = stats;
  log(`     calibration over ${runs.length} runs: ${stats.valuesMs.map((v) => v.toFixed(3)).join(', ')} ms (expected ${loopMs}); in-run MAD ${stats.madInRunMs.map((v) => v?.toFixed(3)).join(', ')} ms`);
  // The app's own calibration (src/calibration, shared with the web build and not changed here) reads 0.1 to 0.4 ms
  // early on an ideal capture; its unit tests and the web e2e gate at 1 ms, so this does too. The native loopback
  // measurement below is held to 0.3 ms against the true delay.
  check(errs.every((e) => Math.abs(e) <= 1.0), `every stored roundTripMs is ${loopMs} +/- 1.0 ms (errors ${errs.map((e) => e.toFixed(3)).join(', ')})`);

  if (scenario !== 'main') {
    await finish(null);
    process.exit(R.failures.length > 0 ? 1 : 0);
  }

  // ---- (c) backend.measureLoopback() from the page -------------------------------------------------------------------------
  const lbs = [];
  for (let i = 0; i < 3; i++) lbs.push(await page(`return await sr.audio.measureLoopback();`));
  R.measurements.pageLoopback = lbs;
  const lbMs = lbs.map((l) => l.roundTripMs);
  log(`     measureLoopback x3: ${lbs.map((l) => `${l.roundTripMs?.toFixed(3)} (mad ${l.madMs?.toFixed(3)}, ${l.found}/${l.scheduled}, snr ${l.snrDb?.toFixed(1)})`).join('; ')}`);
  check(lbs.every((l) => l.roundTripMs !== null && l.found === l.scheduled), 'measureLoopback found every click, three times');
  check(lbMs.every((v) => Math.abs(v - rtl) <= 1.0), `measureLoopback agrees with the stored calibration within 1.0 ms (${lbMs.map((v) => (v - rtl).toFixed(3)).join(', ')})`);
  check(lbMs.every((v) => Math.abs(v - loopMs) <= 0.3), `measureLoopback is ${loopMs} +/- 0.3 ms`);

  // ---- (d) one synthetic try -------------------------------------------------------------------------------------------------
  await click('Practice', 'the Practice mode', { scope: '[data-testid="screen-home"] [data-setup-row="mode"]', role: 'radio' });
  await sleep(200);
  await shot('home-practice');
  await click('Start practice', 'Start practice', { prefix: true });
  await waitFor(testid('scan-cover'), 'the cover', 30000);
  await shot('cover');
  await click('Show the music', 'Show the music', { prefix: true });
  await waitFor(`document.querySelector('[data-testid="screen-practice.scan"]')?.dataset.state === 'scanning'`, 'the read-through', 15000);
  await waitFor(`document.querySelector('[data-expected-idx]')`, 'the notation', 30000);
  await waitFor(`document.fonts.check('30pt Bravura')`, 'the notation font', 15000);
  await sleep(500);
  await shot('scan');
  const plan = await page(`const p = sr.session.plan; return { instrumentId: p.inst.id, bpm: p.bpm, beatsPerBar: p.beatsPerBar, endSec: p.endSec, expected: p.expected, excerptId: sr.session.prepared.excerptId, levelServed: sr.session.prepared.levelServed };`);
  writeFileSync(join(workDir, 'plan.json'), JSON.stringify(plan));
  R.measurements.plan = { excerptId: plan.excerptId, instrumentId: plan.instrumentId, bpm: plan.bpm, notes: plan.expected.length, endSec: plan.endSec, levelServed: plan.levelServed };
  log(`     excerpt ${plan.excerptId} at ${plan.bpm} bpm, ${plan.expected.length} notes, ${plan.endSec.toFixed(1)} s`);
  const LEAD_SEC = 0.5;
  const metaRaw = execFileSync('pnpm', ['exec', 'tsx', 'tools/native/make-synth-input.ts', 'take', '--plan', sig('plan.json'), '--out', sig('take.f32'), '--lead', String(LEAD_SEC), '--meta', sig('take-meta.json')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  const meta = JSON.parse(metaRaw.toString());
  R.measurements.synth = meta;

  await page(`sr.audio.resetPacketDelays(); window.__e2e.faults.length = 0;`);
  const before = await page(`return sr.audio.voiceStats();`);
  await click('Start playing', 'Start playing', { prefix: true });
  await waitFor(`${testid('screen-practice.play')}`, 'the play screen', 15000);
  const clock = await waitFor(`window.__sr.session.takeClock && JSON.stringify(window.__sr.session.takeClock)`, 'the take clock', 15000).then(JSON.parse);
  const nowSec = (await invoke('audio_clock_sync')).engineSec;
  const startSec = clock.t0 + rtl / 1000 - LEAD_SEC;
  check(startSec > nowSec + 0.15, `the take's performance can still be placed: t0 ${clock.t0.toFixed(3)} s, engine now ${nowSec.toFixed(3)} s, ${(startSec - nowSec).toFixed(3)} s ahead`);
  await invoke('audio_debug_signal', { path: sig('take.f32'), engineSec: startSec });
  R.measurements.take = { t0: clock.t0, bpm: clock.bpm, countInBeats: clock.countInBeats, rtlMsUsed: rtl, fileStartEngineSec: startSec, leadSec: LEAD_SEC };
  await shot('count-in');
  await waitFor(`document.querySelector('[data-testid="screen-practice.play"]')?.dataset.state === 'performing'`, 'performing', 30000);
  await sleep(Math.max(1000, (plan.endSec * 1000) / 2));
  await shot('performing');
  await waitFor(testid('results-panel'), 'the results', (plan.endSec + 40) * 1000);
  await waitFor(`${testid('results-panel')}.dataset.state === 'graded'`, 'a graded result', 20000);
  await sleep(500);
  await shot('results');
  const rec = await page(`const r = sr.session.record; return r && { id: r.id, excerptId: r.excerptId, bpm: r.bpm, score: r.score, judgments: r.judgments, extras: r.extras, calibration: r.calibration ?? null };`);
  writeFileSync(join(outDir, 'main-try-record.json'), JSON.stringify(rec, null, 2));
  check(rec && rec.score && typeof rec.score.score === 'number', `the try reached the results screen with a score: ${rec?.score?.score} ${rec?.score?.grade}`);
  const wrongIdx = meta.wrongIdx;
  const wrong = rec.judgments.find((j) => j.expectedIdx === wrongIdx);
  check(wrong && wrong.status === 'matched' && wrong.pitch === 'wrong-pitch', `the note played 2 semitones sharp (#${wrongIdx}) is matched as wrong-pitch (${JSON.stringify(wrong && { status: wrong.status, pitch: wrong.pitch, timing: wrong.timing })})`);
  R.measurements.result = {
    score: rec.score.score,
    grade: rec.score.grade,
    components: rec.score.components,
    ranked: rec.score.ranked,
    extras: rec.extras.length,
    judgments: rec.judgments.map((j) => ({ idx: j.expectedIdx, status: j.status, timing: j.timing, pitch: j.pitch, timingErrorMs: j.timingErrorMs })),
  };
  log(`     result: score ${rec.score.score} ${rec.score.grade}, ${rec.judgments.filter((j) => j.status === 'matched').length}/${rec.judgments.length} matched, ${rec.extras.length} extras`);

  // ---- (f) capture health during the try -------------------------------------------------------------------------------------
  const after = await page(`return { stats: sr.audio.voiceStats(), capture: sr.audio.captureStats(), delays: Array.from(sr.audio.packetDelaysMs()), faults: window.__e2e.faults, interruptions: window.__e2e.interruptions };`);
  const d = after.delays;
  R.measurements.delivery = { packets: d.length, p50Ms: pct(d, 0.5), p99Ms: pct(d, 0.99), maxMs: d.length ? Math.max(...d) : null, minMs: d.length ? Math.min(...d) : null };
  R.measurements.health = { faults: after.faults, interruptions: after.interruptions, xruns: after.stats.xruns - before.xruns, capture: after.capture, voices: { ...after.stats } };
  log(`     packet delivery delay over ${d.length} packets: p50 ${R.measurements.delivery.p50Ms?.toFixed(2)} ms, p99 ${R.measurements.delivery.p99Ms?.toFixed(2)} ms, max ${R.measurements.delivery.maxMs?.toFixed(2)} ms`);
  check(d.length > 100, `packets were delivered during the try (${d.length})`);
  check(after.faults.length === 0, `no capture-gap or backlog fault during the try (${JSON.stringify(after.faults)})`);
  check(after.stats.xruns - before.xruns === 0, `no xrun during the try (${after.stats.xruns - before.xruns})`);
  check(after.capture.droppedBlocks === 0, `no dropped capture blocks (${after.capture.droppedBlocks}, max queue ${after.capture.maxQueueMs.toFixed(1)} ms)`);
  check(after.stats.rejected - before.rejected === 0 && after.stats.late - before.late === 0, `no rejected or late voice during the try (rejected ${after.stats.rejected - before.rejected}, late ${after.stats.late - before.late})`);

  // ---- (e) Listen with a sampled instrument set, metronome previews --------------------------------------------------------
  await click('Next piece', 'Next piece', { prefix: true });
  await waitFor(testid('scan-cover'), 'the next cover', 30000);
  await click('Show the music', 'Show the music', { prefix: true });
  await waitFor(`document.querySelector('[data-testid="screen-practice.scan"]')?.dataset.state === 'scanning'`, 'the next read-through', 15000);
  await waitFor(`document.querySelector('[data-expected-idx]')`, 'the notation', 30000);
  const l0 = await page(`return sr.audio.voiceStats();`);
  await click('Listen', 'Listen', { timeoutMs: 15000, prefix: true });
  await waitFor(`window.__sr.audio.voiceStats().voices > ${l0.voices}`, 'Listen voices to be scheduled', 20000);
  await sleep(700);
  await shot('listen');
  await waitFor(`window.__sr.audio.voiceStats().ended >= window.__sr.audio.voiceStats().voices`, 'every Listen voice to end', 90000);
  const l2 = await page(`return { stats: sr.audio.voiceStats(), flute: sr.audio.soundState('flute') };`);
  R.measurements.listen = { scheduled: l2.stats.voices - l0.voices, ended: l2.stats.ended - l0.ended, rejected: l2.stats.rejected - l0.rejected, late: l2.stats.late - l0.late, uploads: l2.stats.uploads - l0.uploads, soundSet: l2.flute };
  log(`     Listen: ${R.measurements.listen.scheduled} voices scheduled, ${R.measurements.listen.ended} ended, rejected ${R.measurements.listen.rejected}, late ${R.measurements.listen.late}, flute set ${JSON.stringify(l2.flute)}`);
  check(R.measurements.listen.scheduled > 10 && R.measurements.listen.ended === R.measurements.listen.scheduled, 'Listen: every scheduled voice ended');
  check(R.measurements.listen.rejected === 0, 'Listen: no rejected voice');
  check(JSON.stringify(l2.flute).includes('ready'), `Listen used the sampled set (state ${JSON.stringify(l2.flute)})`);

  await sync(`location.hash = '#/settings/audio';`);
  await waitFor(`document.querySelector('[aria-label="Play a bar of Classic"]')`, 'the sound settings', 20000);
  await shot('settings-sound');
  const previews = {};
  for (const sound of ['Classic', 'Woodblock', 'Beep']) {
    const p0 = await page(`return sr.audio.voiceStats();`);
    await click(`Play a bar of ${sound}`, `preview ${sound}`);
    await waitFor(`window.__sr.audio.voiceStats().voices > ${p0.voices}`, `${sound} voices`, 10000);
    await waitFor(`window.__sr.audio.voiceStats().ended >= window.__sr.audio.voiceStats().voices`, `${sound} to end`, 20000);
    const p1 = await page(`return sr.audio.voiceStats();`);
    previews[sound] = { scheduled: p1.voices - p0.voices, ended: p1.ended - p0.ended, rejected: p1.rejected - p0.rejected };
    check(previews[sound].scheduled > 0 && previews[sound].ended === previews[sound].scheduled && previews[sound].rejected === 0, `metronome preview ${sound}: ${JSON.stringify(previews[sound])}`);
  }
  R.measurements.previews = previews;
  await shot('settings-previews');

  const pageErrors = await sync(`return window.__e2e.errors`);
  R.measurements.pageErrors = pageErrors;
  check(pageErrors.length === 0, `no page error, unhandled rejection or console.error (${JSON.stringify(pageErrors.slice(0, 3))})`);
  const hooksOff = await invoke('audio_debug_signal', { path: null, engineSec: 0 }).then(() => true, () => false);
  check(hooksOff, 'debug hook still answers while enabled');
  await finish(null);
} catch (e) {
  await finish(e);
}
