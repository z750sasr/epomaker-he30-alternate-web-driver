(() => {
  const script = new URL(document.currentScript.src);
  const current = script.searchParams.get('rev');
  const manifest = new URL('driver-version.json', script);
  let checking = false;

  async function check() {
    if (checking || document.hidden || document.documentElement.hasAttribute('data-driver-busy')) return;
    checking = true;
    try {
      // A unique URL also bypasses a CDN response cached before the deploy.
      manifest.searchParams.set('check', Date.now());
      const response = await fetch(manifest, {cache: 'no-store'});
      if (!response.ok) return;
      const {revision} = await response.json();
      if (revision === current || !/^[0-9a-f]{7,40}$/.test(revision) || document.documentElement.hasAttribute('data-driver-busy')) return;
      const next = new URL(location.href);
      if (next.searchParams.get('rev') === revision) return;
      next.searchParams.set('rev', revision);
      location.replace(next);
    } catch {
      // The current driver remains available during a failed version check.
    } finally {
      checking = false;
    }
  }

  document.addEventListener('visibilitychange', check);
  setInterval(check, 30_000);
  check();
})();
