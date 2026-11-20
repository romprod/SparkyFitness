import {
  BUNDLE_CHECK_INTERVAL_MS,
  entryScriptFromHtml,
  installBundleHeartbeat,
  shouldReloadForBundle,
} from '@/utils/bundleHeartbeat';

const page = (entry: string) =>
  `<html><head><script type="module" crossorigin src="${entry}"></script>` +
  `<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-abc.js"></head></html>`;

describe('entryScriptFromHtml', () => {
  it('finds the hashed module entry', () => {
    expect(entryScriptFromHtml(page('/assets/index-AAA.js'))).toBe(
      '/assets/index-AAA.js'
    );
  });
  it('returns null for a page with no built entry', () => {
    expect(entryScriptFromHtml('<script src="/src/main.tsx"></script>')).toBe(
      null
    );
    expect(entryScriptFromHtml('<html>maintenance</html>')).toBeNull();
  });
});

describe('shouldReloadForBundle', () => {
  it('reloads only for a different, not-yet-tried entry', () => {
    expect(shouldReloadForBundle('/a.js', '/b.js', null)).toBe(true);
    expect(shouldReloadForBundle('/a.js', '/a.js', null)).toBe(false);
    expect(shouldReloadForBundle('/a.js', '/b.js', '/b.js')).toBe(false);
    expect(shouldReloadForBundle('/a.js', null, null)).toBe(false);
    expect(shouldReloadForBundle(null, '/b.js', null)).toBe(false);
  });
});

describe('installBundleHeartbeat', () => {
  const setup = (served: string, stored: string | null = null) => {
    document.head.innerHTML =
      '<script type="module" src="/assets/index-OLD.js"></script>';
    const store = new Map<string, string>(
      stored ? [['sparkyfitness:bundle-reloaded-for', stored]] : []
    );
    let t = 0;
    const reload = jest.fn();
    const fetchHtml = jest.fn(async () => page(served));
    const stop = installBundleHeartbeat({
      fetchHtml,
      reload,
      now: () => t,
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
      },
    });
    return { reload, fetchHtml, stop, advance: (ms: number) => (t += ms) };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('reloads once when the site serves a newer bundle', async () => {
    const h = setup('/assets/index-NEW.js');
    await flush();
    expect(h.reload).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('does not reload when the bundle is current or already tried', async () => {
    const same = setup('/assets/index-OLD.js');
    await flush();
    expect(same.reload).not.toHaveBeenCalled();
    same.stop();
    const tried = setup('/assets/index-NEW.js', '/assets/index-NEW.js');
    await flush();
    expect(tried.reload).not.toHaveBeenCalled();
    tried.stop();
  });

  it('checks again when the app returns to the foreground, not more than once a minute', async () => {
    const h = setup('/assets/index-OLD.js');
    await flush();
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(h.fetchHtml).toHaveBeenCalledTimes(1);
    h.advance(BUNDLE_CHECK_INTERVAL_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(h.fetchHtml).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('does nothing on a page without a built entry (development)', async () => {
    document.head.innerHTML =
      '<script type="module" src="/src/main.tsx"></script>';
    const fetchHtml = jest.fn();
    installBundleHeartbeat({ fetchHtml, reload: jest.fn() });
    await flush();
    expect(fetchHtml).not.toHaveBeenCalled();
  });
});
