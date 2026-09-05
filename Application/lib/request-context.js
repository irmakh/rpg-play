/**
 * Per-request campaign context.
 *
 * Every request runs inside an AsyncLocalStorage store holding the campaign it
 * belongs to and that campaign's database handles. The proxies below then let
 * ~200 existing route handlers keep calling `ldb.listCharacters()` and
 * `broadcast(...)` exactly as written while resolving to the right campaign at
 * call time — including across `await`, which AsyncLocalStorage propagates.
 *
 * Why proxies rather than passing a db into every handler: route modules
 * destructure their dependencies once, at register() time
 * (`const { ldb } = ctx`). A plain object or a getter would freeze one
 * campaign's handle into the closure forever. A Proxy defers resolution to the
 * property access inside the handler, which happens per request.
 *
 * The proxies throw when touched outside a request. That is deliberate: a
 * missing context must be a loud failure, never a silent read from the wrong
 * campaign.
 */
import { AsyncLocalStorage } from 'async_hooks';

export const requestContext = new AsyncLocalStorage();

export function currentStore() {
  return requestContext.getStore() || null;
}

export function currentCampaignId() {
  const s = requestContext.getStore();
  return s ? s.campaignId : null;
}

export function currentCampaign() {
  const s = requestContext.getStore();
  return s ? s.campaign : null;
}

function currentData(what) {
  const s = requestContext.getStore();
  if (!s || !s.data) {
    throw new Error(
      `No campaign in context while accessing ${what}. ` +
      'Every request that touches campaign data must run inside ' +
      'requestContext.run() — see the campaign middleware in server.js.'
    );
  }
  return s.data;
}

/**
 * Builds a proxy that forwards every property access to whatever `pick`
 * returns for the current request. Functions are bound so better-sqlite3
 * statements and database handles keep their receiver.
 */
function scopedProxy(pick, label) {
  return new Proxy(Object.create(null), {
    get(_t, prop) {
      if (prop === Symbol.toStringTag) return label;
      const target = pick(currentData(label));
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(_t, prop)  { return prop in pick(currentData(label)); },
    ownKeys()      { return Reflect.ownKeys(pick(currentData(label))); },
    getOwnPropertyDescriptor(_t, prop) {
      const d = Reflect.getOwnPropertyDescriptor(pick(currentData(label)), prop);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

/** Core campaign data (characters, table, treasury, monsters, calendar, ...). */
export const ldb = scopedProxy(d => d.ldb, 'ldb');
/** Stories / comic builder. */
export const sdb = scopedProxy(d => d.sdb, 'sdb');
/** AI DM sessions. */
export const adb = scopedProxy(d => d.adb, 'adb');
/** Raw better-sqlite3 handle for the campaign's shared-media database. */
export const mediaDb = scopedProxy(d => d.mdb.db, 'mediaDb');
/** Prepared statement: fetch one shared-media row by id. */
export const mediaGet = scopedProxy(d => d.mdb.mediaGet, 'mediaGet');
/** Prepared statement: upsert the table map blob. */
export const mapUpsert = scopedProxy(d => d.mdb.mapUpsert, 'mapUpsert');

export function insertSharedMedia(id, mimeType, buf) {
  return currentData('insertSharedMedia').mdb.insertSharedMedia(id, mimeType, buf);
}
