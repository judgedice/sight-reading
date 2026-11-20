/** IndexedDB implementation of `StoreRepos` and `KeyValue` (01 section 11). Database `srt`, version 1, via `idb`. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppSettings, AttemptQuery, AttemptRecord, AttemptSummary, Calibration, JsonValue, PlayerProfile } from '../../../core/types.ts';
import type { KeyValue, StoreRepos } from '../../../core/platform.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { summarizeAttempt } from '../../../store/summary.ts';
import { KV_SETTINGS } from '../../../store/keys.ts';
import { normaliseSettings } from '../../../store/settings-read.ts';

export const DB_NAME = 'srt';
export const DB_VERSION = 1;
/** `debug` payloads on attempts are dropped after this many days (01 section 11). */
export const DEBUG_RETENTION_DAYS = 7;

interface SrtDb extends DBSchema {
  profile: { key: string; value: PlayerProfile };
  attempts: {
    key: string;
    value: AttemptRecord;
    indexes: { byTime: string; byExcerpt: string; byInstrument: string };
  };
  calibrations: { key: string; value: Calibration };
  kv: { key: string; value: JsonValue };
}

type Db = IDBPDatabase<SrtDb>;

/** One step per version; `oldVersion` 0 means a new database. Never edit a shipped step; add the next one. */
function upgrade(db: Db, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('profile', { keyPath: 'id' });
    const attempts = db.createObjectStore('attempts', { keyPath: 'id' });
    attempts.createIndex('byTime', 'createdAt');
    attempts.createIndex('byExcerpt', 'excerptId');
    attempts.createIndex('byInstrument', 'instrumentId');
    db.createObjectStore('calibrations', { keyPath: 'routeKey' });
    db.createObjectStore('kv');
  }
}

function matches(a: AttemptRecord, q: AttemptQuery): boolean {
  if (q.instrumentId !== undefined && a.instrumentId !== q.instrumentId) return false;
  if (q.excerptId !== undefined && a.excerptId !== q.excerptId) return false;
  if (q.rankedOnly && !(a.score?.ranked ?? false)) return false;
  // An attempt without `kind` is an excerpt (stored before scales existed, PLAN ruling 68).
  if (q.kind !== undefined && (a.kind ?? 'excerpt') !== q.kind) return false;
  if (q.from !== undefined && a.createdAt < q.from) return false;
  if (q.to !== undefined && a.createdAt > q.to) return false;
  return true;
}

export class IdbKeyValue implements KeyValue {
  constructor(private readonly db: Db) {}
  async get(key: string): Promise<JsonValue | undefined> {
    return this.db.get('kv', key);
  }
  async set(key: string, value: JsonValue): Promise<void> {
    await this.db.put('kv', value, key);
  }
  async delete(key: string): Promise<void> {
    await this.db.delete('kv', key);
  }
  async keys(): Promise<string[]> {
    return this.db.getAllKeys('kv');
  }
}

export class IdbRepos implements StoreRepos {
  constructor(private readonly db: Db) {}

  readonly profile: StoreRepos['profile'] = {
    get: async () => (await this.db.getAll('profile'))[0],
    // One profile per device: replace whatever is there.
    put: async (p) => {
      const tx = this.db.transaction('profile', 'readwrite');
      await tx.store.clear();
      await tx.store.put(p);
      await tx.done;
    },
  };

  readonly attempts: StoreRepos['attempts'] = {
    add: async (a) => {
      await this.db.add('attempts', a);
    },
    recent: async (n) => {
      const out: AttemptRecord[] = [];
      if (n <= 0) return out;
      let cur = await this.db.transaction('attempts').store.index('byTime').openCursor(null, 'prev');
      while (cur && out.length < n) {
        out.push(cur.value);
        cur = await cur.continue();
      }
      return out;
    },
    byId: async (id) => this.db.get('attempts', id),
    list: async (q) => {
      if (q.from !== undefined && q.to !== undefined && q.from > q.to) return [];
      const range =
        q.from !== undefined && q.to !== undefined
          ? IDBKeyRange.bound(q.from, q.to)
          : q.from !== undefined
            ? IDBKeyRange.lowerBound(q.from)
            : q.to !== undefined
              ? IDBKeyRange.upperBound(q.to)
              : null;
      const out: AttemptSummary[] = [];
      let skip = q.offset ?? 0;
      const limit = q.limit ?? Infinity;
      let cur = await this.db.transaction('attempts').store.index('byTime').openCursor(range, 'prev');
      while (cur && out.length < limit) {
        if (matches(cur.value, q)) {
          if (skip > 0) skip -= 1;
          else out.push(summarizeAttempt(cur.value));
        }
        cur = await cur.continue();
      }
      return out;
    },
    all: async () => this.db.getAllFromIndex('attempts', 'byTime'),
  };

  readonly calibrations: StoreRepos['calibrations'] = {
    get: async (routeKey) => this.db.get('calibrations', routeKey),
    put: async (c) => {
      await this.db.put('calibrations', c);
    },
    all: async () => this.db.getAll('calibrations'),
  };

  readonly settings: StoreRepos['settings'] = {
    /** Older records read with the round-2 defaults and the player's metronome sound (settings-read.ts). */
    get: async () => {
      const v = await this.db.get('kv', KV_SETTINGS);
      return v === undefined ? defaultAppSettings() : normaliseSettings(v as unknown as AppSettings);
    },
    put: async (s) => {
      await this.db.put('kv', s as unknown as JsonValue, KV_SETTINGS);
    },
  };

  async clearAll(): Promise<void> {
    const tx = this.db.transaction(['profile', 'attempts', 'calibrations', 'kv'], 'readwrite');
    await Promise.all([tx.objectStore('profile').clear(), tx.objectStore('attempts').clear(), tx.objectStore('calibrations').clear(), tx.objectStore('kv').clear()]);
    await tx.done;
  }

  /** Removes `debug` from attempts older than the retention window. Returns how many were changed. */
  async pruneDebug(nowIso: string): Promise<number> {
    const cutoff = new Date(Date.parse(nowIso) - DEBUG_RETENTION_DAYS * 86_400_000).toISOString();
    const tx = this.db.transaction('attempts', 'readwrite');
    let n = 0;
    let cur = await tx.store.index('byTime').openCursor(IDBKeyRange.upperBound(cutoff, true));
    while (cur) {
      if (cur.value.debug !== undefined) {
        const { debug: _debug, ...rest } = cur.value;
        await cur.update(rest);
        n += 1;
      }
      cur = await cur.continue();
    }
    await tx.done;
    return n;
  }
}

export interface OpenedStore {
  repos: IdbRepos;
  kv: IdbKeyValue;
  close(): void;
}

/** Opens (and creates or upgrades) the database. Uses the global `indexedDB`. */
export async function openStore(name: string = DB_NAME): Promise<OpenedStore> {
  const db = await openDB<SrtDb>(name, DB_VERSION, { upgrade: (d, old) => upgrade(d, old) });
  return { repos: new IdbRepos(db), kv: new IdbKeyValue(db), close: () => db.close() };
}
