/**
 * firebase-messaging-sw.js — Empyrean
 * ─────────────────────────────────────────────────────────────────────────
 * Background handler for FCM Web Push. Runs in its own service-worker
 * scope (no access to window/DOM), which is why the Firebase config below
 * is read from the registration URL's query string instead of fetching
 * /api/config or importing app-state.js — see app-push-setup.js, which
 * registers this worker with those params attached.
 *
 * Must be served from the SITE ROOT (public/firebase-messaging-sw.js →
 * https://yourapp.onrender.com/firebase-messaging-sw.js) even though it's
 * registered at a narrow scope (/firebase-cloud-messaging-push-scope, set
 * in app-push-setup.js) rather than "/" — that narrow scope is deliberate,
 * so this doesn't collide with the app's existing service-worker.js
 * (offline app-shell caching, registered at root). The file must still
 * physically live at the root URL path for the browser to fetch it at all;
 * only the *scope option* passed at registration is narrow, not its location.
 */
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

var params = new URLSearchParams(self.location.search);

firebase.initializeApp({
    apiKey:            params.get('apiKey'),
    authDomain:        params.get('authDomain'),
    projectId:         params.get('projectId'),
    storageBucket:     params.get('storageBucket'),
    messagingSenderId: params.get('messagingSenderId'),
    appId:             params.get('appId')
});

var messaging = firebase.messaging();

// Background messages (app closed / tab not focused) land here. Foreground
// messages (app open) are instead handled by messaging.onMessage() in
// app-push-setup.js, which routes them into the in-app bell/toast — this
// handler only fires when that page-level listener ISN'T active.
messaging.onBackgroundMessage(function(payload) {
    var n = payload.notification || {};
    var title = n.title || 'Empyrean';
    var options = {
        body: n.body || '',
        // FIX (2026-08-24 — "Empyrean logo doesn't show in the offline
        // push notification"): pointed at /logo.png, an asset this app
        // never actually guarantees exists (not referenced by
        // manifest.json or the <link rel="icon"> favicon, unlike
        // icon-192.png, which both of those hard-require on every
        // deploy). Standardized on the verified-present asset — matches
        // the same fix applied to every push-building function in
        // server.js. This code path only runs for a data-only FCM message
        // anyway (a payload with a top-level `notification` field, which
        // every server.js push already sends, is auto-displayed by the
        // browser using its own webpush.notification fields and never
        // reaches this handler at all) — kept in sync regardless, so a
        // future data-only push doesn't silently regress back to the
        // missing file.
        icon: '/icon-192.png',          // small branding glyph
        image: n.image || '/icon-192.png', // big expanded picture — the rich thumbnail
        badge: '/icon-192.png',         // status-bar/header glyph next to app name — always the Empyrean logo
        // FEATURE (birthday feature — "Wish Happy Birthday"/"Send Gift" CTA
        // buttons): forwarded through as-is when the server included them
        // (see server.js's _sendBirthdayPushToFollowers). Harmless no-op
        // for every other push type, which never sets this field. Browser
        // support for notification action buttons varies (mainly Chrome
        // desktop/Android) — tapping the notification body itself (not a
        // specific action) still opens the same deep link on every
        // platform, so this is a pure enhancement, never a requirement.
        actions: n.actions || undefined,
        data: Object.assign(
            {},
            payload.data || {}, // carries type/birthdayUserId/etc. through to notificationclick below
            payload.fcmOptions && payload.fcmOptions.link ? { link: payload.fcmOptions.link } : {}
        )
    };
    self.registration.showNotification(title, options);
});

// Clicking the notification focuses an existing tab if one is open,
// otherwise opens a new one at the post's deep link.
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    var link = (event.notification.data && event.notification.data.link) || '/';
    // FEATURE (birthday feature — CTA buttons): event.action is the id of
    // whichever action button was tapped ('wish'/'gift' for a birthday
    // push, '' for a tap on the notification body itself). Appended as a
    // query param so app-startup.js's existing boot-time deep-link handler
    // can auto-open the right thing once the page loads — same "one deep
    // link URL, interpreted by whatever's already listening for it"
    // pattern every other notification type in this app already uses.
    if (event.action) {
        link += (link.indexOf('?') === -1 ? '?' : '&') + 'action=' + encodeURIComponent(event.action);
    }
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (var i = 0; i < clientList.length; i++) {
                if ('focus' in clientList[i]) { clientList[i].navigate(link); return clientList[i].focus(); }
            }
            if (clients.openWindow) return clients.openWindow(link);
        })
    );
});