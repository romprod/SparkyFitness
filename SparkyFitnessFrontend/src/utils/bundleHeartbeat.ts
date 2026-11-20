/**
 * Installed web apps can stay resumed for days without a page load, so a new release is not picked
 * up until something forces a reload. This compares the entry script this page is running with the
 * one the site's index page now names, and reloads once when they differ.
 *
 * The entry file name carries a content hash, so it changes exactly when the bundle does, and no
 * server change is needed.
 */

const RELOADED_KEY = 'sparkyfitness:bundle-reloaded-for';
export const BUNDLE_CHECK_INTERVAL_MS = 60_000;

const ENTRY_RE =
  /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']*\/assets\/[^"']+\.js)["']/i;

/** The hashed entry script an index page loads, or null when it names none. */
export function entryScriptFromHtml(html: string): string | null {
  return ENTRY_RE.exec(html)?.[1] ?? null;
}

/** Reload only when the site names a different entry than the running one, once per served entry. */
export function shouldReloadForBundle(
  running: string | null,
  served: string | null,
  lastReloadedFor: string | null
): boolean {
  if (!running || !served) return false;
  if (running === served) return false;
  return served !== lastReloadedFor;
}

function runningEntry(doc: Document): string | null {
  for (const script of Array.from(
    doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')
  )) {
    const src = script.getAttribute('src') ?? '';
    if (/\/assets\/[^/]+\.js$/.test(src)) return src;
  }
  return null;
}

/** Start watching; returns a function that stops. Does nothing outside a built page. */
export function installBundleHeartbeat(
  env: {
    doc?: Document;
    fetchHtml?: () => Promise<string>;
    reload?: () => void;
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
    now?: () => number;
  } = {}
): () => void {
  const doc = env.doc ?? document;
  const running = runningEntry(doc);
  if (!running) return () => undefined;
  const fetchHtml =
    env.fetchHtml ??
    (async () => {
      const res = await fetch('/', { cache: 'no-store' });
      if (!res.ok) throw new Error(`index ${res.status}`);
      return res.text();
    });
  const reload = env.reload ?? (() => window.location.reload());
  const now = env.now ?? Date.now;
  let storage = env.storage;
  if (storage === undefined) {
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
  }
  let lastCheck = -Infinity;
  let stopped = false;

  const check = async () => {
    const t = now();
    if (t - lastCheck < BUNDLE_CHECK_INTERVAL_MS) return;
    lastCheck = t;
    try {
      const served = entryScriptFromHtml(await fetchHtml());
      let reloadedFor: string | null = null;
      try {
        reloadedFor = storage?.getItem(RELOADED_KEY) ?? null;
      } catch {
        /* storage unavailable */
      }
      if (!stopped && shouldReloadForBundle(running, served, reloadedFor)) {
        try {
          storage?.setItem(RELOADED_KEY, served as string);
        } catch {
          /* storage unavailable: the page can reload at most once per load anyway */
        }
        reload();
      }
    } catch {
      // Offline or a transient failure: the next return to the app tries again.
    }
  };
  const onVisible = () => {
    if (doc.visibilityState === 'visible') void check();
  };
  void check();
  doc.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    doc.removeEventListener('visibilitychange', onVisible);
  };
}
