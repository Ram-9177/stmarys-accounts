/**
 * Print documents render inside fully sandboxed iframes (opaque origin), which may not
 * load images from the app's origin (and production sends Cross-Origin-Resource-Policy:
 * same-origin). So logos are inlined as data: URLs. They are fetched once and cached.
 */
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function absolute(url: string): string {
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

/** Fetches a logo and caches it as a data: URL. Falls back to the absolute URL on failure. */
export function ensureLogo(url: string): Promise<string> {
  const abs = absolute(url);
  const hit = cache.get(abs);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(abs);
  if (!p) {
    p = fetch(abs, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
          }),
      )
      .then((dataUrl) => {
        cache.set(abs, dataUrl);
        return dataUrl;
      })
      .catch(() => abs)
      .finally(() => pending.delete(abs));
    pending.set(abs, p);
  }
  return p;
}

/** Synchronous lookup for builders: the cached data: URL if ready, else the absolute URL. */
export function inlineLogo(url: string): string {
  return cache.get(absolute(url)) ?? absolute(url);
}

/** Warm the cache at startup so the first print preview already has the logos. */
export function preloadLogos(urls: string[]): void {
  for (const u of urls) void ensureLogo(u);
}
