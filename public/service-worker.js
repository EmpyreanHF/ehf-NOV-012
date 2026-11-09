/* =============================================================================
   EMPYREAN INTERNATIONAL — service-worker.js
   RETIRED (2026-08-04). Registered by app-patch-v44-v45.js.

   WHY THIS WAS RETIRED
   The stale-while-revalidate offline cache below was masking every fresh
   deploy behind an old cached copy of the app's JS — confirmed as the cause
   of the admin Media Migration button (and, per this codebase's own patch
   history, other fixes before it) appearing to "do nothing" on the live
   domain while working fine everywhere the service worker was never
   installed (localhost, a fresh device, etc.). Given this app changes daily
   and is tested primarily on a device that had the OLD service worker
   already installed, the cost (fresh code silently not reaching the person
   testing it) outweighs the benefit (offline app-shell access) for now.

   THE ACTUAL PROBLEM WITH JUST DELETING THIS FILE OR ITS <script> TAG
   A service worker that is ALREADY installed on someone's device keeps
   running independently of what the rest of the code does next — it does
   not go away just because app-patch-v44-v45.js stops calling
   navigator.serviceWorker.register(). Every returning visitor who already
   has the old version of THIS file installed needs to be served something
   that actively tells their browser to remove it. That's what this file is
   now: instead of the old install/fetch/activate caching logic, every
   currently-installed copy of this exact file (any version) will, the next
   time the browser does its normal periodic service-worker update check,
   fetch these new bytes, install them, and immediately unregister itself
   and delete every cache it created — a self-destructing final version,
   not a deleted one. Once enough time has passed that no meaningful
   fraction of visitors could still be running the old cached version, this
   file (and the registration call in app-patch-v44-v45.js) can be deleted
   outright — not yet, per this codebase's no-deletion convention, and
   because deleting it now would mean an already-registered SW that never
   gets replaced (a 404 on next update-check just means the browser keeps
   running whatever it already has installed).

   WHAT THIS FILE DOES NOW
     - install:  skipWaiting() immediately — don't wait for old tabs to close.
     - activate: delete every cache this service worker (any prior version)
                 ever created, unregister this registration entirely, then
                 tell every currently-controlled page to do a ONE-TIME hard
                 reload so that page immediately starts fetching everything
                 straight from the network instead of through a (now
                 unregistered) worker.
     - fetch:    no handler at all — every request goes straight to the
                 network, exactly as if no service worker were installed.
                 (Technically redundant once unregister() has run, but kept
                 as a safety net for the brief window between activate
                 firing and the unregistration actually taking effect.)

   app-patch-v44-v45.js's own registration call and reload-on-controller-
   change listener are commented out as of this same session — see that
   file's own note at the same spot — so no NEW installs of any service
   worker happen going forward. This file only exists to clean up
   installs that already happened before that change shipped.
   ============================================================================= */

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
            .then(() => self.registration.unregister())
            .then(() => self.clients.matchAll({ type: 'window' }))
            .then((clients) => {
                clients.forEach((client) => client.navigate(client.url));
            })
    );
});

// No 'fetch' listener — every request passes straight through to the
// network, as if this worker weren't here at all.