(function() {
'use strict';

/* ── FIX (2026-07-21): ECHO + FROZEN-TAP GUARD ──────────────────────────
   ROOT CAUSE (confirmed, not guessed): this whole file is one IIFE that
   registers ~12 document-level click listeners plus module-scoped Agora
   client variables (agoraClient/agoraViewerClient), and its startup path
   (onReady() below) runs its callback IMMEDIATELY and synchronously any
   time document.readyState is already past 'loading' — which is exactly
   the case whenever the live preview/dev-reload tooling re-injects this
   same script into an already-loaded page without a real navigation
   (the same re-execution behavior app-patch-v35.js already documented
   for a different, cosmetic symptom — see that file's Issue #3). Each
   re-execution: (a) creates a BRAND NEW agoraClient/agoraViewerClient
   from scratch (the old ones' JS references are wiped by re-running this
   IIFE, but their underlying Agora WebSocket connections are NOT closed,
   since the page itself never unloaded) — so every prior host/guest join
   stays connected and still publishing, and every viewer in the channel
   now hears N overlapping copies of the same mic track, a few hundred ms
   apart — exactly the reported "echoing like 5 times"; and (b) adds a
   FRESH copy of every one of this file's ~12 document-level click
   listeners on top of the previous copies, so a single real tap fires
   the same handler chain N times over, each doing its own DOM/Firestore/
   Agora work — exactly the reported "tapping wasn't responding" once
   enough copies had piled up.
   FIX: a page-lifetime (not module-scoped) flag on `window`, so it
   survives this exact re-execution scenario and makes every step below
   — Agora client setup, all click listeners — run at most ONCE per real
   page load, matching the same idempotency guard already used
   successfully elsewhere in this codebase (app-patch-v30/31/33/35/37/38).
   A genuine full page reload/navigation resets `window` entirely, so
   normal usage is completely unaffected. */
if (window.__empLiveJsInitialized) {
    console.warn('[app-live.js] Already initialized this page load — skipping duplicate re-execution (prevents duplicate Agora clients causing echo, and duplicate click listeners causing frozen taps).');
    return;
}
window.__empLiveJsInitialized = true;

/* ─────────────────────────────────────────────
   PART 0 — GLOBAL closest() SCOPE FIX
   All secondary event listeners that used the
   inner `closest` helper now use e.target.closest
   directly, which is always available.
───────────────────────────────────────────── */
window._agoraAvailable = (typeof AgoraRTC !== 'undefined');

// ============================================================
// LIVE STREAM ENHANCEMENTS: Fullscreen + Swipe navigation
// ============================================================
(function() {
    var activeLiveStreams = []; // registry of live sessions for swipe nav

    // Register a live session so swipe can navigate between them
    window.registerLiveSession = function(streamId, hostName, channelName) {
        if (!activeLiveStreams.find(s => s.streamId === streamId)) {
            activeLiveStreams.push({ streamId, hostName, channelName });
        }
    };

    // Fullscreen toggle for live player
    window.toggleLiveFullscreen = function(containerEl) {
        const el = containerEl || document.getElementById('live-player-container') || document.getElementById('live-stream-player');
        if (!el) return;
        if (!document.fullscreenElement) {
            el.requestFullscreen && el.requestFullscreen();
            el.webkitRequestFullscreen && el.webkitRequestFullscreen();
            el.style.borderRadius = '0';
        } else {
            document.exitFullscreen && document.exitFullscreen();
            el.style.borderRadius = '';
        }
    };

    // Swipe-up/down to navigate live sessions
    var _swipeStartY = 0;
    var _currentLiveIdx = 0;
    var _swipeLocked = false;

    function setupLiveSwipe(container) {
        if (!container || container._liveSwipeBound) return;
        container._liveSwipeBound = true;

        container.addEventListener('touchstart', function(e) {
            _swipeStartY = e.touches[0].clientY;
        }, { passive: true });

        container.addEventListener('touchend', function(e) {
            if (_swipeLocked) return;
            var deltaY = _swipeStartY - e.changedTouches[0].clientY;
            if (Math.abs(deltaY) < 50) return; // minimum swipe distance
            _swipeLocked = true;
            setTimeout(() => { _swipeLocked = false; }, 800);

            if (deltaY > 0) {
                // Swipe UP — next stream
                _currentLiveIdx = Math.min(_currentLiveIdx + 1, activeLiveStreams.length - 1);
            } else {
                // Swipe DOWN — previous stream
                _currentLiveIdx = Math.max(_currentLiveIdx - 1, 0);
            }
            var next = activeLiveStreams[_currentLiveIdx];
            if (next && typeof window.joinLiveAsViewer === 'function') {
                window.joinLiveAsViewer(next.channelName, next.hostName);
                if (typeof window.showNotification === 'function') {
                    window.showNotification('Now watching: ' + next.hostName, 'info');
                }
            }
        }, { passive: true });
    }

    // Attach swipe when live player appears
    document.addEventListener('DOMContentLoaded', function() {
        var liveContainer = document.getElementById('live-player-container') || document.getElementById('go-live');
        if (liveContainer) setupLiveSwipe(liveContainer);

        // Also add fullscreen button when stream starts
        document.addEventListener('click', function(e) {
            var fsBtn = e.target.closest('#live-fullscreen-btn, .live-fullscreen-btn');
            if (fsBtn) {
                var container = fsBtn.closest('.live-player-wrapper, #live-player-container, section#go-live');
                window.toggleLiveFullscreen(container);
            }
        });
    });

    // Auto-setup swipe when live section becomes active
    var _liveMutObs = new MutationObserver(function(muts) {
        muts.forEach(function(m) {
            m.addedNodes.forEach(function(n) {
                if (n.nodeType === 1) {
                    var lp = n.id === 'live-player-container' ? n : n.querySelector && n.querySelector('#live-player-container');
                    if (lp) setupLiveSwipe(lp);
                }
            });
        });
    });
    document.addEventListener('DOMContentLoaded', function() {
        _liveMutObs.observe(document.body, { childList: true, subtree: true });
    });
})();

/* ─────────────────────────────────────────────
   PART 1 — ADMIN TAB NAVIGATION
───────────────────────────────────────────── */
function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
}

onReady(function() {
  // DIAGNOSTIC WRAP ("publishLiveStreamToFirestore is not defined at
  // go-live time"): everything in this file from here down — including
  // window.publishLiveStreamToFirestore itself — is defined inside this
  // one onReady() callback. If ANY line in here throws synchronously
  // before reaching that definition, the callback aborts right there and
  // every function meant to be defined after the crash (including the
  // publish function) simply never gets created — with zero error output,
  // because nothing was catching it. This try/catch doesn't change any
  // behavior when things work; it only makes a real startup crash visible
  // (full message + stack) instead of silent, so the exact broken line can
  // be found and fixed directly instead of guessed at.
  try {

    // Admin tab switching
    document.addEventListener('click', function(e) {
        const tab = e.target.closest('.admin-nav-tab');
        if (!tab) return;
        const targetId = tab.dataset.tab;
        if (!targetId) return;

        // Update tab button styles
        document.querySelectorAll('.admin-nav-tab').forEach(function(t) {
            t.style.background = 'transparent';
            t.style.color = 'var(--text-muted)';
        });
        tab.style.background = 'var(--g-navy)';
        tab.style.color = 'white';

        // Show/hide tab content
        document.querySelectorAll('.admin-tab-content').forEach(function(c) {
            c.style.display = 'none';
        });
        const target = document.getElementById(targetId);
        if (target) target.style.display = 'block';

        // If users tab opened, populate table
        if (targetId === 'admin-users-tab') {
            populateAdminUsersTable();
        }
    });

    /* ─────────────────────────────────────────────
       PART 2 — AUDIT LOG SYSTEM
    ───────────────────────────────────────────── */
    window.empyreanAuditLog = window.empyreanAuditLog || [];

    window.logAdminAction = function(action, targetUser, details) {
        const entry = {
            timestamp: new Date().toLocaleString(),
            admin: (window.userState && window.userState.email) || 'admin@empyrean.com',
            action: action,
            targetUser: targetUser || '—',
            details: details || ''
        };
        window.empyreanAuditLog.unshift(entry);

        /* BUG FIX: this used to persist to Firestore AFTER an early
           `if (!tbody) return;` guarded on the Admin Panel's own Audit
           Log table being present in the DOM. That table only exists
           while an admin actually has the Admin Panel's Audit Log tab
           open — so any call to this function from anywhere else (e.g.
           a regular member deleting their own group, which routes
           through this same function purely to get an audit trail) was
           silently discarded before ever reaching the Firestore write
           below. The persist step is now unconditional; only the live
           DOM-table update (which has nothing to attach to when that
           tab isn't open) stays gated on the element existing. */
        try {
            if (window.fbDb) {
                window.fbDb.collection('admin_audit_log').add(entry).catch(function() {});
            }
        } catch(e) {}

        const tbody = document.getElementById('admin-audit-log-body');
        if (!tbody) return;

        // Remove empty state row
        const emptyRow = tbody.querySelector('td[colspan="5"]');
        if (emptyRow) emptyRow.closest('tr').remove();

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(10,14,39,0.05)';
        tr.innerHTML = `
            <td style="padding:12px 16px;font-size:0.82rem;color:var(--text-muted);white-space:nowrap;">${entry.timestamp}</td>
            <td style="padding:12px 16px;font-size:0.82rem;font-weight:600;color:var(--secondary);">${entry.admin}</td>
            <td style="padding:12px 16px;font-size:0.82rem;">
                <span style="background:rgba(27,43,139,0.08);color:var(--secondary);padding:3px 10px;border-radius:8px;font-weight:600;font-size:0.78rem;">${entry.action}</span>
            </td>
            <td style="padding:12px 16px;font-size:0.82rem;color:var(--primary);">${entry.targetUser}</td>
            <td style="padding:12px 16px;font-size:0.82rem;color:var(--text-muted);">${entry.details}</td>
        `;
        tbody.prepend(tr);
    };

    /* ─────────────────────────────────────────────
       PART 3 — ADMIN USER MANAGEMENT
    ───────────────────────────────────────────── */
    function getAllUsers() {
        const users = [];
        const seen = new Set();
        // From mockUsers
        if (window.mockUsers) {
            Object.values(window.mockUsers).forEach(function(u) {
                if (u && u.id && !seen.has(u.id)) {
                    seen.add(u.id);
                    users.push(u);
                }
            });
        }
        // From registeredUsers
        if (window.registeredUsers) {
            Object.values(window.registeredUsers).forEach(function(u) {
                if (u && u.id && !seen.has(u.id)) {
                    seen.add(u.id);
                    users.push(u);
                }
            });
        }
        return users;
    }

    function renderUserDetailPanel(user) {
        const panel = document.getElementById('admin-user-detail-panel');
        const content = document.getElementById('admin-user-detail-content');
        if (!panel || !content) return;

        const isBlocked = user._blocked || false;
        content.innerHTML = `
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;flex-wrap:wrap;">
                <img src="${user.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.fullName||'U') + '&background=1B2B8B&color=fff&size=80'}"
                     style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid var(--accent);"
                     onerror="this.src='https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=80'">
                <div style="flex:1;">
                    <h3 style="margin:0 0 4px;color:var(--primary);">${user.fullName || 'Unknown'}</h3>
                    <p style="margin:0;color:var(--text-muted);font-size:0.88rem;">@${user.username || '—'} · ${user.email || '—'}</p>
                    <p style="margin:4px 0 0;font-size:0.82rem;">
                        <span style="background:rgba(27,43,139,0.08);color:var(--secondary);padding:2px 10px;border-radius:20px;font-weight:700;">
                            ${user.uniqueId || user.id || 'No ID'}
                        </span>
                        ${user.isVerified ? '<span style="background:rgba(16,185,129,0.1);color:#059669;padding:2px 10px;border-radius:20px;font-weight:600;margin-left:6px;">✓ Verified</span>' : ''}
                        ${isBlocked ? '<span style="background:rgba(239,68,68,0.1);color:var(--danger-color);padding:2px 10px;border-radius:20px;font-weight:600;margin-left:6px;">🔒 Blocked</span>' : ''}
                    </p>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px;">
                <div style="background:rgba(10,14,39,0.03);border-radius:14px;padding:14px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:800;color:var(--accent);">${(user.empyBalance||0).toLocaleString()}</div>
                    <div style="font-size:0.78rem;color:var(--text-muted);">EMPY Balance</div>
                </div>
                <div style="background:rgba(10,14,39,0.03);border-radius:14px;padding:14px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:800;color:var(--secondary);">${(user.followerCount||0).toLocaleString()}</div>
                    <div style="font-size:0.78rem;color:var(--text-muted);">Followers</div>
                </div>
                <div style="background:rgba(10,14,39,0.03);border-radius:14px;padding:14px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:800;color:var(--accent2);">${user.isVerified ? 'KYC ✓' : 'Unverified'}</div>
                    <div style="font-size:0.78rem;color:var(--text-muted);">KYC Status</div>
                </div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button onclick="adminActionUnblock('${user.id}')" style="background:rgba(16,185,129,0.1);color:#059669;border:1.5px solid rgba(16,185,129,0.3);padding:9px 18px;border-radius:12px;cursor:pointer;font-weight:600;font-size:0.85rem;">
                    <i class="fas fa-unlock"></i> ${isBlocked ? 'Unblock' : 'Block'} Account
                </button>
                <button onclick="adminActionVerify('${user.id}')" style="background:rgba(27,43,139,0.08);color:var(--secondary);border:1.5px solid rgba(27,43,139,0.2);padding:9px 18px;border-radius:12px;cursor:pointer;font-weight:600;font-size:0.85rem;">
                    <i class="fas fa-check-circle"></i> ${user.isVerified ? 'Remove Verification' : 'Mark Verified'}
                </button>
                <button onclick="adminActionResetPassword('${user.id}','${user.email}')" style="background:rgba(245,197,24,0.1);color:#92700a;border:1.5px solid rgba(245,197,24,0.3);padding:9px 18px;border-radius:12px;cursor:pointer;font-weight:600;font-size:0.85rem;">
                    <i class="fas fa-key"></i> Reset Password
                </button>
                <button onclick="adminActionAdjustBalance('${user.id}')" style="background:rgba(239,68,68,0.08);color:var(--danger-color);border:1.5px solid rgba(239,68,68,0.2);padding:9px 18px;border-radius:12px;cursor:pointer;font-weight:600;font-size:0.85rem;">
                    <i class="fas fa-coins"></i> Adjust Balance
                </button>
            </div>
        `;
        panel.style.display = 'block';
    }

    window.adminActionUnblock = function(userId) {
        const users = getAllUsers();
        const user = users.find(function(u) { return u.id === userId; });
        if (!user) return;
        user._blocked = !user._blocked;
        const action = user._blocked ? 'BLOCK_ACCOUNT' : 'UNBLOCK_ACCOUNT';
        window.logAdminAction(action, user.fullName + ' (' + (user.email||'') + ')', 'Account ' + (user._blocked ? 'blocked' : 'unblocked'));
        renderUserDetailPanel(user);
        if (typeof window.showNotification === 'function') {
            window.showNotification('Account ' + (user._blocked ? 'blocked' : 'unblocked') + ' for ' + user.fullName, user._blocked ? 'error' : 'success');
        }
    };

    window.adminActionVerify = function(userId) {
        const users = getAllUsers();
        const user = users.find(function(u) { return u.id === userId; });
        if (!user) return;
        user.isVerified = !user.isVerified;
        window.logAdminAction(user.isVerified ? 'VERIFY_USER' : 'UNVERIFY_USER', user.fullName + ' (' + (user.email||'') + ')', 'KYC status changed');
        renderUserDetailPanel(user);
        try {
            if (window.fbDb && user.id) window.fbDb.collection('users').doc(user.id).update({ isVerified: user.isVerified }).catch(function(){});
        } catch(e) {}
        if (typeof window.showNotification === 'function') {
            window.showNotification((user.isVerified ? '✅ Verified' : 'Verification removed for') + ' ' + user.fullName, 'success');
        }
    };

    window.adminActionResetPassword = function(userId, email) {
        if (!email) { if (typeof window.showNotification === 'function') window.showNotification('No email on file.', 'error'); return; }
        try {
            if (window.fbAuth && typeof window.fbAuth.sendPasswordResetEmail === 'function') {
                window.fbAuth.sendPasswordResetEmail(email).then(function() {
                    window.logAdminAction('RESET_PASSWORD', email, 'Password reset email sent');
                    if (typeof window.showNotification === 'function') window.showNotification('Password reset email sent to ' + email, 'success');
                }).catch(function(e) {
                    if (typeof window.showNotification === 'function') window.showNotification('Failed: ' + e.message, 'error');
                });
            } else {
                window.logAdminAction('RESET_PASSWORD', email, 'Reset requested (offline mode)');
                if (typeof window.showNotification === 'function') window.showNotification('Password reset logged (Firebase offline).', 'info');
            }
        } catch(e) {
            if (typeof window.showNotification === 'function') window.showNotification('Error: ' + e.message, 'error');
        }
    };

    window.adminActionAdjustBalance = function(userId) {
        const users = getAllUsers();
        const user = users.find(function(u) { return u.id === userId; });
        if (!user) return;
        const amount = parseFloat(prompt('Enter EMPY adjustment (+ to add, - to deduct):\nCurrent balance: ' + (user.empyBalance||0)));
        if (isNaN(amount)) return;
        user.empyBalance = Math.max(0, (user.empyBalance||0) + amount);
        window.logAdminAction('ADJUST_BALANCE', user.fullName + ' (' + (user.email||'') + ')', (amount > 0 ? '+' : '') + amount + ' EMPY → new balance: ' + user.empyBalance);
        renderUserDetailPanel(user);
        // Sync if this is current user
        if (window.userState && window.userState.id === userId) {
            window.userState.empyBalance = user.empyBalance;
            if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
        }
        try {
            if (window.fbDb && userId) window.fbDb.collection('users').doc(userId).update({ empyBalance: user.empyBalance }).catch(function(){});
        } catch(e) {}
        if (typeof window.showNotification === 'function') window.showNotification('Balance adjusted to ' + user.empyBalance + ' EMPY', 'success');
    };

    function populateAdminUsersTable() {
        const tbody = document.getElementById('admin-all-users-table');
        const badge = document.getElementById('admin-total-users-badge');
        if (!tbody) return;
        const users = getAllUsers();
        if (badge) badge.textContent = users.length + ' user' + (users.length !== 1 ? 's' : '');
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">No registered users yet.</td></tr>';
            return;
        }
        tbody.innerHTML = users.map(function(u) {
            return `<tr style="border-bottom:1px solid rgba(10,14,39,0.05);transition:background 0.15s;" onmouseenter="this.style.background='rgba(27,43,139,0.03)'" onmouseleave="this.style.background=''">
                <td style="padding:12px 16px;font-size:0.78rem;font-weight:700;color:var(--secondary);white-space:nowrap;">${u.uniqueId || u.id || '—'}</td>
                <td style="padding:12px 16px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <img src="${u.avatar||'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=40'}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" onerror="this.src='https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=40'">
                        <div>
                            <div style="font-weight:600;font-size:0.88rem;color:var(--primary);">${u.fullName||'—'}</div>
                            <div style="font-size:0.78rem;color:var(--text-muted);">@${u.username||'—'}</div>
                        </div>
                    </div>
                </td>
                <td style="padding:12px 16px;font-size:0.82rem;color:var(--text-muted);">${u.email||'—'}</td>
                <td style="padding:12px 16px;font-size:0.85rem;font-weight:700;color:var(--accent);">${(u.empyBalance||0).toLocaleString()} EMPY</td>
                <td style="padding:12px 16px;">
                    <span style="font-size:0.78rem;padding:3px 10px;border-radius:20px;font-weight:600;background:${u.isVerified?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.08)'};color:${u.isVerified?'#059669':'var(--danger-color)'};">
                        ${u.isVerified ? '✓ Verified' : 'Unverified'}
                    </span>
                </td>
                <td style="padding:12px 16px;">
                    <span style="font-size:0.78rem;padding:3px 10px;border-radius:20px;font-weight:600;background:${u._blocked?'rgba(239,68,68,0.08)':'rgba(16,185,129,0.1)'};color:${u._blocked?'var(--danger-color)':'#059669'};">
                        ${u._blocked ? '🔒 Blocked' : '✓ Active'}
                    </span>
                </td>
                <td style="padding:12px 16px;">
                    <button onclick="(function(){var users=window.mockUsers&&Object.values(window.mockUsers).concat(window.registeredUsers?Object.values(window.registeredUsers):[]);var u=users.find(function(x){return x&&x.id==='${u.id}'});if(u)renderUserDetailPanelGlobal(u);})()" style="background:var(--g-navy);color:white;border:none;padding:6px 14px;border-radius:10px;cursor:pointer;font-size:0.78rem;font-weight:600;">View</button>
                </td>
            </tr>`;
        }).join('');
    }

    window.renderUserDetailPanelGlobal = renderUserDetailPanel;

    // Admin user search
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#admin-user-search-btn')) return;
        const query = (document.getElementById('admin-user-search-input') || {}).value || '';
        const type = (document.getElementById('admin-user-search-type') || {}).value || 'all';
        const resultsEl = document.getElementById('admin-user-search-results');
        if (!resultsEl) return;
        if (!query.trim()) { resultsEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.88rem;">Enter a search term above.</p>'; return; }

        const q = query.trim().toLowerCase();
        const users = getAllUsers();
        const matches = users.filter(function(u) {
            if (!u) return false;
            if (type === 'id' || type === 'all') {
                if ((u.uniqueId||'').toLowerCase().includes(q) || (u.id||'').toLowerCase().includes(q)) return true;
            }
            if (type === 'username' || type === 'all') {
                if ((u.username||'').toLowerCase().includes(q)) return true;
            }
            if (type === 'email' || type === 'all') {
                if ((u.email||'').toLowerCase().includes(q)) return true;
            }
            return false;
        });

        if (matches.length === 0) {
            resultsEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);"><i class="fas fa-search" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:10px;"></i>No users found matching "' + query + '"</div>';
            return;
        }

        resultsEl.innerHTML = '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;">' + matches.length + ' result(s) found</p>' +
            matches.map(function(u) {
                return `<div style="display:flex;align-items:center;gap:12px;padding:12px;border:1.5px solid rgba(10,14,39,0.08);border-radius:14px;margin-bottom:8px;cursor:pointer;transition:all 0.2s;" onmouseenter="this.style.background='rgba(27,43,139,0.04)'" onmouseleave="this.style.background=''" onclick="renderUserDetailPanelGlobal(${JSON.stringify(u).replace(/"/g,'&quot;')})">
                    <img src="${u.avatar||'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=48'}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.src='https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=48'">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;color:var(--primary);font-size:0.92rem;">${u.fullName||'—'}</div>
                        <div style="font-size:0.8rem;color:var(--text-muted);">@${u.username||'—'} · ${u.email||'—'}</div>
                        <div style="font-size:0.76rem;color:var(--secondary);font-weight:600;margin-top:2px;">${u.uniqueId||u.id||'No ID'}</div>
                    </div>
                    <span style="font-size:0.78rem;padding:4px 12px;border-radius:20px;font-weight:600;background:${u.isVerified?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.08)'};color:${u.isVerified?'#059669':'var(--danger-color)'};">
                        ${u.isVerified?'Verified':'Unverified'}
                    </span>
                </div>`;
            }).join('');

        // Auto-show detail for single result
        if (matches.length === 1) renderUserDetailPanel(matches[0]);
        window.logAdminAction('USER_SEARCH', query, 'Type: ' + type + ' · ' + matches.length + ' result(s)');
    });

    /* ─────────────────────────────────────────────
       PART 4 — PROFILE PAGE POST UPLOAD
       Posts from profile appear in dashboard feed too
    ───────────────────────────────────────────── */
    let profilePostMediaFiles = [];

    document.addEventListener('change', function(e) {
        if (!e.target.closest('#profile-post-media-input')) return;
        /* FIX (2026-10-07): app-profile.js's composer owns this input — see the
           matching note there. Without this, this legacy preview rewrote the real
           one and kept a second, separate file list that later got uploaded too. */
        if (window._empProfileComposerOwnsPost) return;
        profilePostMediaFiles = Array.from(e.target.files);
        const preview = document.getElementById('profile-post-media-preview');
        if (!preview) return;
        preview.innerHTML = '';

        var count = profilePostMediaFiles.length;
        // Premium multi-image grid layout
        preview.style.display = 'grid';
        preview.style.gap = '4px';
        preview.style.borderRadius = '14px';
        preview.style.overflow = 'hidden';
        preview.style.marginBottom = '12px';
        if (count === 1) preview.style.gridTemplateColumns = '1fr';
        else if (count === 2) preview.style.gridTemplateColumns = '1fr 1fr';
        else if (count === 3) preview.style.gridTemplateColumns = '2fr 1fr';
        else preview.style.gridTemplateColumns = '1fr 1fr';

        profilePostMediaFiles.forEach(function(file, idx) {
            var url = URL.createObjectURL(file);
            var div = document.createElement('div');
            div.style.cssText = 'position:relative;overflow:hidden;background:#000;height:' + (count===1?'220':'160') + 'px;';
            if (count === 3 && idx === 0) div.style.gridRow = '1 / 3';
            if (count > 4 && idx === 3) {
                div.innerHTML = '<div style="width:100%;height:100%;background:rgba(10,14,39,0.7);display:flex;align-items:center;justify-content:center;color:white;font-size:1.6rem;font-weight:800;">+' + (count-4) + '</div>';
            } else if (idx < 4) {
                div.innerHTML = file.type.startsWith('video/')
                    ? '<video src="' + url + '" style="width:100%;height:100%;object-fit:cover;" muted playsinline></video>'
                    : '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
            }
            if (idx < 4) {
                // Remove button
                var rmBtn = document.createElement('button');
                rmBtn.type = 'button';
                rmBtn.style.cssText = 'position:absolute;top:5px;right:5px;background:rgba(239,68,68,0.85);border:none;color:white;border-radius:50%;width:22px;height:22px;font-size:0.75rem;cursor:pointer;z-index:3;display:flex;align-items:center;justify-content:center;';
                rmBtn.innerHTML = '&times;';
                (function(i){ rmBtn.addEventListener('click', function() {
                    profilePostMediaFiles.splice(i, 1);
                    // Re-trigger preview re-render
                    var fakeEvt = new Event('change');
                    var inp = document.getElementById('profile-post-media-input');
                    if (inp) { var dt = new DataTransfer(); profilePostMediaFiles.forEach(function(f){dt.items.add(f);}); try{inp.files=dt.files;}catch(ex){} }
                    div.remove();
                }); })(idx);
                div.appendChild(rmBtn);
                preview.appendChild(div);
            }
        });
    });

    // Profile page retweet button
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#profile-retweet-btn')) return;
        var feedContainer = document.getElementById('feed-container');
        if (!feedContainer) return;
        var latestPost = feedContainer.querySelector('.impact-story:not(.sos-request)');
        if (!latestPost) {
            if (typeof window.showNotification === 'function') window.showNotification('No posts to retweet yet.', 'info');
            return;
        }
        var originalAuthorEl = latestPost.querySelector('.story-user-info strong');
        var originalAuthor = originalAuthorEl ? originalAuthorEl.textContent.trim() : 'Unknown';
        var originalContentEl = latestPost.querySelector('.story-content p, .story-content');
        var originalText = originalContentEl ? originalContentEl.textContent.trim() : '';
        var retweetText = '🔁 Retweeted from @' + originalAuthor + ': ' + originalText.substring(0, 120) + (originalText.length > 120 ? '…' : '');
        var textEl = document.getElementById('profile-post-text');
        var titleEl = document.getElementById('profile-post-title');
        if (textEl) textEl.value = retweetText;
        if (titleEl) titleEl.value = 'Retweet';
        if (typeof window.showNotification === 'function') window.showNotification('Post tweet to publish retweet.', 'info');
        document.getElementById('profile-post-text')?.focus();
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('#profile-post-submit-btn')) return;
        /* FIX (2026-10-07 — duplicate profile post): app-profile.js binds its own
           click handler directly on this button and does the real upload + post.
           This legacy delegated handler ran as well, uploading every file a second
           time and publishing a second, simplified card (4-tile grid, "+N" tile,
           no engagement bar). Stand down whenever app-profile.js's composer is live;
           this code remains as the fallback if that composer never rendered. */
        if (window._empProfileComposerOwnsPost) return;
        const textEl = document.getElementById('profile-post-text');
        const text = textEl ? textEl.value.trim() : '';
        if (!text && profilePostMediaFiles.length === 0) {
            if (typeof window.showNotification === 'function') window.showNotification('Write something or add media first.', 'error');
            return;
        }
        if (window.isGuest) {
            if (typeof window.showNotification === 'function') window.showNotification('Please log in to post.', 'error');
            return;
        }

        const btn = e.target.closest('#profile-post-submit-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';

        (async function() {
            try {
                let mediaUrls = [];
                if (profilePostMediaFiles.length > 0) {
                    if (typeof window.showNotification === 'function') window.showNotification('Uploading media...', 'info');
                    for (let i = 0; i < profilePostMediaFiles.length; i++) {
                        try {
                            const url = await window.uploadToCloudinary(profilePostMediaFiles[i], null);
                            profilePostMediaFiles[i]._cloudUrl = url;
                            mediaUrls.push({ url: url, type: profilePostMediaFiles[i].type });
                        } catch(uploadErr) {
                            console.warn('Profile media upload failed:', uploadErr.message);
                            mediaUrls.push({ url: URL.createObjectURL(profilePostMediaFiles[i]), type: profilePostMediaFiles[i].type });
                        }
                    }
                }

                const us = window.userState || {};
                const postData = {
                    id: 'post-' + Date.now(),
                    text: text,
                    media: mediaUrls,
                    userId: us.id,
                    username: us.fullName || us.username,
                    avatar: us.avatar || '',
                    createdAt: new Date().toISOString(),
                    likeCount: 0,
                    commentCount: 0
                };

                // Create post element and inject into BOTH dashboard feed and profile feed
                // Build post card HTML directly using resolved cloud URLs
                // This guarantees media appears in ALL feeds without waiting for File reads
                (function injectPostIntoFeeds() {
                    var ts = new Date().toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
                    var avatarSrc = us.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(us.fullName||'U') + '&background=1B2B8B&color=fff&size=52');

                    // Build media HTML from resolved URLs
                    var mediaHtml = '';
                    if (mediaUrls.length > 0) {
                        var count = mediaUrls.length;
                        var gridStyle = count === 1 ? 'grid-template-columns:1fr;' :
                                        count === 2 ? 'grid-template-columns:1fr 1fr;' :
                                        count === 3 ? 'grid-template-columns:2fr 1fr;' :
                                                      'grid-template-columns:1fr 1fr;';
                        mediaHtml = '<div class="story-media-container" style="display:grid;' + gridStyle + 'gap:3px;border-radius:12px;overflow:hidden;margin:8px 0;">';
                        mediaUrls.forEach(function(m, idx) {
                            if (idx >= 4) return;
                            var url = m.url || m;
                            var isVid = (m.type && m.type.startsWith('video/')) || /\.(mp4|webm|mov)(\?|$)/i.test(url);
                            var itemStyle = 'overflow:hidden;' + (count === 1 ? 'height:280px;' : 'height:180px;') + (count === 3 && idx === 0 ? 'grid-row:1/3;' : '');
                            if (isVid) {
                                mediaHtml += '<div style="' + itemStyle + '"><video src="' + url + '" style="width:100%;height:100%;object-fit:cover;" controls muted playsinline></video></div>';
                            } else {
                                mediaHtml += '<div style="' + itemStyle + '"><img src="' + url + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy"></div>';
                            }
                        });
                        if (mediaUrls.length > 4) {
                            mediaHtml += '<div style="height:180px;background:rgba(10,14,39,0.7);display:flex;align-items:center;justify-content:center;color:white;font-size:1.4rem;font-weight:800;">+' + (mediaUrls.length - 4) + '</div>';
                        }
                        mediaHtml += '</div>';
                    }

                    var postHtml =
                        '<div class="impact-story" data-post-id="' + postData.id + '" data-user-id="' + us.id + '" style="margin-bottom:16px;">' +
                            '<div class="story-header" style="display:flex;align-items:center;gap:10px;padding:12px 16px 0;">' +
                                '<div class="avatar-placeholder" style="width:42px;height:42px;border-radius:50%;overflow:hidden;flex-shrink:0;cursor:pointer;">' +
                                    '<img src="' + avatarSrc + '" style="width:100%;height:100%;object-fit:cover;">' +
                                '</div>' +
                                '<div class="story-user-info">' +
                                    '<strong style="display:block;">' + (us.fullName||us.username||'You') + '</strong>' +
                                    '<span style="font-size:0.75rem;color:var(--text-muted);">' + ts + '</span>' +
                                '</div>' +
                            '</div>' +
                            (text ? '<div class="story-content" style="padding:10px 16px;">' + text + '</div>' : '') +
                            (mediaHtml ? '<div style="padding:0 16px;">' + mediaHtml + '</div>' : '') +
                            '<div class="story-actions">' +
                                '<a class="action-btn like-btn" title="Like"><i class="far fa-heart"></i><span class="like-count">0</span></a>' +
                                '<a class="action-btn comment-btn" title="Comment"><i class="far fa-comment"></i><span class="comment-count">0</span></a>' +
                                '<a class="action-btn share-btn" title="Share"><svg style="vertical-align:-3px;margin-right:2px;" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>' +
                                '<a class="action-btn download-media-btn" title="Download"><i class="fas fa-download"></i></a>' +
                                '<span class="action-btn view-count-display" style="margin-left:auto;color:var(--text-muted);font-size:0.72rem;pointer-events:none;display:flex;align-items:center;gap:3px;"><i class="fas fa-eye"></i><span class="view-count">0</span></span>' +
                            '</div>' +
                            '<div class="comment-section"><div class="comment-list"></div><form class="comment-form" novalidate><input type="text" name="comment-text" placeholder="Add a comment..." required><button type="submit"><i class="fas fa-paper-plane"></i></button></form></div>' +
                        '</div>';

                    function makePostEl() {
                        var tmp = document.createElement('div');
                        tmp.innerHTML = postHtml;
                        return tmp.firstElementChild;
                    }

                    // Inject into main dashboard feed
                    var dashFeed = document.getElementById('feed-container');
                    if (dashFeed) {
                        var emptyState = document.getElementById('feed-empty-state');
                        if (emptyState) emptyState.style.display = 'none';
                        dashFeed.prepend(makePostEl());
                    }

                    // Inject into profile dashboard tab (shows immediately, same session)
                    var profileDashFeed = document.getElementById('profile-dash-feed');
                    if (profileDashFeed) {
                        var pdEmpty = profileDashFeed.querySelector('.empty-state, p');
                        if (pdEmpty) pdEmpty.remove();
                        profileDashFeed.prepend(makePostEl());
                    }

                    // Inject into profile posts tab
                    var profilePostsFeed = document.getElementById('profile-posts-feed');
                    if (profilePostsFeed) {
                        var ppEmpty = document.getElementById('profile-posts-empty');
                        if (ppEmpty) ppEmpty.style.display = 'none';
                        profilePostsFeed.prepend(makePostEl());
                    }

                    // Update profile gallery immediately
                    var gallery = document.getElementById('profile-gallery');
                    /* Videos tab = videos only; photos go to the Pictures tab. */
                    var _vidMedia = mediaUrls.filter(function(m) {
                        var u = m.url || m;
                        var v = (m.type && m.type.startsWith('video/')) || /\.(mp4|webm|mov)(\?|$)/i.test(u);
                        if (!v && typeof window._empAddPictureToProfile === 'function') window._empAddPictureToProfile(u);
                        return v;
                    });
                    if (gallery && _vidMedia.length > 0) {
                        var gEmpty = gallery.querySelector('p');
                        if (gEmpty) gEmpty.remove();
                        _vidMedia.forEach(function(m) {
                            var url = m.url || m;
                            var isVid = (m.type && m.type.startsWith('video/')) || /\.(mp4|webm|mov)(\?|$)/i.test(url);
                            var gi = document.createElement('div');
                            gi.style.cssText = 'aspect-ratio:1;border-radius:10px;overflow:hidden;cursor:pointer;';
                            gi.innerHTML = isVid
                                ? '<video src="' + url + '" style="width:100%;height:100%;object-fit:cover;" muted playsinline></video>'
                                : '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
                            gallery.prepend(gi);
                        });
                    }
                })();

                // Save to Firestore (real Firebase required for cross-device sync)
                if (!window._firebaseLoaded) {
                    await new Promise(function(resolve) {
                        var t = setInterval(function() { if(window._firebaseLoaded){clearInterval(t);resolve();} }, 500);
                        setTimeout(function(){clearInterval(t);resolve();}, 10000);
                    });
                }
                try {
                    if (window.fbDb && window._firebaseLoaded) {
                        var safePost = {
                            id: postData.id,
                            userId: postData.userId,
                            username: postData.username,
                            avatar: postData.avatar,
                            text: postData.text,
                            media: mediaUrls.filter(function(m){ var u=m.url||m; return u&&!u.startsWith('blob:'); }).map(function(m){ return m.url||m; }),
                            createdAt: postData.createdAt
                        };
                        await window.fbDb.collection('posts').doc(postData.id).set(safePost);
                        console.log('[Profile Post] ✅ Saved to Firestore — visible on ALL devices:', postData.id);
                    }
                } catch(fsErr) {
                    console.error('[Profile Post] ❌ Firestore save failed:', fsErr.message);
                    setTimeout(async function() {
                        try { if(window.fbDb&&window._firebaseLoaded) await window.fbDb.collection('posts').doc(postData.id).set({id:postData.id,userId:postData.userId,username:postData.username,text:postData.text,media:mediaUrls.filter(m=>!(m.url||m).startsWith('blob:')).map(m=>m.url||m),createdAt:postData.createdAt}); } catch(e2) {}
                    }, 3000);
                }

                // Reset form
                if (textEl) textEl.value = '';
                profilePostMediaFiles = [];
                const preview = document.getElementById('profile-post-media-preview');
                if (preview) preview.innerHTML = '';
                const fileInput = document.getElementById('profile-post-media-input');
                if (fileInput) fileInput.value = '';

                if (typeof window.showNotification === 'function') window.showNotification('✅ Posted! Your post is now live on your profile and dashboard.', 'success');
                // Update gallery tab with newly uploaded media
                if (typeof window.populateProfileGallery === 'function' && window.userState) {
                    setTimeout(function() { window.populateProfileGallery(window.userState.id); }, 100);
                }
                // Rewarduser for posting
                if (typeof window.rewardUserForAction === 'function') window.rewardUserForAction('CREATE_POST');
            } catch(err) {
                console.error('Profile post error:', err);
                if (typeof window.showNotification === 'function') window.showNotification('Post failed: ' + (err.message||'try again'), 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-paper-plane"></i> Post';
            }
        })();
    });

    /* ═══════════════════════════════════════════════════════════════
       PART 5 — AGORA LIVE STREAM — PRODUCTION INTEGRATION
       App ID:  056a96cf521d4d06887a84319c62912b  (public identifier —
                fine to ship client-side, same as a Firebase apiKey)
       Channel: empyrean-live (temp token pre-generated)
       Token is for channel "empyrean-live" — expires 24h from issue
       Fallback: getUserMedia local preview when Agora unavailable
       SECURITY (2026-08-03): this block used to also document the
       Agora App Certificate value directly in this comment. Unlike the
       App ID above, the Certificate is the one secret Agora requires to
       stay server-only — anyone with Certificate + App ID can forge a
       valid RTC token for ANY channel, bypassing this server's token
       endpoint entirely. It never appeared in executable code here
       (comment only), but this file ships to every browser as-is, so
       the value was exposed the moment this line existed. Removed —
       the real certificate lives only in Render's AGORA_APP_CERTIFICATE
       env var (server.js), which is where token signing already
       happens. If this value was ever live in a deployed build, treat
       it as compromised and rotate it in the Agora Console, then update
       AGORA_APP_CERTIFICATE in Render — deleting this comment alone
       does not invalidate a value that may already be exposed.
    ═══════════════════════════════════════════════════════════════ */
    const AGORA_APP_ID = '056a96cf521d4d06887a84319c62912b';

    // FIX (blank live screen / "CAN_NOT_GET_GATEWAY_SERVER: dynamic use
    // static key"): this Agora project has an App Certificate configured,
    // so join() MUST carry a signed token — a null token is rejected
    // outright by Agora's gateway, which is exactly the error seen in
    // production, on both the code-editor preview and the Render deploy.
    // The server already has a working token endpoint (POST
    // /api/agora-token in server.js, signing with AGORA_APP_ID /
    // AGORA_APP_CERTIFICATE from the Render environment) and already
    // serves the App ID via /api/config — app-fixes.js even has its own
    // copy of this same fetch, just never wired to the join() calls that
    // actually run. This wires THOSE calls (below, in initAgoraHost /
    // initAgoraViewer) to the real token endpoint instead of hardcoding null.
    function _liveAgoraAppId() {
        return (window._appConfig && window._appConfig.agora && window._appConfig.agora.appId) || AGORA_APP_ID;
    }
    function _fetchLiveAgoraToken(channelName, uid, role) {
        return fetch(window._empApiBase() + '/api/agora-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelName: channelName, uid: uid || 0, role: role })
        }).then(function (r) {
            if (!r.ok) throw new Error('Token request failed: HTTP ' + r.status);
            return r.json();
        });
    }
    // FIX (guest camera/mic works briefly then dies — "no session id when
    // upload wrtc stats" / "ws request timeout" leading to a dead black
    // track): app-live-tiktok-patch.js's promoteToGuestBroadcaster() joins
    // a SECOND Agora client for accepted guests, but had no way to reach
    // this token helper (it's private to this IIFE) and was still hardcoding
    // a null token — the same unsigned-join problem this fix already solved
    // for host/viewer below, just never wired up for the guest path. Expose
    // both helpers so that file can request a real signed token too.
    window._fetchLiveAgoraToken = _fetchLiveAgoraToken;
    window._liveAgoraAppId = _liveAgoraAppId;

    // Permanently hide placeholder elements that block the live video feed
    (function hidePlaceholders() {
        function _hide() {
            ['host-avatar-container','host-video-fallback-avatar','live-stream-host-avatar','agora-connecting-msg'].forEach(function(id) {
                // Don't remove connecting msg prematurely — only hide avatar placeholders
                if (id === 'agora-connecting-msg') return;
                var el = document.getElementById(id);
                if (el) { el.style.cssText += ';display:none!important;visibility:hidden!important;'; }
            });
        }
        // Run on load + after any live modal opens
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _hide);
        } else {
            _hide();
        }
        // MutationObserver: hide whenever live modal becomes visible
        var _obs = new MutationObserver(function(muts) {
            muts.forEach(function(m) {
                if (m.target && m.target.id === 'go-live-modal-overlay') _hide();
            });
        });
        document.addEventListener('DOMContentLoaded', function() {
            var modal = document.getElementById('go-live-modal-overlay');
            if (modal) _obs.observe(modal, { attributes: true, attributeFilter: ['style','class'] });
        });
    })();

    // ── State ──────────────────────────────────────────────────────
    let agoraClient       = null;
    let agoraLocalTracks  = { audio: null, video: null };
    // 2026-11-08: read-only window into the host's live Agora client + published tracks, so sibling
    // patches (app-patch-v42.js Background Sound + Beauty/Filters) can find them even when the tracks came
    // from the held-camera custom-track path below, which the AgoraRTC factory wrappers never see.
    try { window._empLiveHost = { get client() { return agoraClient; }, get mic() { return agoraLocalTracks.audio; }, get cam() { return agoraLocalTracks.video; } }; } catch (_eLH) {}
    let agoraJoined       = false;
    let _screenTrack      = null;   // host's active screen-share track (see _empToggleHostScreenShare)
    let _screenSharing    = false;
    let _localFallbackStream = null; // getUserMedia fallback when Agora join fails (see initAgoraHost catch)
    let agoraViewerClient = null;
    let agoraViewerJoined = false;
    let agoraViewerTracks = [];

    // ── Helpers ────────────────────────────────────────────────────
    function _agoraLog(msg)  { console.log('[Agora]', msg); }
    function _agoraWarn(msg) { console.warn('[Agora]', msg); }

    function _safeUid(userState) {
        // Agora UIDs must be unsigned 32-bit integers
        if (userState && userState.id) {
            const h = Array.from(String(userState.id)).reduce((a,c) => ((a<<5)-a)+c.charCodeAt(0), 0);
            return Math.abs(h) % 999999 || Math.floor(Math.random()*900000+100000);
        }
        return Math.floor(Math.random() * 900000 + 100000);
    }

    function _ensureGuestContainer() {
        let gc = document.getElementById('multi-guest-container');
        if (!gc) {
            gc = document.createElement('div');
            gc.id = 'multi-guest-container';
            gc.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:8px;';
            const liveFooter = document.querySelector('.live-footer, #host-control-panel');
            if (liveFooter) liveFooter.parentElement.insertBefore(gc, liveFooter);
        }
        return gc;
    }

    // FIX (bugs: "guest video incorrectly appears in host's box" / "guest's
    // dedicated box disappears or fails to display" / "box disappears when
    // camera is toggled off"): this whole block is the TikTok-style
    // "one persistent box per participant" fix. Previously, a guest's
    // published video was played into a bare, throwaway <div> created fresh
    // on every 'user-published' event and REMOVED outright on
    // 'user-unpublished'/'user-left' — so toggling the camera off (a normal,
    // frequent action) looked identical to the guest leaving entirely, and
    // there was no stable identity connecting a given Agora uid back to a
    // specific guest's name/avatar for a proper fallback. _ensureGuestBox()
    // is now the single, shared box-builder for BOTH the host's own device
    // (agoraClient's 'user-published' below) and every viewer's device
    // (agoraViewerClient's 'user-published' further down) — same box, same
    // id convention (#agora-guest-{agoraUid}, matching the id v25's
    // _wrapperFor()/_agoraUidForUserId() already expects for spotlighting),
    // so a box is created ONCE, persists for the guest's whole time in the
    // stream, and is only ever torn down by _removeGuestBox() (real
    // departure), never by a camera toggle.
    function _agoraUidFor(userId) {
        // Mirrors safeGuestUid() (app-live-tiktok-patch.js) and
        // _agoraUidForUserId() (app-patch-v25.js) exactly — a GUEST's Agora
        // uid is deterministically derived from their app userId with this
        // formula, so all three places agree on the same numeric uid for
        // the same person. (The HOST's own uid uses a different formula —
        // see hostAgoraUid in publishLiveStreamToFirestore — so this helper
        // is for guest lookups only, never used to guess the host's uid.)
        var base = String(userId || '');
        var h = 0;
        for (var i = 0; i < base.length; i++) h = ((h << 5) - h) + base.charCodeAt(i);
        return (Math.abs(h) % 900000) + 100001;
    }
    function _findGuestMeta(agoraUid) {
        var list = window._liveGuestsCache || (window.liveStreamData && window.liveStreamData.guests) || [];
        for (var i = 0; i < list.length; i++) {
            var g = list[i];
            if (g && g.userId && String(_agoraUidFor(g.userId)) === String(agoraUid)) return g;
        }
        return null;
    }
    function _ensureGuestBox(agoraUid, opts) {
        opts = opts || {};
        var gc = _ensureGuestContainer();
        var id = 'agora-guest-' + agoraUid;
        var box = document.getElementById(id);
        if (!box) {
            var meta = _findGuestMeta(agoraUid) || {};
            var name = opts.name || meta.name || meta.fullName || 'Guest';
            var avatar = opts.avatar || meta.avatar || '';
            box = document.createElement('div');
            box.id = id;
            box.dataset.agoraUid = String(agoraUid);
            box.style.cssText = 'width:90px;height:90px;border-radius:14px;overflow:hidden;background:#111;flex-shrink:0;position:relative;border:2px solid rgba(245,197,24,0.4);';
            box.innerHTML =
                '<div class="agora-guest-video-slot" style="position:absolute;inset:0;"></div>' +
                '<div class="agora-guest-avatar-fallback" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#1B2B8B;">' +
                    (avatar ? '<img src="' + avatar + '" style="width:100%;height:100%;object-fit:cover;">' : '<span style="color:#fff;font-weight:700;font-size:1.1rem;">' + (name.charAt(0) || 'G').toUpperCase() + '</span>') +
                '</div>' +
                '<div style="position:absolute;bottom:4px;left:6px;right:6px;font-size:0.62rem;color:#fff;font-weight:700;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</div>';
            gc.appendChild(box);
        }
        return box;
    }
    function _setGuestBoxVideoState(agoraUid, hasVideo) {
        var box = document.getElementById('agora-guest-' + agoraUid);
        if (!box) return;
        var slot = box.querySelector('.agora-guest-video-slot');
        var fallback = box.querySelector('.agora-guest-avatar-fallback');
        if (slot) slot.style.display = hasVideo ? 'block' : 'none';
        if (fallback) fallback.style.display = hasVideo ? 'none' : 'flex';
    }
    function _removeGuestBox(agoraUid) {
        var box = document.getElementById('agora-guest-' + agoraUid);
        if (box) box.remove();
    }

    function _updateViewerCount(delta) {
        ['live-viewer-count','modal-viewer-count'].forEach(function(id) {
            const el = document.getElementById(id);
            if (el) {
                const cur = parseInt(el.textContent.replace(/,/g,'')) || 1;
                el.textContent = Math.max(1, cur + delta).toLocaleString();
            }
        });
    }

    // ── HOST: Go Live ──────────────────────────────────────────────
    async function initAgoraHost(channelName, uid) {
        if (!window._agoraAvailable) {
            _agoraWarn('SDK not loaded — camera-only local preview (no remote viewers)');
            return false;
        }
        // Clean up any previous session
        await stopAgoraHost();
        try {
            agoraClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
            await agoraClient.setClientRole('host');

            // FIX (CAN_NOT_GET_GATEWAY_SERVER / blank host screen): this Agora
            // project has an App Certificate configured, so join() must carry a
            // signed token — fetch one from the server's /api/agora-token route
            // (already live, signs with AGORA_APP_ID/AGORA_APP_CERTIFICATE) via
            // the _fetchLiveAgoraToken() helper defined above, instead of the
            // hardcoded null this used to send.
            const tokenRes = await _fetchLiveAgoraToken(channelName, uid, 'host');
            const agoraToken = tokenRes.token;
            const joinAppId = tokenRes.appId || _liveAgoraAppId();
            const joinUid   = (tokenRes.uid !== undefined && tokenRes.uid !== null) ? tokenRes.uid : uid;
            await agoraClient.join(joinAppId, channelName, agoraToken, joinUid);
            uid = joinUid;
            agoraJoined = true;
            _agoraLog('Host joined channel: ' + channelName + ' uid:' + uid);

            // Create tracks — try HD first, fall back to SD, then audio-only
            let micTrack = null, cameraTrack = null;
            try {
                [micTrack, cameraTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
                    { AEC: true, ANS: true, AGC: true },
                    { facingMode: 'user', encoderConfig: { width: 640, height: 480, frameRate: 24, bitrateMin: 400, bitrateMax: 1000 } }
                );
            } catch(trackErr) {
                _agoraWarn('HD camera failed, trying basic: ' + trackErr.message);
                try {
                    [micTrack, cameraTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
                        { AEC: true, ANS: true, AGC: true, encoderConfig: 'high_quality' }
                    );
                } catch(e2) {
                    _agoraWarn('Camera failed, audio-only: ' + e2.message);
                    // FIX 2026-07-17 ("live streaming ... logs in the owner's own
                    // dashboard but not visible/working for others" — traced to
                    // this exact spot via field screenshots showing a solid
                    // black host preview plus an uncaught "NotAllowedError:
                    // Permission denied" from this exact call): this catch used
                    // to be `catch(e3) {}` — completely empty. When mic/camera
                    // permission is denied by the browser (or the device has no
                    // mic at all), ALL THREE track-creation attempts above fail
                    // in sequence, micTrack and cameraTrack both stay null, and
                    // this line was the last chance to know that — silently
                    // swallowed. tracksToPublish below then has length 0, so
                    // agoraClient.publish() is skipped entirely: the host joins
                    // the Agora channel broadcasting NOTHING, while
                    // publishLiveStreamToFirestore() (a separate function that
                    // has no idea any of this happened) still writes
                    // isLive:true — so the stream card correctly appears on
                    // every device's dashboard (that part of the pipeline was
                    // never broken), but tapping to join shows/hears nothing,
                    // which looks indistinguishable from "cross-device live
                    // streaming doesn't work" even though it does. Now warns
                    // to the console AND tells the host directly, since a
                    // browser permission prompt is something only they can act
                    // on (grant mic/camera access, then go live again) — no
                    // amount of Firestore/rules fixing changes this outcome.
                    try {
                        micTrack = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true, encoderConfig: 'high_quality' });
                    }
                    catch(e3) {
                        false && (function(){})(); // old empty catch(e3){} — kept, not deleted, per convention
                        _agoraWarn('Audio-only fallback also failed — no mic/camera track could be created: ' + e3.message);
                        if (typeof window.showNotification === 'function') {
                            window.showNotification(
                                '⚠️ Camera/microphone access is blocked — your stream will not have audio or video until you allow it in your browser settings and go live again.',
                                'error'
                            );
                        }
                    }
                }
            }

            // FIX (bug: "camera preview is not working"): app-fixes.js's
            // startHostCamera() already holds the phone's camera via its own
            // getUserMedia stream when this runs. On many Android devices a
            // second request for the same camera is refused (NotReadableError),
            // so all three attempts above fail, cameraTrack stays null, and the
            // host preview + viewers get no video. Instead of giving up, reuse
            // that already-open stream's live tracks as Agora custom tracks.
            try {
                var _heldStream = window.liveStreamData && window.liveStreamData._localStream;
                if (_heldStream) {
                    var _heldVideo = _heldStream.getVideoTracks()[0];
                    if (!cameraTrack && _heldVideo && _heldVideo.readyState === 'live') {
                        cameraTrack = AgoraRTC.createCustomVideoTrack({ mediaStreamTrack: _heldVideo });
                        _agoraWarn('Using the already-open camera stream for the Agora video track.');
                    }
                    var _heldAudio = _heldStream.getAudioTracks()[0];
                    if (!micTrack && _heldAudio && _heldAudio.readyState === 'live') {
                        micTrack = AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: _heldAudio });
                    }
                }
            } catch (_eHeld) { _agoraWarn('Could not reuse the open camera stream: ' + (_eHeld && _eHeld.message)); }

            // Publish whatever tracks we got
            const tracksToPublish = [micTrack, cameraTrack].filter(Boolean);
            if (tracksToPublish.length > 0) {
                agoraLocalTracks.audio = micTrack;
                agoraLocalTracks.video = cameraTrack;
                await agoraClient.publish(tracksToPublish);
                _agoraLog('Published ' + tracksToPublish.length + ' track(s)');
            } else {
                // FIX 2026-07-17 (companion to the catch(e3) fix above): this
                // branch used to not exist at all — zero tracks simply meant
                // nothing happened here, silently. Belt-and-suspenders: even
                // if the earlier per-attempt notification was missed/dismissed,
                // make it unmistakable here that this stream is about to go
                // "live" on Firestore with no audio or video behind it.
                _agoraWarn('Going live with ZERO published tracks — no mic/camera access was granted. Other devices will see the stream card but nothing to watch or hear.');
            }

            // Play local video preview
            if (cameraTrack) {
                const hostVideo = document.getElementById('host-main-video');
                if (hostVideo) {
                    // Remove old agora wrapper if any
                    const old = document.getElementById('agora-local-video');
                    if (old) old.remove();
                    const wrapper = document.createElement('div');
                    wrapper.id = 'agora-local-video';
                    wrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;border-radius:inherit;overflow:hidden;';
                    hostVideo.parentElement.appendChild(wrapper);
                    cameraTrack.play('agora-local-video');
                    hostVideo.style.display = 'none';
                }
                // Hide fallback avatar and static avatar container
                var fa = document.getElementById('host-video-fallback-avatar');
                if (fa) fa.style.display = 'none';
                var ac2 = document.getElementById('host-avatar-container');
                if (ac2) ac2.style.display = 'none';
            }

            // ── Listen for remote viewers / co-hosts joining ──────
            agoraClient.on('user-published', async function(remoteUser, mediaType) {
                try {
                    await agoraClient.subscribe(remoteUser, mediaType);
                    // FIX: no longer bumps the viewer count here — that count
                    // is now driven entirely by the shared Firestore presence
                    // listener (_startViewerCountListener) so it stays in
                    // sync with plain audience members too, not just guests
                    // who publish. See _startViewerPresence above.
                    if (mediaType === 'video') {
                        // FIX (bugs: "guest video disappears/fails to show",
                        // "box disappears when tapped/camera toggled"): box
                        // is created once and reused — see _ensureGuestBox().
                        var box = _ensureGuestBox(remoteUser.uid);
                        var slot = box.querySelector('.agora-guest-video-slot');
                        if (slot) remoteUser.videoTrack.play(slot);
                        _setGuestBoxVideoState(remoteUser.uid, true);
                    }
                    if (mediaType === 'audio' && remoteUser.audioTrack) {
                        remoteUser.audioTrack.play();
                    }
                } catch(subErr) { _agoraWarn('Subscribe error: ' + subErr.message); }
            });

            agoraClient.on('user-unpublished', function(remoteUser, mediaType) {
                // FIX (bug: "box should only disappear if guest leaves or is
                // removed — camera off should just switch to profile
                // picture"): this used to remove the whole box the instant
                // EITHER track unpublished, which is exactly what happens
                // when a guest simply turns their camera off. Now: only fall
                // back to the avatar placeholder for the video track; the
                // box itself, and audio, are untouched. Real removal only
                // happens in 'user-left' below (genuine departure).
                if (mediaType === 'video') _setGuestBoxVideoState(remoteUser.uid, false);
            });

            agoraClient.on('user-left', function(remoteUser) {
                _removeGuestBox(remoteUser.uid);
            });

            agoraClient.on('connection-state-change', function(cur, prev) {
                _agoraLog('Connection: ' + prev + ' → ' + cur);
            });

            // Store channel name for viewers to join
            window._agoraActiveChannel = channelName;
            window._agoraActiveUid     = uid;

            if (typeof window.showNotification === 'function') {
                const mode = cameraTrack ? '📹 Video' : '🎤 Audio-only';
                window.showNotification('🔴 LIVE via Agora! ' + mode + ' — viewers worldwide can now join.', 'success');
            }

            // Publish stream presence to Firestore so other devices can join
            if (typeof window.publishLiveStreamToFirestore === 'function' && window.liveStreamData) {
                window.liveStreamData._agoraChannel = channelName;
                await window.publishLiveStreamToFirestore(window.liveStreamData);
            }

            return true;

        } catch(err) {
            _agoraWarn('Host init error: ' + err.message);
            agoraJoined = false;
            // Fallback for when Agora itself fails for a reason OTHER than the
            // token (e.g. network down, gateway unreachable, camera denied at
            // the OS level): the join above now uses a real signed token from
            // /api/agora-token, so CAN_NOT_GET_GATEWAY_SERVER/"dynamic use
            // static key" should no longer occur here. If Agora still fails,
            // this falls back to a local-only getUserMedia preview so the host
            // at least sees their own camera instead of a black rectangle —
            // remote viewers won't receive video in that fallback case.
            try {
                var hostVideoEl = document.getElementById('host-main-video');
                if (hostVideoEl && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                    // FIX 2026-11-08: startHostCamera() (app-fixes.js) already holds the phone camera. A second
                    // getUserMedia on Android is often refused (NotReadableError), which is why this fallback
                    // used to end in "camera + Agora both failed" with a black preview. Reuse the held stream
                    // first; only ask for the camera again if there is no live held video track.
                    var _heldLive = window.liveStreamData && window.liveStreamData._localStream;
                    var _heldOk = !!(_heldLive && _heldLive.getVideoTracks().some(function (t) { return t.readyState === 'live'; }));
                    var localStream = _heldOk ? _heldLive : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    _localFallbackStream = _heldOk ? null : localStream; // never let stopAgoraHost() kill the shared held stream
                    hostVideoEl.srcObject = localStream;
                    hostVideoEl.muted = true;
                    hostVideoEl.setAttribute('data-real-fallback', '1');
                    hostVideoEl.style.setProperty('display', 'block', 'important');
                    await hostVideoEl.play().catch(function(){});
                    var fa2 = document.getElementById('host-video-fallback-avatar');
                    if (fa2) fa2.style.display = 'none';
                    var ac3 = document.getElementById('host-avatar-container');
                    if (ac3) ac3.style.display = 'none';
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('⚠️ Agora connection failed — showing local camera preview only. Viewers on other devices won\'t see video until this is fixed. Check internet or Agora project settings.', 'warning');
                    }
                } else {
                    throw new Error('getUserMedia unavailable');
                }
            } catch (fallbackErr) {
                _agoraWarn('Local camera fallback also failed: ' + fallbackErr.message);
                if (typeof window.showNotification === 'function') {
                    window.showNotification('⚠️ Could not start video (camera + Agora both failed). Audio/chat still work.', 'error');
                }
            }
            // Even without Agora, publish stream info so others can see we're live
            if (typeof window.publishLiveStreamToFirestore === 'function' && window.liveStreamData) {
                window.liveStreamData._agoraChannel = channelName;
                window.publishLiveStreamToFirestore(window.liveStreamData);
            }
            return false;
        }
    }


    // -- HOST: real screen sharing ----------------------------------
    // FIX (bug: "screen sharing is not working" + blank icon): the host
    // panel's #live-share-screen-btn used to only flip
    // liveStreamData.isScreenSharing (app-fixes.js) -- nothing ever called
    // getDisplayMedia or published a screen track, and updateLiveUI() then
    // swapped the icon to `fa-desktop-slash`, which doesn't exist in Font
    // Awesome (blank button). This is the real implementation: the screen
    // track replaces the camera track on the SAME Agora client/channel
    // (camera is unpublished while sharing, republished after), the host's
    // own preview shows what viewers see, and the browser's own "Stop
    // sharing" control is honoured via track-ended.
    function _screenNotify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }
    function _screenUi(on) {
        _screenSharing = !!on;
        if (window.liveStreamData) window.liveStreamData.isScreenSharing = !!on;
        var b = document.getElementById('live-share-screen-btn');
        if (b) {
            b.classList.toggle('recording', !!on);
            b.title = on ? 'Stop Sharing Screen' : 'Share Screen';
            b.innerHTML = '<i class="fas fa-desktop"></i>';
        }
    }
    async function _empStopScreenShare(silent) {
        if (!_screenSharing && !_screenTrack) return;
        var st = _screenTrack;
        _screenTrack = null;
        _screenUi(false);
        try {
            if (st) {
                try { if (agoraClient && agoraJoined) await agoraClient.unpublish([st]); } catch (_eU) {}
                try { st.stop(); st.close(); } catch (_eC) {}
            }
        } catch (_eS) {}
        try {
            if (agoraLocalTracks.video && agoraClient && agoraJoined) {
                await agoraClient.publish([agoraLocalTracks.video]);
                agoraLocalTracks.video.play('agora-local-video');
            }
        } catch (_eP) { _agoraWarn('Could not republish camera after screen share: ' + (_eP && _eP.message)); }
        if (!silent) _screenNotify('Screen sharing stopped.', 'info');
    }
    async function _empStartScreenShare() {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            _screenNotify('This phone/browser does not allow screen sharing from a web page. Open Empyrean in Chrome, Edge or Firefox on a computer to share your screen.', 'warning');
            return;
        }
        var ready = window._agoraAvailable || await _ensureAgoraSdkReady();
        if (!ready || !agoraClient || !agoraJoined) {
            _screenNotify('Go live first \u2014 screen sharing starts once your stream is connected.', 'warning');
            return;
        }
        try {
            var res = await AgoraRTC.createScreenVideoTrack({ encoderConfig: '1080p_1', optimizationMode: 'detail' }, 'disable');
            var st = Array.isArray(res) ? res[0] : res;
            if (!st) throw new Error('no screen track returned');
            if (agoraLocalTracks.video) { try { await agoraClient.unpublish([agoraLocalTracks.video]); } catch (_eUp) {} }
            await agoraClient.publish([st]);
            _screenTrack = st;
            _screenUi(true);
            try { st.play('agora-local-video'); } catch (_ePl) {}
            st.on('track-ended', function () { _empStopScreenShare(); });
            _screenNotify('Screen sharing started. Viewers now see your screen.', 'success');
        } catch (err) {
            var denied = /PERMISSION_DENIED|NotAllowed/i.test(String((err && (err.code || err.name)) || '') + ' ' + ((err && err.message) || ''));
            _screenUi(false);
            // make sure the camera is back if we unpublished it before failing
            try { if (agoraLocalTracks.video && agoraClient && agoraJoined) await agoraClient.publish([agoraLocalTracks.video]); } catch (_eR) {}
            _screenNotify(denied ? 'Screen sharing was cancelled.' : 'Could not start screen sharing: ' + ((err && err.message) || 'try again.'), denied ? 'info' : 'error');
        }
    }
    window._empToggleHostScreenShare = function () {
        return _screenSharing ? _empStopScreenShare() : _empStartScreenShare();
    };
    // Capture-phase so it always runs first (same pattern as the rest of the
    // host panel) and the legacy flag-only handler in app-fixes.js never also fires.
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var b = e.target.closest('#live-share-screen-btn');
        if (!b) return;
        var panel = document.getElementById('host-control-panel');
        if (panel && panel.classList.contains('tk-guest-broadcast-mode')) return; // guest broadcaster: not a host action
        e.stopImmediatePropagation();
        e.preventDefault();
        window._empToggleHostScreenShare();
    }, true);

    // ── HOST: End Stream ──────────────────────────────────────────
    async function stopAgoraHost() {
        try {
            if (_screenTrack) { try { _screenTrack.stop(); _screenTrack.close(); } catch (_eSt) {} _screenTrack = null; }
            _screenSharing = false;
            if (window.liveStreamData) window.liveStreamData.isScreenSharing = false;
            if (agoraLocalTracks.audio) { agoraLocalTracks.audio.stop(); agoraLocalTracks.audio.close(); agoraLocalTracks.audio = null; }
            if (agoraLocalTracks.video) { agoraLocalTracks.video.stop(); agoraLocalTracks.video.close(); agoraLocalTracks.video = null; }
            if (agoraClient && agoraJoined) { await agoraClient.leave(); }
            agoraJoined = false;
            agoraClient = null;
            // Stop the getUserMedia fallback stream too (see initAgoraHost catch) —
            // otherwise the camera light stays on and the next go-live attempt
            // reuses a dead/detached stream.
            if (_localFallbackStream) {
                _localFallbackStream.getTracks().forEach(function(t) { t.stop(); });
                _localFallbackStream = null;
            }
            // Remove from Firestore so other devices know stream ended
            if (typeof window.unpublishLiveStreamFromFirestore === 'function' && window.liveStreamData && window.liveStreamData.streamId) {
                window.unpublishLiveStreamFromFirestore(window.liveStreamData.streamId);
            }
            window._agoraActiveChannel = null;
            // Restore native video element
            const agoraDiv = document.getElementById('agora-local-video');
            if (agoraDiv) agoraDiv.remove();
            const hostVideo = document.getElementById('host-main-video');
            if (hostVideo) {
                hostVideo.style.display = '';
                // FIX 2026-11-08 ("camera preview is still not working"): initAgoraHost() calls
                // stopAgoraHost() as its very first step, ~1.2s after Go Live. By then app-fixes.js's
                // startHostCamera() has usually already attached the host's real camera stream to this
                // element, and the unconditional `srcObject = null` below wiped it — leaving a black
                // preview that nothing ever re-attached when the Agora join then failed. Keep the
                // preview while this is still the live host's own held stream; a real end-of-stream
                // (#live-close-btn handler) stops and clears it separately, and isLive is false by then.
                var _keepPreview = !!(window.liveStreamData && window.liveStreamData.isLive &&
                    window.liveStreamData._localStream && hostVideo.srcObject === window.liveStreamData._localStream);
                if (!_keepPreview) {
                    hostVideo.srcObject = null; // old behaviour, unchanged for every other case
                    hostVideo.removeAttribute('data-real-fallback');
                }
            }
            _agoraLog('Host session ended cleanly');
        } catch(e) { _agoraWarn('Stop host error: ' + e.message); }
    }

    // ── VIEWER: Join a live stream ────────────────────────────────
    // streamId (new, optional 3rd arg) is the active_streams doc id — used
    // to write this viewer's presence doc so the shared count/list include
    // them. Backwards-compatible: omitting it just skips presence (no-op
    // guarded inside _startViewerPresence/_startViewerCountListener).
    async function initAgoraViewer(channelName,uid,streamId){
        if(!window._agoraAvailable){
            _agoraWarn('Agora SDK not loaded — viewer cannot connect to real stream');
            var _cm2=document.getElementById('agora-connecting-msg');
            if(_cm2)_cm2.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:white;text-align:center;padding:20px;"><span style="font-size:2rem;">📡</span><span style="font-size:0.9rem;opacity:0.85;">Live video requires the Agora SDK.<br>Check your connection and reload.</span></div>';
            var _hfa=document.getElementById('host-video-fallback-avatar');if(_hfa)_hfa.style.display='block';
            return false;
        }
        await stopAgoraViewer();
        try {
            agoraViewerClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
            await agoraViewerClient.setClientRole('audience');
            // FIX (CAN_NOT_GET_GATEWAY_SERVER / blank viewer screen): same root
            // cause as the host path — this project requires a signed token, so
            // fetch one from /api/agora-token (role: 'viewer' = subscribe-only)
            // instead of the hardcoded null this used to send.
            const viewerTokenRes  = await _fetchLiveAgoraToken(channelName, uid, 'viewer');
            const agoraViewerToken = viewerTokenRes.token;
            const viewerJoinAppId = viewerTokenRes.appId || _liveAgoraAppId();
            const viewerJoinUid   = (viewerTokenRes.uid !== undefined && viewerTokenRes.uid !== null) ? viewerTokenRes.uid : uid;
            await agoraViewerClient.join(viewerJoinAppId, channelName, agoraViewerToken, viewerJoinUid);
            uid = viewerJoinUid;
            agoraViewerJoined = true;
            _agoraLog('Viewer joined channel: ' + channelName);
            // FIX: these were bare-identifier calls into a function scope
            // this code isn't part of — threw ReferenceError, caught by
            // this same try/catch below, which silently aborted the whole
            // viewer join (including the user-published subscription right
            // after this) any time Agora actually loaded successfully.
            if (window._liveStartViewerPresence) window._liveStartViewerPresence(streamId);
            if (window._liveStartViewerCountListener) window._liveStartViewerCountListener(streamId);

            // Receive host video/audio
            agoraViewerClient.on('user-published', async function(remoteUser, mediaType) {
                try {
                    // FIX (echo/"hearing myself" as a guest broadcaster): this
                    // audience client and app-live-tiktok-patch.js's separate
                    // guest-broadcast client both run on the same device at
                    // the same time by design (see that file's own comment).
                    // Once THIS device has been promoted to guest broadcaster,
                    // its own newly-published mic/camera shows up here as
                    // just another "remote" user (different Agora uid) and
                    // would otherwise get subscribed to and played back
                    // through this same device's speaker — i.e. this device's
                    // own voice, echoed back a moment later. Recognize and
                    // skip it entirely (no subscribe, no play) rather than
                    // only muting playback, since there's nothing useful to
                    // subscribe to here either way.
                    if (window._empOwnGuestUid && String(remoteUser.uid) === window._empOwnGuestUid) {
                        return;
                    }
                    await agoraViewerClient.subscribe(remoteUser, mediaType);
                    // FIX (bug: "guest video incorrectly appears in the
                    // host's box"): this used to play EVERY published video
                    // — host's or any co-guest's — into the single
                    // #agora-viewer-video wrapper sitting over the host's
                    // own box, so whichever guest published most recently
                    // silently took over the host's spot. Now: only the
                    // stream's actual host (identified by hostAgoraUid,
                    // written once at publish time — see
                    // publishLiveStreamToFirestore in this file) goes to the
                    // host box; anyone else is a guest and gets their own
                    // persistent box via _ensureGuestBox(), the same
                    // box-builder the host's own device uses, so a guest's
                    // video/avatar looks identical and stays in the same
                    // place whether you're the host or a viewer.
                    var sd = window.liveStreamData || {};
                    var isHostUid = sd.hostAgoraUid != null && String(remoteUser.uid) === String(sd.hostAgoraUid);
                    if (mediaType === 'video' && isHostUid) {
                        // Play host stream in the main view area
                        const hostVideo = document.getElementById('host-main-video');
                        let viewerWrapper = document.getElementById('agora-viewer-video');
                        if (!viewerWrapper) {
                            viewerWrapper = document.createElement('div');
                            viewerWrapper.id = 'agora-viewer-video';
                            viewerWrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;border-radius:inherit;overflow:hidden;background:#000;';
                            if (hostVideo && hostVideo.parentElement) {
                                hostVideo.parentElement.appendChild(viewerWrapper);
                                hostVideo.style.display = 'none';
                            }
                        }
                        remoteUser.videoTrack.play('agora-viewer-video');
                        _agoraLog('Viewer: host video stream playing');
                        // Remove connecting spinner and hide avatar overlay
                        var cm = document.getElementById('agora-connecting-msg');
                        if (cm) cm.remove();
                        var ac = document.getElementById('host-avatar-container');
                        if (ac) ac.style.display = 'none';
                        // Remove the fallback avatar image too
                        var fa = document.getElementById('host-video-fallback-avatar');
                        if (fa) fa.style.display = 'none';
                    } else if (mediaType === 'video') {
                        // A co-guest, not the host — own persistent box,
                        // never the host's.
                        var gbox = _ensureGuestBox(remoteUser.uid);
                        var gslot = gbox.querySelector('.agora-guest-video-slot');
                        if (gslot) remoteUser.videoTrack.play(gslot);
                        _setGuestBoxVideoState(remoteUser.uid, true);
                        _agoraLog('Viewer: guest video playing in its own box (uid ' + remoteUser.uid + ')');
                    }
                    if (mediaType === 'audio' && remoteUser.audioTrack) {
                        remoteUser.audioTrack.play();
                        _agoraLog(isHostUid ? 'Viewer: host audio playing' : 'Viewer: guest audio playing');
                    }
                } catch(subErr) { _agoraWarn('Viewer subscribe error: ' + subErr.message); }
            });

            agoraViewerClient.on('user-unpublished', function(remoteUser, mediaType) {
                var sd = window.liveStreamData || {};
                var isHostUid = sd.hostAgoraUid != null && String(remoteUser.uid) === String(sd.hostAgoraUid);
                if (mediaType !== 'video') return;
                if (isHostUid) {
                    const vw = document.getElementById('agora-viewer-video');
                    if (vw) vw.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:white;font-size:1rem;">Stream paused</div>';
                } else {
                    // FIX (bug: "box should only disappear if guest leaves or
                    // is removed — camera off should just switch to profile
                    // picture"): fall back to avatar, keep the box.
                    _setGuestBoxVideoState(remoteUser.uid, false);
                }
            });

            agoraViewerClient.on('user-left', function(remoteUser, reason) {
                var sd = window.liveStreamData || {};
                var isHostUid = sd.hostAgoraUid != null && String(remoteUser.uid) === String(sd.hostAgoraUid);
                if (!isHostUid) _removeGuestBox(remoteUser.uid); // a co-guest genuinely left — the host's own user-left handling (below) is unrelated to this
            });

            // FIX (bug: "End Live indicator appears on guest screen while the
            // stream is still on, host never tapped End Live" — recurring on
            // weak mobile connections): Agora's 'user-left' fires not only
            // when the host genuinely leaves the channel, but also on a
            // transient network drop (dead spot, tower handoff, brief
            // disconnect) — the host's own SDK typically auto-reconnects a
            // moment later, re-firing 'user-published'. This handler used to
            // treat EVERY 'user-left' as a real end, immediately showing the
            // "ended" notification and tearing down the viewer session, with
            // no way to tell a genuine end apart from a blip.
            //
            // Fix: don't act immediately. Wait a short grace window (long
            // enough for Agora's own auto-reconnect on a blip) and then
            // cross-check the real source of truth — the active_streams
            // doc's isLive + lastHeartbeat (the same freshness check
            // _isStreamFresh() already uses elsewhere in this file) — before
            // declaring the stream over. If the host reconnects within the
            // grace window (a fresh 'user-published' arrives, or a newer
            // grace token replaces this one), this callback is a no-op.
            var _userLeftToken = null;
            agoraViewerClient.on('user-left', function(remoteUser, reason) {
                var sdCheck = window.liveStreamData || {};
                var isHostUidLeaving = sdCheck.hostAgoraUid != null && String(remoteUser.uid) === String(sdCheck.hostAgoraUid);
                if (!isHostUidLeaving) return; // a co-guest leaving isn't a "stream ended" signal — see the box-removal handler above
                console.log('[Live] user-left fired (reason=' + reason + ') — verifying before declaring the stream ended.');
                var sid = window.liveStreamData && window.liveStreamData.streamId;
                var myToken = {};
                _userLeftToken = myToken;
                setTimeout(function() {
                    if (_userLeftToken !== myToken) return; // host reconnected (or a newer check superseded this one) — ignore
                    var db = window.fbDb;
                    function declareEnded() {
                        if (typeof window.showNotification === 'function') {
                            window.showNotification('📴 The host has ended the live stream.', 'info');
                        }
                        stopAgoraViewer();
                    }
                    if (db && sid && window._firebaseLoaded) {
                        // FIX 2026-07-17 (bug: "banner shows stream ended /
                        // not available" even though the host is still
                        // live — traced via field console showing repeated
                        // "onicecandidate timeout, local candidate count 0"
                        // right before this fired): a real ICE/network blip
                        // on THIS viewer's own connection can make the very
                        // verification .get() call below fail too, at the
                        // same moment it's needed most. The old .catch()
                        // treated ANY fetch failure as proof the stream had
                        // ended and called declareEnded() immediately — the
                        // same "assume the worst on one failed request"
                        // mistake already fixed elsewhere in this app (see
                        // sendJoinRequest's unavailable-retry). One retry
                        // 1.5s later, matching that same established
                        // pattern, before actually giving up.
                        function _verifyStillLive(isRetry) {
                            db.collection('active_streams').doc(sid).get().then(function(doc) {
                                if (_userLeftToken !== myToken) return;
                                var data = doc && doc.exists ? (doc.data() || {}) : null;
                                // Widened alongside HEARTBEAT_STALE_MS above — same reasoning (weak-connection heartbeat delay is not the same as the host actually leaving).
                                var hbFresh = !data || !data.lastHeartbeat || (Date.now() - Date.parse(data.lastHeartbeat)) < 180000;
                                var stillLive = !!(data && data.isLive === true && hbFresh);
                                if (stillLive) {
                                    console.log('[Live] user-left was a transient blip — Firestore still shows the stream live. Ignoring.');
                                    return;
                                }
                                declareEnded();
                            }).catch(function(fetchErr) {
                                if (_userLeftToken !== myToken) return;
                                false && declareEnded(); // old immediate-declare-on-any-failure behavior — kept, not deleted, per convention
                                if (!isRetry) {
                                    console.warn('[Live] stream-ended verification fetch failed once (' +
                                        (fetchErr && fetchErr.code) + ') — retrying in 1500ms before declaring ended.');
                                    setTimeout(function() {
                                        if (_userLeftToken !== myToken) return;
                                        _verifyStillLive(true);
                                    }, 1500);
                                    return;
                                }
                                declareEnded();
                            });
                        }
                        _verifyStillLive(false);
                    } else {
                        declareEnded();
                    }
                }, 6000); // generous enough for Agora's own reconnect on a network blip
            });

            agoraViewerClient.on('user-published', function() {
                // Real reconnect confirmed by Agora itself — cancel any
                // pending "declare ended" check queued by user-left above.
                _userLeftToken = null;
            });

            if (typeof window.showNotification === 'function') {
                window.showNotification('✅ Connected to live stream!', 'success');
            }
            return true;
        } catch(err) {
            _agoraWarn('Viewer join error: ' + err.message);
            agoraViewerJoined = false;
            return false;
        }
    }

    async function stopAgoraViewer() {
        try {
            // FIX: same out-of-scope bug as initAgoraViewer above — these
            // bare calls threw ReferenceError, caught below, which meant
            // NONE of the cleanup after this line (track stop, client
            // leave, DOM removal) ever ran, on every single stopAgoraViewer
            // call (including the one that runs right before joining a new
            // stream).
            if (window._liveStopViewerPresence) window._liveStopViewerPresence();
            if (window._liveStopViewerCountListener) window._liveStopViewerCountListener();
            agoraViewerTracks.forEach(function(t) { try { t.stop(); t.close(); } catch(e){} });
            agoraViewerTracks = [];
            if (agoraViewerClient && agoraViewerJoined) { await agoraViewerClient.leave(); }
            agoraViewerJoined = false;
            agoraViewerClient = null;
            const vw = document.getElementById('agora-viewer-video');
            if (vw) vw.remove();
            const hostVideo = document.getElementById('host-main-video');
            if (hostVideo) hostVideo.style.display = '';
            _agoraLog('Viewer session ended');
        } catch(e) { _agoraWarn('Stop viewer error: ' + e.message); }
    }

    // FIX (report — "camera doesn't come on when going live", confirmed via
    // four separate production console captures all showing the exact same
    // "[Agora] Agora SDK not loaded" line): window._agoraAvailable (top of
    // this file) is a one-shot check made the instant this script runs,
    // which can lose the race against index.html's own Agora CDN <script>
    // tag on a slow connection and then stays stuck false for the rest of
    // the page's life — silently skipping the Agora publish on every future
    // go-live attempt on that page load, so nobody watching ever sees the
    // host's camera. app-reel.js already found and fixed this identical
    // race for its own broadcast flow; this mirrors that same fix (fresh
    // on-demand script load attempt, not a reused stale tag) for the go-live
    // flow below, which is the one actually in use for "Go Live".
    function _ensureAgoraSdkReady(timeoutMs) {
        /* 2026-10-28 (page-load speed): the SDK is no longer a blocking <script> in index.html — it is loaded by the ONE shared
           window._empLoadAgora() (index.html), which this now delegates to so it can never be injected a second time. */
        if (typeof window._empLoadAgora === 'function') {
            return window._empLoadAgora(Math.max(timeoutMs || 0, 20000)).then(function (ok) {
                if (!ok) _agoraWarn('Agora SDK did not load in time — continuing in local camera-only mode.');
                return ok;
            });
        }
        return new Promise(function (resolve) {
            if (typeof AgoraRTC !== 'undefined') { window._agoraAvailable = true; resolve(true); return; }
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                _agoraWarn('Agora SDK load attempt timed out after ' + (timeoutMs || 12000) + 'ms — continuing in local camera-only mode.');
                resolve(false);
            }, timeoutMs || 12000);
            var script = document.createElement('script');
            script.crossOrigin = 'anonymous';
            script.addEventListener('load', function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                var ok = (typeof AgoraRTC !== 'undefined');
                window._agoraAvailable = ok;
                if (!ok) _agoraWarn('Agora script loaded but AgoraRTC is still undefined — continuing in local camera-only mode.');
                resolve(ok);
            }, { once: true });
            script.addEventListener('error', function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                window._agoraAvailable = false;
                _agoraWarn('Fresh Agora SDK load attempt failed — continuing in local camera-only mode.');
                resolve(false);
            }, { once: true });
            script.src = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.22.0.js';
            document.head.appendChild(script);
        });
    }

    // ── HOOK: Go Live form submit → launch Agora host ──────────────
    // IMPORTANT: Agora runs AFTER local camera (getUserMedia) has started.
    // Local camera starts at t=400ms (in go-live-form case handler).
    // Agora joins at t=1800ms so local preview is never blocked.
    // If Agora fails, the local camera stream continues working perfectly.
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (!form || form.id !== 'go-live-form') return;
        setTimeout(async function() {
            if (!window.liveStreamData || !window.liveStreamData.isLive) return;

            // Derive a stable channel name from the streamId
            const streamId    = window.liveStreamData.streamId;
            const channelName = 'empyrean-' + streamId;
            const uid         = _safeUid(window.userState);

            window.liveStreamData._agoraChannel = channelName;
            window.liveStreamData._agoraUid     = uid;

            // STEP 1: Join Agora first (or start local camera-only mode)
            let agoraOk = false;
            // Don't trust the stale one-shot flag on its own — give the SDK
            // one real, fresh chance to load right now if it isn't ready yet
            // (see _ensureAgoraSdkReady above for why the flag alone isn't
            // reliable).
            const agoraReady = window._agoraAvailable || await _ensureAgoraSdkReady();
            if (agoraReady) {
                try {
                    _agoraLog('Host joining Agora channel: ' + channelName);
                    agoraOk = await initAgoraHost(channelName, uid);
                } catch(err) {
                    _agoraWarn('Agora failed (' + err.message + ') — continuing in local mode');
                }
            } else {
                _agoraWarn('Agora SDK not loaded — local camera-only mode');
            }

            // STEP 2: AFTER Agora confirms (or fails), write isLive:true to Firestore
            // This matches the reference pattern: Firestore is updated only once
            // the host is confirmed live, so viewers always join a real stream.
            // DIAGNOSTIC FIX ("stream doesn't appear on other devices" / "bell
            // never fires"): this call previously had no try/catch. If it threw
            // (or the function wasn't defined yet on a slow connection) the
            // whole setTimeout callback died silently right here — no log, no
            // notification, and every step after it (including this same
            // publish call, which also fires the notifications/live_* doc and
            // notifyFriendsUserIsLive for the bell) never ran. Now the failure
            // is visible instead of invisible.
            if (typeof window.publishLiveStreamToFirestore === 'function') {
                try {
                    await window.publishLiveStreamToFirestore(window.liveStreamData);
                    _agoraLog('Firestore updated — other devices will now see the stream');
                } catch(publishErr) {
                    _agoraWarn('[Live] publishLiveStreamToFirestore threw: ' + (publishErr && publishErr.message ? publishErr.message : publishErr));
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('⚠️ Stream started locally, but publishing to the network failed. Other users may not see it.', 'warning');
                    }
                }
            } else {
                _agoraWarn('[Live] publishLiveStreamToFirestore is not defined at go-live time — stream will NOT be visible to other devices and no notification will be sent.');
            }

            if (!agoraOk) {
                if (typeof window.showNotification === 'function') {
                    window.showNotification('📡 Live (local mode) — Agora unavailable. Your stream is published.', 'info');
                }
            }
        }, 1200);
    }, true);

    // ── HOOK: Viewer clicks "Join" card → Agora audience join ─────
    document.addEventListener('click', function(e) {
        const joinBtn = e.target.closest && e.target.closest('.join-live-btn');
        if (!joinBtn) return;
        setTimeout(async function() {
            // Same stale-one-shot-flag issue as the go-live handler above —
            // give the SDK a real fresh chance before giving up on it.
            const agoraReady = window._agoraAvailable || await _ensureAgoraSdkReady();
            if (!agoraReady) { _agoraWarn('Agora SDK not available — cannot join as viewer.'); return; }
            try {
                // Prefer the channel stored on the card (from Firestore doc)
                const channelName = joinBtn.dataset.agoraChannel
                    || window._agoraActiveChannel
                    || ('empyrean-' + (joinBtn.dataset.streamId || 'live'));
                window._agoraActiveChannel = channelName; // store for mic/video controls
                const uid = _safeUid(window.userState);
                const streamId = joinBtn.dataset.streamId || null;
                _agoraLog('Viewer joining channel: ' + channelName);
                await initAgoraViewer(channelName, uid, streamId);
            } catch(vErr) {
                _agoraWarn('Viewer Agora connect failed: ' + vErr.message);
            }
        }, 800);
    });

    // ── HOOK: End stream / close live modal ───────────────────────
    document.addEventListener('click', function(e) {
        if (!e.target.closest) return;
        if (e.target.closest('#live-close-btn')) {
            stopAgoraHost();
            stopAgoraViewer();
            // Stop all media tracks safely
            document.querySelectorAll('video').forEach(function(v) {
                try { if (v.srcObject) { v.srcObject.getTracks().forEach(function(t) { t.stop(); }); v.srcObject = null; } } catch(er) {}
            });
            // Re-hide avatar container and reset elements for next session
            var ac3 = document.getElementById('host-avatar-container');
            if (ac3) ac3.style.display = 'none';
            var hv = document.getElementById('host-main-video');
            if (hv) {
                try { if (hv.srcObject) { hv.srcObject.getTracks().forEach(function(t) { t.stop(); }); hv.srcObject = null; } } catch(e) {}
                hv.src = ''; hv.style.display = 'none';
            }
            ['agora-connecting-msg', 'agora-viewer-video', 'agora-local-video'].forEach(function(id) {
                var el = document.getElementById(id); if (el) el.remove();
            });
            // FIX Bug 8: use BOTH style AND classList to guarantee modal closes
            var goLiveOverlay = document.getElementById('go-live-modal-overlay');
            if (goLiveOverlay) {
                goLiveOverlay.classList.remove('show');
                goLiveOverlay.style.display = 'none';
                goLiveOverlay.style.visibility = 'hidden';
                // FIX (2026-10-03 — "after ending a live and going live again the screen freezes"):
                // also clear the minimize / "away" state so the next live opens clean.
                goLiveOverlay.classList.remove('pv58-min', 'pv56-away');
            }
            document.body.classList.remove('pv58-live-minimized');
            ['pv58-bubble', 'pv56-back-live'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
            try { if (typeof window._pv56bReset === 'function') window._pv56bReset(); } catch (eR) {}
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            // Reset live state so user can go live again
            if(window.liveStreamData){
                window.liveStreamData.isLive=false;
                // Keep streamId so host can rejoin — only clear after confirmed permanent end
                window.liveStreamData._localStream=null;
                window.liveStreamData._agoraChannel=null;
                if (window.liveStreamData.rewardInterval) { clearInterval(window.liveStreamData.rewardInterval); window.liveStreamData.rewardInterval = null; }
                if (window.liveStreamData._viewerSimInterval) { clearInterval(window.liveStreamData._viewerSimInterval); window.liveStreamData._viewerSimInterval = null; }
            }
            window._agoraActiveChannel = null;
        }
    });

    // ── HOOK: Mic toggle sync ─────────────────────────────────────
    document.addEventListener('click', function(e) {
        if (!e.target.closest) return;
        // FIX (bug: "camera toggle switches but shows an error message"):
        // Agora's LocalAudioTrack/LocalVideoTrack have no setMuted()
        // method -- it doesn't exist on the SDK's track API. Every other
        // toggle in this codebase (app-live-tiktok-patch.js's guest mic/
        // cam controls, app-patch-v9.js's guest self controls) already
        // uses the real API, setEnabled(), which is async and returns a
        // Promise. Calling the nonexistent setMuted() threw a synchronous
        // TypeError on every tap of the host's own mic/camera toggle --
        // the button's OTHER handler (app-fixes.js, which just flips
        // liveStreamData.isMicMuted/isVideoMuted and shows a plain 'now
        // muted/unmuted' notification) still ran fine, so the icon/label
        // visibly changed, but the thrown error is what a global handler
        // then surfaced as an on-screen error message right alongside it.
        if (false && e.target.closest('#live-mic-toggle') && agoraLocalTracks.audio && agoraJoined) { /* SUPERSEDED 2026-10-03 — see _empHostToggleMedia below */
            const muted = window.liveStreamData && window.liveStreamData.isMicMuted;
            agoraLocalTracks.audio.setEnabled(!muted).catch(function (err) {
                console.warn('[Agora] mic setEnabled failed:', err && err.message);
            });
        }
        // CONSOLIDATED 2026-07-16 (guest camera logic audit): confirmed
        // this branch is host-only and always inert for a guest —
        // agoraLocalTracks is a module-local var in this file, only ever
        // populated inside initAgoraHost() (host-only). A guest's own
        // camera toggle now runs through exactly one place:
        // window._empToggleGuestCamera(), defined in
        // app-live-tiktok-patch.js. Left as-is here on purpose — this is
        // the correct, and only, place the HOST's own camera toggle
        // should live.
        if (false && e.target.closest('#live-video-toggle') && agoraLocalTracks.video && agoraJoined) { /* SUPERSEDED 2026-10-03 — see _empHostToggleMedia below */
            const muted = window.liveStreamData && window.liveStreamData.isVideoMuted;
            agoraLocalTracks.video.setEnabled(!muted).catch(function (err) {
                console.warn('[Agora] camera setEnabled failed:', err && err.message);
            });
        }

        /* FIX 2026-10-03 (report: "audio and camera on/off toggles in the
           live section do nothing when clicked"): the two blocks above
           decided WHAT to do from liveStreamData.isMicMuted/isVideoMuted,
           a flag that only app-fixes.js's body click handler flips — and
           that handler only does so when liveStreamData.isLive is true AND
           userState.id === liveStreamData.hostUserId AND no earlier branch
           in its long if-chain returned first. If any one of those wasn't
           true for the tap, the flag never changed, so these blocks called
           setEnabled(!unchangedFlag) = setEnabled(current state) — a
           silent no-op, exactly "clicking does nothing". They also did
           nothing at all when Agora had no track (SDK unavailable, which
           falls back to a plain getUserMedia stream with no Agora track).
           This version asks the track itself what state it's in and flips
           THAT, then writes the result back into liveStreamData and the
           button icon, so it no longer depends on any other handler having
           run first (if app-fixes.js's handler did also run, the final
           flag value is the same — it's derived from the real track state,
           not toggled blindly a second time). */
        var _micBtn = e.target.closest('#live-mic-toggle');
        var _camBtn = e.target.closest('#live-video-toggle');
        if (_micBtn) _empHostToggleMedia('audio', _micBtn);
        else if (_camBtn) _empHostToggleMedia('video', _camBtn);
    });

    function _empHostToggleMedia(kind, btn) {
        var panel = document.getElementById('host-control-panel');
        // An accepted guest broadcaster's mic/camera belong to
        // app-live-tiktok-patch.js — never touch them from here.
        if (panel && panel.classList.contains('tk-guest-broadcast-mode')) return;
        var sd = window.liveStreamData;
        var flag = kind === 'audio' ? 'isMicMuted' : 'isVideoMuted';
        var agoraTrack = agoraLocalTracks[kind];
        var localStream = sd && sd._localStream;
        var streamTracks = localStream && localStream[kind === 'audio' ? 'getAudioTracks' : 'getVideoTracks']
            ? localStream[kind === 'audio' ? 'getAudioTracks' : 'getVideoTracks']() : [];

        function _syncUi(nowEnabled) {
            if (sd) sd[flag] = !nowEnabled;
            if (btn) {
                btn.innerHTML = kind === 'audio'
                    ? '<i class="fas fa-microphone' + (nowEnabled ? '' : '-slash') + '"></i>'
                    : '<i class="fas fa-video' + (nowEnabled ? '' : '-slash') + '"></i>';
                btn.classList.toggle('pv32-off', !nowEnabled);
            }
        }

        if (agoraTrack && agoraJoined) {
            var next = agoraTrack.enabled === false; // currently off -> turn on
            _syncUi(next);
            agoraTrack.setEnabled(next).catch(function (err) {
                console.warn('[Agora] ' + kind + ' setEnabled failed:', err && err.message);
                _syncUi(!next); // roll the icon/flag back — the track didn't actually change
            });
            return;
        }
        if (streamTracks && streamTracks.length) {
            // Agora SDK unavailable / not joined — host is on the plain
            // getUserMedia preview stream. Toggle those tracks directly.
            var nextLocal = streamTracks[0].enabled === false;
            streamTracks.forEach(function (t) { t.enabled = nextLocal; });
            _syncUi(nextLocal);
            return;
        }
        // Only the host should ever see this message (agoraLocalTracks is
        // empty for everyone else by design — see the comment above).
        var us = window.userState;
        if (sd && us && sd.hostUserId && sd.hostUserId === us.id && typeof window.showNotification === 'function') {
            window.showNotification((kind === 'audio' ? 'Microphone' : 'Camera') + ' isn\u2019t connected yet — please wait a moment and try again.', 'warning');
        }
    }

    // ── Expose to window for debugging ───────────────────────────
    window._agora = {
        appId: AGORA_APP_ID,
        initHost: initAgoraHost,
        stopHost: stopAgoraHost,
        initViewer: initAgoraViewer,
        stopViewer: stopAgoraViewer,
        getChannel: function() { return window._agoraActiveChannel; },
        status: function() { return { hostJoined: agoraJoined, viewerJoined: agoraViewerJoined, sdkLoaded: !!window._agoraAvailable }; },
        // FIX (startup crash — see full explanation near _startViewerPresence's
        // declaration further down this file): these four used to be bare
        // identifier references evaluated immediately, right here, at page
        // load — before the functions they name even exist yet. That threw
        // a ReferenceError that killed this entire onReady callback,
        // silently preventing publishLiveStreamToFirestore (and everything
        // else below it) from ever being defined. These are now small
        // wrapper functions that look up the real function on window at
        // call time (safe — a debug-only object, only ever invoked later
        // from the console, by which point the real functions exist).
        startPresence: function(streamId) { if (window._liveStartViewerPresence) window._liveStartViewerPresence(streamId); },
        stopPresence: function() { if (window._liveStopViewerPresence) window._liveStopViewerPresence(); },
        startCountListener: function(streamId) { if (window._liveStartViewerCountListener) window._liveStartViewerCountListener(streamId); },
        stopCountListener: function() { if (window._liveStopViewerCountListener) window._liveStopViewerCountListener(); }
    };

    /* ═══════════════════════════════════════════════════════════════
       ON-SCREEN CONNECTION-STATUS BADGE (additive, non-disruptive)
       ───────────────────────────────────────────────────────────────
       Purely visual confirmation of whether a given live session is
       actually relaying through Agora (real cross-device/cross-
       network broadcast) or only running local-preview/local-only
       fallback. Reads window._agora.status() — already exposed above,
       unchanged — on a short interval. Creates and owns its own DOM
       element only; never reads, modifies, or removes anything that
       existed before this block, so it cannot disrupt host/viewer
       video, Firestore sync, or any other working feature.
    ═══════════════════════════════════════════════════════════════ */
    (function() {
        var BADGE_ID = 'agora-connection-badge';
        var _badgeInterval = null;

        function _ensureBadge() {
            var host = document.getElementById('host-main-video');
            var anchor = host && host.parentElement; // .main-host-video — same parent
            if (!anchor) return null;                // already used for agora-local-video / agora-viewer-video
            var badge = document.getElementById(BADGE_ID);
            if (badge) return badge;
            badge = document.createElement('div');
            badge.id = BADGE_ID;
            badge.style.cssText =
                'position:absolute;top:10px;right:10px;z-index:20;' +
                'display:flex;align-items:center;gap:6px;' +
                'padding:4px 10px;border-radius:50px;' +
                'font-size:0.68rem;font-weight:700;font-family:inherit;' +
                'color:#fff;background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);' +
                'pointer-events:none;transition:background 0.25s,color 0.25s;white-space:nowrap;';
            badge.innerHTML = '<span class="acb-dot" style="width:7px;height:7px;border-radius:50%;display:inline-block;"></span><span class="acb-label"></span>';
            anchor.appendChild(badge);
            return badge;
        }

        function _renderBadge() {
            // Only show while a live session is actually relevant on screen
            var liveSection = document.getElementById('go-live') || document.getElementById('live-player-container');
            var visible = liveSection && liveSection.offsetParent !== null;
            var badge = document.getElementById(BADGE_ID);
            if (!visible) {
                if (badge) badge.style.display = 'none';
                return;
            }
            badge = _ensureBadge();
            if (!badge) return;

            var st = (window._agora && typeof window._agora.status === 'function') ? window._agora.status() : { hostJoined:false, viewerJoined:false, sdkLoaded:false };
            var dot   = badge.querySelector('.acb-dot');
            var label = badge.querySelector('.acb-label');
            var connected = st.hostJoined || st.viewerJoined;

            badge.style.display = 'flex';
            if (connected) {
                badge.style.background = 'rgba(16,163,74,0.85)'; // green
                if (dot)   dot.style.background = '#fff';
                if (label) label.textContent = 'Agora: Connected — viewers worldwide';
            } else if (!st.sdkLoaded) {
                badge.style.background = 'rgba(0,0,0,0.6)';
                if (dot)   dot.style.background = '#9CA3AF'; // grey
                if (label) label.textContent = 'Local-only mode';
            } else {
                badge.style.background = 'rgba(0,0,0,0.6)';
                if (dot)   dot.style.background = '#F59E0B'; // amber — connecting
                if (label) label.textContent = 'Connecting…';
            }
        }

        // Poll lightly — this never touches Agora/Firestore state, only reads it
        function _startBadgePolling() {
            if (_badgeInterval) return;
            _badgeInterval = setInterval(_renderBadge, 1000);
            _renderBadge();
        }
        if (document.readyState !== 'loading') _startBadgePolling();
        else document.addEventListener('DOMContentLoaded', _startBadgePolling);
    })();

    /* ═══════════════════════════════════════════════════════════════
       REAL-TIME LIVE STREAM BROADCASTING
       When a host goes live, ALL other logged-in devices see it
       immediately via Firestore real-time listener.
    ═══════════════════════════════════════════════════════════════ */
    (function() {
        var _streamListener   = null;
        var _knownStreamIds   = {};
        // FIX ("previous streams still show on the public dashboard after
        // logout"): every other fix so far (logout cleanup, guest-promotion
        // guard) prevents NEW zombie docs from being created, but a card
        // already stuck at isLive:true — from before those fixes were
        // deployed, or from any future edge case they don't cover (a crash,
        // a force-quit, a network drop with no clean disconnect) — would
        // still sit on the dashboard forever with nothing to remove it,
        // since Firestore's onSnapshot only fires again when the DOCUMENT
        // actually changes, and a truly-dead stream's document stops
        // changing entirely. The fix: don't trust isLive alone. A real,
        // still-broadcasting host writes `lastHeartbeat` every 20s (see
        // the heartbeat-writer a few lines below); anything older than
        // that is dead in practice even if isLive:true was never flipped
        // back to false. _streamHeartbeats tracks the last-seen heartbeat
        // per streamId so a periodic sweep (below) can catch and remove
        // cards whose heartbeat has gone stale — catching every cause of
        // a zombie card, not just the logout path.
        var _streamHeartbeats = {};
        // FIX (bug: real, still-broadcasting streams misdiagnosed as
        // ended on weak connections): raised from 90s. Confirmed via
        // live diagnostics that this app routinely runs on connections
        // as slow as ~2-9 K/s, where even a single small Firestore write
        // (now retried up to twice — see _writeHeartbeatWithRetry above)
        // can legitimately take well over a minute round-trip. 90s left
        // almost no margin for that reality and was declaring perfectly
        // live streams stale.
        // FIX (session 2026-07-19, seventh follow-up — "enable live
        // streaming to be on even while host minimize their phone and
        // navigate to other app"): 180s was still short enough that a
        // phone throttling/suspending its backgrounded JS timers (the 20s
        // heartbeat write included) while the host briefly checked
        // another app could leave the local dashboard card removed —
        // visually indistinguishable from the stream having actually
        // ended, even though isLive was never flipped in Firestore.
        // Widened to match the admin sweep's own new 10-minute tolerance
        // (see sweepGlobalStaleStreams in app-live-tiktok-patch.js) so
        // both layers agree on how long a backgrounded host gets before
        // anything treats them as gone.
        var HEARTBEAT_STALE_MS = 10 * 60 * 1000;
        function _isStreamFresh(s) {
            if (!s) return false;
            if (s.lastHeartbeat) {
                var age = Date.now() - Date.parse(s.lastHeartbeat);
                return isFinite(age) && age < HEARTBEAT_STALE_MS;
            }
            // No heartbeat field at all yet (host just went live, first
            // heartbeat hasn't fired) — allow a short grace window using
            // startedAt/startTime instead of hiding a brand-new stream.
            var started = s.startedAt ? Date.parse(s.startedAt) : (s.startTime || 0);
            return started && (Date.now() - started) < (2 * 60 * 1000);
        }
        function _removeStreamCard(sid) {
            // FIX (dashboard card lingering after End Live for OTHER viewers):
            // querySelector() only ever returns the FIRST matching element in
            // the whole document. syncProfileDashLive() (PART 8 below) clones
            // #dashboard-live-slider's innerHTML into #profile-dash-live-slider
            // whenever a viewer visits their profile tab while a stream is
            // live -- that clone carries the exact same
            // `.join-live-btn[data-stream-id]` markup into a SECOND container.
            // With only querySelector(), ending the stream removed just one of
            // the two copies, so a viewer who'd ever opened their profile tab
            // while the stream was live could still see it, stale, on their
            // profile dashboard after it ended. querySelectorAll()+forEach()
            // removes every copy, in every container, in one pass.
            document.querySelectorAll('.join-live-btn[data-stream-id="' + sid + '"]').forEach(function (card) {
                card.style.opacity = '0';
                setTimeout(function () { card.remove(); }, 300);
            });
            delete _knownStreamIds[sid];
            delete _knownStreamIds[sid + '-notified'];
            delete _streamHeartbeats[sid];
        }
        // Periodic sweep: catches streams that go stale with NO further
        // Firestore change event to react to (host crashed/force-quit —
        // heartbeats just stop, nothing ever fires 'modified' again).
        setInterval(function () {
            var now = Date.now();
            Object.keys(_streamHeartbeats).forEach(function (sid) {
                var hb = _streamHeartbeats[sid];
                if (hb && (now - hb) > HEARTBEAT_STALE_MS) _removeStreamCard(sid);
            });
        }, 20000);
        var _heartbeatTimer   = null;
        var _heartbeatStreamId = null;
        var _myPresenceRef    = null;
        var _presenceHeartbeatTimer = null;
        var _viewerCountUnsub = null;

        // ── HEARTBEAT ──────────────────────────────────────────────
        // A stream doc's mere existence isn't proof it's still live —
        // if a host's tab/app is killed without running the End Live
        // teardown (crash, force-quit, dead battery), the doc is left
        // behind with isLive:true forever. To let ANY client tell a
        // truly-live stream apart from an abandoned one, the host now
        // writes a lastHeartbeat timestamp every 20s while broadcasting.
        // See PART H in app-live-tiktok-patch.js for the sweep that
        // reads this and retires stale docs.
        // FIX: no longer also heartbeats a second "host_<id>" doc — that
        // duplicate was never read by anything (see the removed dual-write
        // in publishLiveStreamToFirestore below) and was a source of
        // spurious permission-denied entries whenever it went stale.
        // FIX (bug: "stream ended" falsely shown to guests while host is
        // still broadcasting — confirmed happening specifically on very
        // weak connections, ~2-9 K/s throughput): this write used to be a
        // fire-and-forget `.catch(function(){})` on a plain 20s interval.
        // On a slow/flaky connection a single write can legitimately take
        // much longer than 20s to land, or drop entirely — and with no
        // retry, that one miss (routine on a bad connection, not
        // exceptional) leaves lastHeartbeat stale for a full extra
        // interval or more, which every "is this stream still live"
        // freshness check elsewhere in the codebase (app-live.js's own
        // _isStreamFresh, the user-left verification a few lines below,
        // and app-patch-v17.js's guest-transfer check) reads as "the
        // stream has gone stale/ended," even though the host never
        // stopped broadcasting. Two changes: (1) write immediately when
        // broadcasting starts, rather than waiting for the first 20s
        // tick, so there's no artificial initial gap; (2) on failure,
        // retry a couple of times with backoff (2s, 5s) before giving up
        // on that attempt — most weak-signal misses clear within a few
        // seconds, same pattern already used for auth retries.
        function _writeHeartbeatWithRetry(streamId, attempt) {
            var db = window.fbDb;
            if (!db || !window._firebaseLoaded) return;
            if (!_heartbeatStreamId || _heartbeatStreamId !== streamId) return; // superseded/stopped
            attempt = attempt || 0;
            var RETRY_DELAYS = [2000, 5000];
            db.collection('active_streams').doc(streamId)
                .update({ lastHeartbeat: new Date().toISOString() })
                .catch(function () {
                    if (attempt >= RETRY_DELAYS.length) return; // give up on this attempt — the next scheduled tick will try again
                    setTimeout(function () {
                        _writeHeartbeatWithRetry(streamId, attempt + 1);
                    }, RETRY_DELAYS[attempt]);
                });
        }
        function _startHeartbeat(streamId) {
            _stopHeartbeat();
            _heartbeatStreamId = streamId;
            _writeHeartbeatWithRetry(streamId, 0); // immediate first write — no initial 20s gap
            _heartbeatTimer = setInterval(function() {
                if (!_heartbeatStreamId) return;
                _writeHeartbeatWithRetry(_heartbeatStreamId, 0);
            }, 20000);
        }
        function _stopHeartbeat() {
            if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
            _heartbeatStreamId = null;
        }
        window._liveStopHeartbeat = _stopHeartbeat;

        // ── VIEWER PRESENCE (real synced viewer count) ────────────────
        // FIX (gap: "real live viewer counts" never matched across
        // devices): the old counter only moved in response to Agora
        // 'user-published'/'user-unpublished' events, which ONLY fire for
        // guests who actively PUBLISH audio/video — a plain audience
        // member (setClientRole('audience')) never triggers them, so real
        // viewers were invisible to the count, and the number that DID
        // show was purely local to whichever device happened to receive
        // those events (never written anywhere shared). Every viewer —
        // host, accepted guest, or plain audience — now writes a small
        // heartbeat-backed presence doc to
        // active_streams/{streamId}/viewers/{uid}, and every screen
        // watching that stream subscribes to the SAME subcollection, so
        // the number is finally one shared fact instead of N local guesses.
        // A logged-out guest can still see the count update live (read is
        // public); they just can't add themselves to it, since writing
        // requires an authenticated uid per the rules.
        function _startViewerPresence(streamId) {
            _stopViewerPresence();
            var db = window.fbDb;
            if (!db || !window._firebaseLoaded || !streamId) return;
            var us = window.userState || {};
            // FIX (2026-08-13 — "live viewer count stuck at 1" no matter
            // how many people are actually watching): this doc's id — and
            // therefore the `uid` the security rule checks via
            // `request.auth.uid == uid` (firebase-rules.js,
            // active_streams/{streamId}/viewers/{uid}) — used to be
            // `us.id`, the app's own persistent userState.id. That is a
            // different id space than the live Firebase Auth uid
            // (anonymous or signed-in) on request.auth — the exact same
            // "app id != Firebase Auth uid" mismatch already documented
            // and fixed this same way throughout firebase-rules.js for
            // messages/chats/groups/broadcastLists/etc. So this write
            // permission-denied for essentially every viewer (host
            // included), presence was never actually recorded,
            // _startViewerCountListener's `live` count stayed at 0, and
            // the displayed count was permanently clamped to
            // Math.max(1, 0) = 1 regardless of real viewership. Keying by
            // the live Firebase Auth uid instead — present for guests too,
            // via this app's own anonymous-sign-in fallback — lets the
            // write satisfy the rule for anyone actually watching, not
            // only sessions where the two ids happened to coincide. The
            // old guest/no-id early-return is removed for the same
            // reason: a guest DOES have a usable Firebase Auth uid (the
            // anonymous session), it just isn't us.id.
            var myUid = window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid;
            if (!myUid) return; // no live Firebase Auth session yet — nothing this device can legally write under; the next join/heartbeat call retries
            _myPresenceRef = db.collection('active_streams').doc(streamId)
                .collection('viewers').doc(myUid);
            var writePresence = function() {
                if (!_myPresenceRef) return;
                _myPresenceRef.set({
                    userId:   us.id || myUid,
                    username: us.username || '',
                    fullName: us.fullName || us.username || 'Viewer',
                    avatar:   us.avatar || '',
                    lastSeen: new Date().toISOString()
                }, { merge: true }).catch(function() {});
            };
            writePresence();
            _presenceHeartbeatTimer = setInterval(writePresence, 20000);
        }
        function _stopViewerPresence() {
            if (_presenceHeartbeatTimer) { clearInterval(_presenceHeartbeatTimer); _presenceHeartbeatTimer = null; }
            if (_myPresenceRef) { var r = _myPresenceRef; _myPresenceRef = null; r.delete().catch(function() {}); }
        }
        window._liveStopViewerPresence = _stopViewerPresence;
        // FIX (startup crash: "_startViewerPresence is not defined"): the
        // start function was never exposed to window, only stop was. Two
        // call sites outside this closure (the window._agora debug object,
        // and initAgoraViewer) referenced the bare name directly, which
        // threw ReferenceError — in the window._agora case, during initial
        // page load, aborting this entire onReady callback before
        // publishLiveStreamToFirestore below could ever be defined.
        window._liveStartViewerPresence = _startViewerPresence;

        // Everyone watching (host or audience) subscribes to the same
        // presence subcollection. A doc is only counted "live" if its
        // heartbeat is under 45s old, so a tab that was killed without a
        // clean exit can't inflate the count forever.
        function _startViewerCountListener(streamId) {
            _stopViewerCountListener();
            var db = window.fbDb;
            if (!db || !window._firebaseLoaded || !streamId) {
                console.warn('[VIEWERCOUNT-DIAG] _startViewerCountListener skipped — db=' + !!db +
                    ', firebaseLoaded=' + !!window._firebaseLoaded + ', streamId=' + streamId);
                return;
            }
            _viewerCountUnsub = db.collection('active_streams').doc(streamId)
                .collection('viewers')
                .onSnapshot(function(snap) {
                    var now = Date.now();
                    var live = 0;
                    snap.forEach(function(doc) {
                        var d = doc.data() || {};
                        var seen = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
                        if (now - seen < 45000) live++;
                    });
                    var count = Math.max(1, live);
                    ['live-viewer-count', 'modal-viewer-count'].forEach(function(id) {
                        var el = document.getElementById(id);
                        if (el) el.textContent = count.toLocaleString();
                    });
                }, function() { /* offline/permission — leave last-known count on screen */ });
        }
        function _stopViewerCountListener() {
            if (_viewerCountUnsub) { _viewerCountUnsub(); _viewerCountUnsub = null; }
        }
        window._liveStopViewerCountListener = _stopViewerCountListener;
        // Same fix as _startViewerPresence above — start function was
        // never exposed, only stop was.
        window._liveStartViewerCountListener = _startViewerCountListener;

        // Host writes their stream to Firestore when going live
        window.publishLiveStreamToFirestore = async function(streamData) {
            // CRITICAL: Must use real Firestore, not the stub

            // The stub's set() is a no-op — other devices will never see the stream.
            // FIX (bug: "live stream no longer persistent/visible on other devices,
            // notifications disconnected"): this used to poll _firebaseLoaded for a
            // hard-capped 15s (30 tries * 500ms) and then silently `return` — on a
            // slow connection (confirmed in the field: sub-1KB/s) Firebase SDK init
            // can easily take longer than that, so the publish was abandoned before
            // Firebase ever came online, the stream doc was NEVER written, and every
            // other device (and every notification that depends on that doc existing)
            // had nothing to find. Now waits on the real `empyrean:firebase-ready`
            // event (fires exactly once, whenever init actually finishes, however
            // long that takes) instead of giving up on a fixed timer. A generous
            // 3-minute safety valve remains only to avoid hanging forever if Firebase
            // truly never comes up (e.g. no connection at all).
            if (!window._firebaseLoaded) {
                _agoraLog('[Live] Firebase not ready — waiting for it before publishing stream...');
                await new Promise(function(resolve) {
                    var done = false;
                    function finish() { if (done) return; done = true; clearTimeout(safety); resolve(); }
                    window.addEventListener('empyrean:firebase-ready', finish, { once: true });
                    if (window._firebaseReadyCallbacks) window._firebaseReadyCallbacks.push(finish);
                    var safety = setTimeout(finish, 180000);
                });
            }
            var db = window.fbDb;
            if (!db || !window._firebaseLoaded) {
                _agoraWarn('[Live] Real Firestore still unavailable after waiting — stream will only be visible locally. Will keep retrying in the background.');
                window.addEventListener('empyrean:firebase-ready', function _retryPublish() {
                    window.removeEventListener('empyrean:firebase-ready', _retryPublish);
                    if (typeof window.publishLiveStreamToFirestore === 'function') window.publishLiveStreamToFirestore(streamData);
                }, { once: true });
                return;
            }
            try {
                var channel = streamData._agoraChannel || ('empyrean-' + (streamData.streamId || Date.now()));
                var hostId = streamData.hostUserId || (window.userState && window.userState.id) || 'unknown';
                var hostName = (window.userState && window.userState.fullName) || 'Unknown Host';
                var hostUsername = (window.userState && window.userState.username) || '';
                var hostAvatar = (window.userState && window.userState.avatar) || '';
                var docData = {
                    streamId:      streamData.streamId,
                    hostId:        hostId,
                    hostName:      hostName,
                    hostUsername:  hostUsername,
                    hostAvatar:    hostAvatar,
                    // FIX (bug: "guest video incorrectly appears in the
                    // host's box"): viewers need a reliable way to tell the
                    // host's own published video apart from a co-guest's.
                    // The host's Agora uid (_safeUid — hash % 999999) uses a
                    // DIFFERENT formula than a guest's uid (safeGuestUid /
                    // _agoraUidForUserId — hash % 900000 + 100001), so it
                    // can't be recomputed from hostId the way a guest's can
                    // (see _findGuestMeta() below) — it has to be read
                    // directly. Written once here at publish time.
                    hostAgoraUid:  streamData._agoraUid || null,
                    title:         streamData.title || 'Live Stream',
                    background:    streamData.background || '',
                    channel:       channel,
                    startedAt:     new Date().toISOString(),
                    lastHeartbeat: new Date().toISOString(),
                    isLive:        true,
                    likes:         0
                    // REEL & LIVE BROADCAST CHANNEL — DECOUPLED (2026-08-11):
                    // this used to also carry origin/channelCategory/
                    // youtubeVideoId here so app-reel.js's composer could
                    // hand off into this exact Agora pipeline. Per this
                    // session's explicit instruction ("should not be
                    // connected to the already go live streaming section at
                    // all... don't link them at all"), the Reel & Live
                    // Broadcast Channel no longer talks to this function, to
                    // active_streams, or to Agora in any way — it now runs
                    // an entirely independent YouTube-embed broadcast flow
                    // against its own `reel_live_broadcasts` collection. See
                    // app-reel.js's own header comment for the new flow.
                };
                // Write main doc by streamId
                await db.collection('active_streams').doc(docData.streamId).set(docData);
                // FIX (bug: stray permission-denied noise on "host_*" docs, guest
                // accept/decline panel silently freezing): this used to ALSO write
                // a full duplicate of docData to a second doc, 'host_' + hostId,
                // "so any device can always find the host's active stream without
                // an index" — but nothing anywhere in the codebase ever actually
                // reads that doc by id (checked every caller of
                // active_streams/host_*). It was pure dead weight that:
                //   1) doubled every write (publish + every 30s heartbeat) for a
                //      doc nobody consumes,
                //   2) went from a `create` the first time a host goes live to an
                //      `update` on every restart, which only passes the Firestore
                //      rule when resource.data.hostId still exactly matches — any
                //      stale/partial doc left over from an earlier session (e.g.
                //      tab closed without a clean unpublish) makes that `update`
                //      fail with permission-denied, which is exactly the
                //      "active_streams/host_xxxxx — permission-denied" noise seen
                //      in the debug panel and mistaken for a rules bug.
                // Removed entirely — the real per-session doc (keyed by
                // docData.streamId) is the single source of truth every listener
                // already reads from.
                window._agoraActiveChannel = channel;
                _startHeartbeat(docData.streamId);
                // Host counts as one presence doc too, so the shared count
                // and viewer list both include them without special-casing.
                _startViewerPresence(docData.streamId);
                _startViewerCountListener(docData.streamId);
                _agoraLog('[Live] ✅ Stream published locally — DocId: ' + docData.streamId + ' | Channel: ' + channel + ' | Host: ' + hostName);
                // FIX 2026-07-17 ("other devices can't see the stream even
                // though it went live successfully" — traced to this exact
                // spot): the line this replaces —
                // `console.log('[Live] Firestore write confirmed. Other
                // devices WILL see this stream.')` — ran immediately after
                // the `await db.collection(...).set(docData)` above and
                // treated that await resolving as proof the write reached
                // the server. It doesn't: this app has offline persistence
                // enabled (see index.html's enablePersistence call), so
                // `.set()` resolves the moment the write lands in the
                // LOCAL cache — deliberately, so the host's own UI never
                // has to block on a slow network. On a device mid-blip at
                // the exact moment it goes live (the same weak/bouncing 4G
                // pattern already diagnosed elsewhere in this app), that
                // await still resolves fine and this log still fired,
                // telling the host "confirmed" while the actual document
                // sat queued on their device, unseen by anyone else, for
                // however long the blip lasted. That is precisely the
                // reported symptom: host UI says success, other devices
                // see nothing.
                //
                // FIX: attach a short-lived metadata listener on the exact
                // doc just written. `snapshot.metadata.hasPendingWrites`
                // is false only once this write has actually round-tripped
                // to the server — that is the one honest signal available.
                // If it doesn't clear within 8s, the host is told plainly
                // instead of a false "confirmed", and told again if/when
                // it finally does land (covers the "queued, then reconnects
                // 40s later" case, not just outright failure).
                (function watchPublishServerAck(streamId, hostConfirmName) {
                    var settled = false;
                    var unsub = db.collection('active_streams').doc(streamId)
                        .onSnapshot({ includeMetadataChanges: true }, function (snap) {
                            if (!snap || !snap.exists) return;
                            if (!snap.metadata.hasPendingWrites) {
                                settled = true;
                                console.log('[Live] ✅ Firestore write CONFIRMED with the server (not just local cache) — other devices will now see this stream.');
                                if (typeof window.pushNotification === 'function' || typeof window.showNotification === 'function') {
                                    // Only bother the host with an explicit
                                    // "now visible" toast if they were
                                    // already warned it might not be —
                                    // otherwise this would fire on every
                                    // single go-live, which is just noise.
                                    if (window._pv_publishWasDelayed) {
                                        (window.showNotification || window.pushNotification)('✅ You\'re back online — your stream is now visible to others.', 'success');
                                        window._pv_publishWasDelayed = false;
                                    }
                                }
                                if (unsub) unsub();
                            }
                        }, function () { /* listener error — safety timeout below still covers this */ });
                    setTimeout(function () {
                        if (settled) return;
                        window._pv_publishWasDelayed = true;
                        _agoraWarn('[Live] Publish has NOT reached the Firestore server after 8s — still only in this device\'s local cache. Other devices will not see this stream until the connection recovers.');
                        if (typeof window.showNotification === 'function') {
                            window.showNotification('⚠️ Weak connection — your stream may not be visible to others yet. It will appear automatically once your connection stabilizes.', 'warning');
                        }
                        // Deliberately do NOT unsubscribe here — keep
                        // listening so the "back online" confirmation above
                        // can still fire whenever the write actually lands,
                        // however long that takes. It self-cleans via the
                        // `if (unsub) unsub();` call once hasPendingWrites
                        // clears, or when the stream ends (next line).
                        window.addEventListener('empyrean:stream-ended-' + streamId, function _cleanup() {
                            window.removeEventListener('empyrean:stream-ended-' + streamId, _cleanup);
                            if (unsub) unsub();
                        }, { once: true });
                    }, 8000);
                })(docData.streamId, hostName);

                // FIX (bug: duplicate/unstable live notifications): this used to be
                // db.collection('notifications').add({...}), which creates a brand
                // new document every time this function runs for the SAME stream —
                // and it can run more than once per stream (the catch-block retry
                // below, or a resubmitted go-live form). Each extra call meant one
                // more "X is now LIVE" notification for the same event. Keying the
                // doc id to the streamId and using set() makes this idempotent: a
                // retry overwrites the same doc instead of creating a duplicate.
                try {
                    await db.collection('notifications').doc('live_' + docData.streamId).set({
                        type: 'live',
                        message: '🔴 ' + hostName + ' is now LIVE! Tap to join.',
                        hostId: hostId, hostName: hostName,
                        streamId: docData.streamId, channel: channel,
                        createdAt: new Date().toISOString(), read: false
                    });
                } catch(ne) {}

                // FIX (bug: "notification bell not linked to live streaming"):
                // window.notifyFriendsUserIsLive (defined in app-notifications.js)
                // pushes an immediate bell/toast notification to any followers
                // present in THIS session, separate from the Firestore
                // notifications/live_* doc above (which only reaches followers
                // on their next load/poll). It was fully implemented but never
                // actually called from anywhere in the live-streaming code —
                // this was the missing wire.
                try {
                    if (typeof window.notifyFriendsUserIsLive === 'function') {
                        window.notifyFriendsUserIsLive(hostName, docData.streamId);
                    }
                } catch(nfe) {}
            } catch(e) {
                _agoraWarn('[Live] Publish failed: ' + e.message);
                // Retry once after 3s
                setTimeout(function() { window.publishLiveStreamToFirestore(streamData); }, 3000);
            }
        };

        // Host removes their stream from Firestore when ending
        window.unpublishLiveStreamFromFirestore = async function(streamId) {
            _stopHeartbeat();
            _stopViewerPresence();
            _stopViewerCountListener();
            var db = window.fbDb;
            if (!db || !streamId) return;
            // Use delete() rather than update() — update() fails with permission-denied
            // when the doc doesn't exist yet (e.g. cleanup from a previous stale session)
            // or when Firestore rules require the document to already exist before update.
            // delete() is safe to call even if the doc is already gone.
            try { await db.collection('active_streams').doc(streamId).delete(); } catch(e) {}
            // FIX: no longer also deletes a "host_<id>" doc — that duplicate is
            // no longer written (see publishLiveStreamToFirestore above), so
            // there's nothing left to clean up here.
        };

        // ── Helper: build and insert one join card ──────────────────
        // FEATURE ("enable user to join live from the message avatar of the
        // host"): tracks which hostIds are currently live (kept in sync by
        // the active_streams listener below — set when a stream starts,
        // deleted when it ends) so ANY avatar anywhere in the app can offer
        // a "join live" tap without its own Firestore listener.
        window._liveHostStreamIds = window._liveHostStreamIds || {};

        // Call this from anywhere (e.g. tapping a host's avatar in a chat
        // thread) to join that host's live stream if they're currently
        // live. Returns true if found+joined, false otherwise (caller can
        // fall back to normal avatar/profile behavior in that case).
        window.joinLiveByHostId = function(hostId) {
            var sid = hostId && window._liveHostStreamIds[hostId];
            if (!sid) return false;
            var card = document.querySelector('.join-live-btn[data-stream-id="' + sid + '"]');
            if (card) { card.click(); return true; }
            return false;
        };

        // Delegated handler: any element anywhere in the app carrying
        // data-live-avatar-for="<hostUserId>" becomes a "tap to join their
        // live stream, if they're live right now" avatar automatically —
        // this is the one-line hookup needed in the Messages/chat thread
        // template (a separate module, not included in this batch of
        // files): give the host's avatar element
        // data-live-avatar-for="<that user's id>" and this handles the
        // rest. If the host isn't currently live, the tap is left alone
        // (falls through to the avatar's existing click behavior, e.g.
        // opening their profile).
        document.addEventListener('click', function(e) {
            var el = e.target.closest('[data-live-avatar-for]');
            if (!el) return;
            var hostId = el.getAttribute('data-live-avatar-for');
            if (window.joinLiveByHostId(hostId)) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        // FIX ("host stream doesn't immediately appear on the public
        // dashboard at times"): _insertStreamCard used to just `return` when
        // #dashboard-live-slider wasn't in the DOM yet (e.g. the Firestore
        // snapshot for a brand-new stream arrives a beat before the
        // dashboard section has actually rendered, right after login/app
        // start). That card was then gone for good — nothing re-inserted it
        // until the NEXT unrelated re-attach (focus/visibility change,
        // navigating away and back). Now, a missed insert is queued and a
        // short-lived watcher flushes it the moment the slider shows up,
        // instead of relying on some other event to happen to fire later.
        var _pendingStreamCards = [];
        var _pendingCardsWatcher = null;
        function _flushPendingStreamCards() {
            var slider = document.getElementById('dashboard-live-slider');
            if (!slider || !_pendingStreamCards.length) return;
            var queued = _pendingStreamCards;
            _pendingStreamCards = [];
            queued.forEach(function (s) { _insertStreamCard(s, slider); });
        }
        function _watchForSliderAndFlush() {
            if (_pendingCardsWatcher) return;
            _pendingCardsWatcher = new MutationObserver(function () {
                if (document.getElementById('dashboard-live-slider')) {
                    _flushPendingStreamCards();
                    if (!_pendingStreamCards.length) {
                        _pendingCardsWatcher.disconnect();
                        _pendingCardsWatcher = null;
                    }
                }
            });
            _pendingCardsWatcher.observe(document.body, { childList: true, subtree: true });
            // Safety poll too, in case the slider is swapped in via a path
            // the observer's subtree somehow misses (e.g. innerHTML replace
            // higher up that isn't itself an added/removed node event).
            var pollTries = 0;
            var pollTimer = setInterval(function () {
                pollTries++;
                _flushPendingStreamCards();
                if (!_pendingStreamCards.length || pollTries > 20) {
                    clearInterval(pollTimer);
                    if (!_pendingStreamCards.length && _pendingCardsWatcher) {
                        _pendingCardsWatcher.disconnect();
                        _pendingCardsWatcher = null;
                    }
                }
            }, 500);
        }

        function _insertStreamCard(s, slider) {
            var sid = s.streamId;
            if (!slider) {
                // Don't drop it — queue for the moment the slider exists.
                if (s && s.streamId) _pendingStreamCards.push(s);
                _watchForSliderAndFlush();
                return;
            }
            // Remove duplicate if exists (may have been inserted by createDashboardLiveCard)
            var existing = slider.querySelector('.join-live-btn[data-stream-id="'+sid+'"]');
            if (existing) {
                // Update the agoraChannel data in case it wasn't set before
                if (s.channel && !existing.dataset.agoraChannel) {
                    existing.dataset.agoraChannel = s.channel;
                }
                return; // card already there
            }
            // Same host, different streamId (e.g. they ended and restarted before
            // the old doc was fully cleaned up) — replace rather than show two tiles
            if (s.hostId) {
                var oldForHost = slider.querySelector('.join-live-btn[data-host-id="' + s.hostId + '"]');
                if (oldForHost) oldForHost.remove();
            }
            // Hide the "no live streams" empty placeholder
            var emptyEl = document.getElementById('live-slider-empty');
            if (emptyEl) emptyEl.style.display = 'none';

            var card = document.createElement('div');
            card.className = 'live-stream-preview-card join-live-btn';
            card.dataset.streamId     = sid;
            card.dataset.hostId       = s.hostId || '';
            card.dataset.hostName     = s.hostName || 'Host';
            card.dataset.hostUsername = s.hostUsername || '';
            card.dataset.hostAvatar   = s.hostAvatar || '';
            card.dataset.hostAgoraUid = (s.hostAgoraUid !== undefined && s.hostAgoraUid !== null) ? String(s.hostAgoraUid) : '';
            card.dataset.streamTitle  = s.title || 'Live Stream';
            card.dataset.background   = s.background || '';
            card.dataset.agoraChannel = s.channel || ('empyrean-' + sid);

            var bg = s.background || 'linear-gradient(160deg,#0A0E27,#1B2B8B)';
            if (bg.startsWith('http') || bg.startsWith('blob:') || bg.startsWith('url(')) {
                card.style.backgroundImage  = bg.startsWith('url(') ? bg : 'url(' + bg + ')';
                card.style.backgroundSize   = 'cover';
                card.style.backgroundPosition = 'center';
            } else { card.style.background = bg; }

            card.style.cssText += ';flex:0 0 180px;height:200px;border-radius:16px;overflow:hidden;position:relative;cursor:pointer;';

            card.innerHTML =
                '<div class="live-preview-header" style="position:absolute;top:10px;left:10px;right:10px;z-index:2;">' +
                    '<span class="live-tag" style="background:rgba(239,68,68,0.9);color:white;padding:3px 10px;border-radius:50px;font-size:0.7rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;">' +
                        '<i class="fas fa-circle" style="font-size:0.5rem;animation:fa-beat 1s infinite;"></i> LIVE' +
                    '</span>' +
                '</div>' +
                '<div style="position:absolute;inset:0;background:linear-gradient(transparent 40%,rgba(0,0,0,0.85));z-index:1;"></div>' +
                '<div class="live-preview-footer" style="position:absolute;bottom:0;left:0;right:0;padding:12px;z-index:2;display:flex;align-items:center;gap:8px;">' +
                    '<img src="' + (s.hostAvatar||'') + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid white;flex-shrink:0;" >' +
                    '<div style="flex:1;min-width:0;">' +
                        '<strong style="display:block;font-size:0.82rem;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (s.hostName||'Host') + '</strong>' +
                        '<span style="font-size:0.7rem;color:rgba(255,255,255,0.75);">' + (s.title||'Tap to join') + '</span>' +
                    '</div>' +
                '</div>' +
                '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2;background:rgba(239,68,68,0.85);color:white;padding:8px 16px;border-radius:50px;font-size:0.78rem;font-weight:700;pointer-events:none;">▶ Join Live</div>';

            slider.prepend(card);
            _knownStreamIds[sid] = true;
        }

        // All devices subscribe to active_streams in real time
        window.startLiveStreamListener = function() {
            var db = window.fbDb;
            if (!db) { setTimeout(window.startLiveStreamListener, 2000); return; }

            // Guard: only attach to real Firestore, not the stub
            // The stub's onSnapshot fires once with empty data and never again.
            // FIX (bug: "live stream no longer persistent across devices — disappears
            // instead of staying visible"): this used to give up after a hard-capped
            // 30s (800ms * ~37 tries) and never try again. On a slow connection
            // (confirmed sub-1KB/s in the field) Firebase can take much longer than
            // that to finish initializing, so on those devices this listener simply
            // never attached, ever — that device would never see any live stream
            // card. Now also resolves on the real `empyrean:firebase-ready` event
            // (fires once, whenever init actually finishes), so a slow connection
            // just means a late attach instead of a permanent no-attach.
            if (!window._firebaseLoaded) {
                var _liveTimer = setInterval(function() {
                    if (window._firebaseLoaded) {
                        clearInterval(_liveTimer);
                        window.startLiveStreamListener();
                    }
                }, 800);
                window.addEventListener('empyrean:firebase-ready', function _liveReadyRetry() {
                    window.removeEventListener('empyrean:firebase-ready', _liveReadyRetry);
                    clearInterval(_liveTimer);
                    window.startLiveStreamListener();
                }, { once: true });
                return;
            }

            if (_streamListener) { try { _streamListener(); } catch(e) {} _streamListener = null; }

            // ── Full scan on attach: no where() clause = no index needed ──
            // Filter client-side for isLive docs
            db.collection('active_streams')
                .orderBy('startedAt', 'desc')
                .limit(20)
                .get()
                .then(function(snap) {
                    if (!snap || snap.empty) return;
                    var slider = document.getElementById('dashboard-live-slider');
                    snap.forEach(function(doc) {
                        var s = doc.data();
                        if (s && s.isLive === true && _isStreamFresh(s)) {
                            _insertStreamCard(s, slider);
                            _streamHeartbeats[s.streamId] = s.lastHeartbeat ? Date.parse(s.lastHeartbeat) : Date.now();
                            if (s.hostId) window._liveHostStreamIds[s.hostId] = s.streamId;
                        }
                    });
                })
                .catch(function(e) {
                    // Fallback: scan without orderBy if no index
                    db.collection('active_streams').get()
                        .then(function(snap2) {
                            if (!snap2 || snap2.empty) return;
                            var slider = document.getElementById('dashboard-live-slider');
                            snap2.forEach(function(doc) {
                                var s = doc.data();
                                if (s && s.isLive === true && _isStreamFresh(s)) {
                                    _insertStreamCard(s, slider);
                                    _streamHeartbeats[s.streamId] = s.lastHeartbeat ? Date.parse(s.lastHeartbeat) : Date.now();
                                    if (s.hostId) window._liveHostStreamIds[s.hostId] = s.streamId;
                                }
                            });
                        }).catch(function(){});
                });

            // Real-time listener: no where() = no index required
            // Client-side filter handles isLive check
            _streamListener = db.collection('active_streams')
                .onSnapshot(function(snapshot) {
                    if (!snapshot) return;
                    snapshot.docChanges().forEach(function(change) {
                        var s     = change.doc.data();
                        if (!s || !s.streamId) return; // skip malformed docs
                        var sid   = s.streamId;
                        var myId  = window.userState && window.userState.id;
                        var isMe  = myId && myId === s.hostId;

                        // Client-side isLive filter (replaces where() query that needs index)
                        if (change.type === 'added' || change.type === 'modified') {
                            if (!s.isLive) {
                                // Stream ended — remove card
                                _removeStreamCard(sid);
                                if (s.hostId && window._liveHostStreamIds[s.hostId] === sid) delete window._liveHostStreamIds[s.hostId];
                                return;
                            }
                            // FIX ("previous streams still show on the public
                            // dashboard after logout"): isLive:true is no
                            // longer taken at face value — a doc can get
                            // stuck there if the host's device never got a
                            // chance to flip it back (crash, force-quit,
                            // dropped connection). A real host's heartbeat
                            // updates this same doc every 20s, so an
                            // isLive:true doc whose heartbeat has already
                            // gone stale is treated as dead and never shown/
                            // kept on the dashboard, regardless of what the
                            // isLive field itself says.
                            if (!_isStreamFresh(s)) {
                                _removeStreamCard(sid);
                                return;
                            }
                            _streamHeartbeats[sid] = s.lastHeartbeat ? Date.parse(s.lastHeartbeat) : Date.now();
                        }

                        if (change.type === 'added' || (change.type === 'modified' && s.isLive)) {
                            var slider = document.getElementById('dashboard-live-slider');
                            _insertStreamCard(s, slider);
                            if (s.hostId) window._liveHostStreamIds[s.hostId] = sid;

                            // Show join banner on other devices
                            if (!isMe && !_knownStreamIds[sid + '-notified']) {
                                _knownStreamIds[sid + '-notified'] = true;
                                if(typeof window.pushNotification==='function'){
                                    // FIX: this read s.channelName, a field that's never written to
                                    // active_streams (publishLiveStreamToFirestore writes it as
                                    // `channel` — see _insertStreamCard above, which reads s.channel
                                    // correctly). channelName was always undefined here, so tapping
                                    // this notification fell back to the raw streamId instead of the
                                    // real Agora channel ('empyrean-'+streamId) and joined nothing —
                                    // a blank screen on a path that looked wired up correctly.
                                    window.pushNotification('🔴 '+s.hostName+' is LIVE! Tap to join.','live',null,
                                        {channelName:s.channel||s.streamId||sid,streamId:sid,hostName:s.hostName||''});
                                }
                                // Red banner at top with Join Now button
                                var oldBanner = document.getElementById('live-join-banner');
                                if (oldBanner) oldBanner.remove();
                                var banner = document.createElement('div');
                                banner.id = 'live-join-banner';
                                banner.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#EF4444,#DC2626);color:white;padding:12px 20px;border-radius:16px;box-shadow:0 8px 30px rgba(239,68,68,0.4);z-index:9999;display:flex;align-items:center;gap:12px;max-width:340px;width:90%;';
                                var joinBtn = document.createElement('button');
                                joinBtn.style.cssText = 'background:white;color:#DC2626;border:none;border-radius:10px;padding:8px 14px;font-size:0.82rem;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;';
                                joinBtn.textContent = 'Join Now';
                                joinBtn.onclick = function() {
                                    banner.remove();
                                    var card = document.querySelector('.join-live-btn[data-stream-id="' + sid + '"]');
                                    if (card) card.click();
                                };
                                var dismissBtn = document.createElement('button');
                                dismissBtn.style.cssText = 'background:rgba(255,255,255,0.25);border:none;color:white;border-radius:50%;width:26px;height:26px;cursor:pointer;flex-shrink:0;font-size:1rem;';
                                dismissBtn.innerHTML = '&times;';
                                dismissBtn.onclick = function() { banner.remove(); };
                                var info = document.createElement('div');
                                info.style.cssText = 'flex:1;min-width:0;';
                                info.innerHTML = '<strong style="display:block;font-size:0.88rem;">' + (s.hostName||'Host') + ' is LIVE!</strong><span style="font-size:0.75rem;opacity:0.85;">' + (s.title||'') + '</span>';
                                banner.appendChild(document.createElement('i')).className = 'fas fa-circle';
                                banner.appendChild(info);
                                banner.appendChild(joinBtn);
                                banner.appendChild(dismissBtn);
                                if (!document.getElementById('live-slide-anim')) {
                                    var st = document.createElement('style');
                                    st.id = 'live-slide-anim';
                                    st.textContent = '@keyframes liveSlideDown{from{opacity:0;top:50px}to{opacity:1;top:70px}}#live-join-banner{animation:liveSlideDown .3s ease;}';
                                    document.head.appendChild(st);
                                }
                                document.body.appendChild(banner);
                                setTimeout(function() { if (banner.parentElement) banner.remove(); }, 12000);
                            }
                        }

                        if (change.type === 'removed' || (change.type === 'modified' && !s.isLive)) {
                            // Remove card when stream ends
                            // FIX: was document.querySelector() (single element) --
                            // see _removeStreamCard()'s own comment above for why
                            // that left a stale duplicate behind on the profile
                            // dashboard. querySelectorAll()+forEach() clears every
                            // copy of this stream's card, in every slider.
                            var cards = document.querySelectorAll('.join-live-btn[data-stream-id="'+sid+'"]');
                            if (cards.length) {
                                cards.forEach(function(c) {
                                    c.style.opacity = '0';
                                    c.style.transition = 'opacity .4s';
                                });
                                setTimeout(function() {
                                    cards.forEach(function(c) { c.remove(); });
                                    // Show empty state if no other live cards remain
                                    var slider2 = document.getElementById('dashboard-live-slider');
                                    if (slider2 && !slider2.querySelector('.join-live-btn')) {
                                        var emptyEl2 = document.getElementById('live-slider-empty');
                                        if (emptyEl2) emptyEl2.style.display = '';
                                    }
                                }, 400);
                            }
                            delete _knownStreamIds[sid];
                            delete _knownStreamIds[sid+'-notified'];
                            delete _streamHeartbeats[sid];
                            var ld = window.liveStreamData;
                            if (ld && ld.streamId === sid && !isMe && typeof window.showNotification === 'function') {
                                window.showNotification('📴 This live stream has ended.', 'info');
                            }
                        }
                    });
                }, function(err) {
                    console.warn('[Live] Listener error:', err.message);
                    setTimeout(window.startLiveStreamListener, 10000);
                });
            console.log('[Live] Real-time stream listener active');
        };

        // Expose viewer join helper
        window.joinLiveAsViewer=function(channel,hostName){
            if(channel)window._agoraActiveChannel=channel;
            // If this is the host rejoining their own stream
            if(window.liveStreamData&&window.liveStreamData.streamId===channel&&!window.liveStreamData.isLive){
                var _lo=document.getElementById('go-live-modal-overlay');
                if(_lo){_lo.style.display='flex';_lo.classList.add('show');document.body.classList.add('modal-open');}
                if(typeof initAgoraHost==='function'){
                    (window._agoraAvailable ? Promise.resolve(true) : _ensureAgoraSdkReady())
                        .then(function(ready){ if(ready) return initAgoraHost(channel); })
                        .catch(function(e){console.warn('[Rejoin]',e);});
                }
            }
        };

        // Auto-start listener — FIX Bug 1: start for ALL users including guests
        // so live streams are globally visible without requiring login
        (function() {
            function _tryStartLiveListener() {
                if (window._firebaseLoaded) {
                    window.startLiveStreamListener();
                } else {
                    // FIX: same root cause as the 30s cap removed above — see the
                    // comment in startLiveStreamListener. Add the firebase-ready
                    // event as a guaranteed trigger instead of abandoning after 30s.
                    var _t = setInterval(function() {
                        if (window._firebaseLoaded) {
                            clearInterval(_t);
                            window.startLiveStreamListener();
                        }
                    }, 600);
                    window.addEventListener('empyrean:firebase-ready', function _autoStartReadyRetry() {
                        window.removeEventListener('empyrean:firebase-ready', _autoStartReadyRetry);
                        clearInterval(_t);
                        window.startLiveStreamListener();
                    }, { once: true });
                }
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', _tryStartLiveListener);
            } else {
                _tryStartLiveListener();
            }
        })();

        document.addEventListener('empyrean-init-done', function() {
            // Restart listener after login — real Firebase is guaranteed ready here
            if (_streamListener) { try { _streamListener(); } catch(e) {} _streamListener = null; }
            window._postsListener = null;
            window._newsListener = null;
            window._mktListener = null;
            setTimeout(window.startLiveStreamListener, 500);
            // Also restart post/news/mkt listeners
            if (typeof window._startRealtimeListeners === 'function') {
                setTimeout(window._startRealtimeListeners, 600);
            }
        });

        // FIX ("live streaming no longer displaying in the dashboard
        // section"): a Firestore onSnapshot listener started on a very
        // slow or briefly-dropped connection can go quietly dead without
        // ever firing its own error callback — it just stops delivering
        // updates. `_streamListener` still looks "attached" in that case,
        // but nothing repopulates the dashboard slider for the rest of
        // the session. Re-running the attach on visibility/focus regain
        // is a no-op if the existing listener is still healthy (it's just
        // replaced with an equivalent one) and recovers it if it died.
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible' && typeof window.startLiveStreamListener === 'function') {
                window.startLiveStreamListener();
            }
        });
        window.addEventListener('focus', function() {
            if (typeof window.startLiveStreamListener === 'function') window.startLiveStreamListener();
        });

        // FIX ("live streaming still doesn't appear in the general public
        // dashboard"): every call above is conditional on something else
        // happening first — 'empyrean-init-done', a focus/visibility change,
        // or another feature's success callback. If 'empyrean-init-done' has
        // ANY path that skips it (a different guest-mode init route, or a
        // race where this script evaluates before that listener is
        // registered elsewhere), the dashboard's live slider never
        // populates for that session — no error, just nothing ever asks
        // Firestore for the list. This call runs the moment this script
        // itself loads, so there's always one attempt that doesn't depend
        // on any other event firing correctly first. Safe to call more than
        // once — the function already guards/re-attaches cleanly.
        window.startLiveStreamListener();

    })();

    /* ─────────────────────────────────────────────
       PART 6 — STATUS MEDIA UPLOAD FIX
    ───────────────────────────────────────────── */
    document.addEventListener('change', function(e) {
        const statusInput = e.target.closest('#status-media-input, [id*="status"][id*="input"]');
        if (!statusInput) return;
        const files = Array.from(statusInput.files || []);
        if (!files.length) return;
        window._statusMediaFiles = files;
        const preview = document.getElementById('status-media-preview') || document.querySelector('.status-media-preview');
        if (preview) {
            preview.innerHTML = '';
            files.forEach(function(f) {
                const url = URL.createObjectURL(f);
                const d = document.createElement('div');
                d.style.cssText = 'display:inline-block;margin:4px;border-radius:8px;overflow:hidden;';
                d.innerHTML = f.type.startsWith('video/')
                    ? '<video src="' + url + '" style="width:80px;height:80px;object-fit:cover;" muted></video>'
                    : '<img src="' + url + '" style="width:80px;height:80px;object-fit:cover;">';
                preview.appendChild(d);
            });
        }
    });

    /* ─────────────────────────────────────────────
       PART 7 — COMMUNITY REPORT MEDIA UPLOAD FIX
    ───────────────────────────────────────────── */
    document.addEventListener('change', function(e) {
        const crisisInput = e.target.closest('#crisis-media-input');
        if (!crisisInput) return;
        const files = Array.from(crisisInput.files || []);
        window.crisisMediaFiles = files;
        const preview = document.getElementById('crisis-media-preview');
        if (!preview) return;
        preview.innerHTML = '';
        files.forEach(function(f) {
            const url = URL.createObjectURL(f);
            const d = document.createElement('div');
            d.style.cssText = 'display:inline-block;margin:4px;border-radius:8px;overflow:hidden;';
            d.innerHTML = f.type.startsWith('video/')
                ? '<video src="' + url + '" style="width:80px;height:80px;object-fit:cover;" muted></video>'
                : '<img src="' + url + '" style="width:80px;height:80px;object-fit:cover;">';
            preview.appendChild(d);
        });
    });

    /* ─────────────────────────────────────────────
       PART 8 — PROFILE DASHBOARD LIVE SYNC
       Mirror live stream cards into profile dash
    ───────────────────────────────────────────── */
    function syncProfileDashLive() {
        const mainSlider = document.getElementById('dashboard-live-slider');
        const profileSlider = document.getElementById('profile-dash-live-slider');
        if (!mainSlider || !profileSlider) return;
        profileSlider.innerHTML = mainSlider.innerHTML || '<div style="color:var(--text-muted);font-size:0.85rem;padding:20px;">No active live streams.</div>';
    }

    // Sync when navigating to profile
    document.addEventListener('click', function(e) {
        const navLink = e.target.closest('.nav-link[data-target="profile"], .mobile-nav-item[data-target="profile"]');
        if (navLink) setTimeout(syncProfileDashLive, 600);
    });

    /* ─────────────────────────────────────────────
       PART 9 — PASSWORD STRENGTH INDICATOR in Signup
    ───────────────────────────────────────────── */
    document.addEventListener('input', function(e) {
        const pwInput = e.target;
        if (!pwInput || pwInput.id !== 'signup-password') return;
        const val = pwInput.value;
        let strength = 0;
        if (val.length >= 8) strength++;
        if (/[A-Z]/.test(val)) strength++;
        if (/[a-z]/.test(val)) strength++;
        if (/[0-9]/.test(val)) strength++;
        if (/[^A-Za-z0-9]/.test(val)) strength++;

        let indicator = document.getElementById('pw-strength-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'pw-strength-indicator';
            indicator.style.cssText = 'margin-top:6px;height:4px;border-radius:4px;transition:all 0.3s;';
            if (pwInput.parentNode) pwInput.parentNode.appendChild(indicator);

            const label = document.createElement('div');
            label.id = 'pw-strength-label';
            label.style.cssText = 'font-size:0.76rem;margin-top:4px;font-weight:600;';
            if (pwInput.parentNode) pwInput.parentNode.appendChild(label);
        }
        const label = document.getElementById('pw-strength-label');
        const colors = ['#ef4444','#f97316','#eab308','#22c55e','#10b981'];
        const labels = ['Very weak','Weak','Fair','Strong','Very strong'];
        const widths = ['20%','40%','60%','80%','100%'];
        if (val.length === 0) {
            indicator.style.background = 'transparent';
            indicator.style.width = '0%';
            if (label) label.textContent = '';
        } else {
            const idx = Math.max(0, strength - 1);
            indicator.style.background = colors[idx];
            indicator.style.width = widths[idx];
            if (label) { label.textContent = labels[idx]; label.style.color = colors[idx]; }
        }
    });

    /* ─────────────────────────────────────────────
       PART 10 — CLOSEST SCOPE BUG — GLOBAL PATCH
       Any secondary listener that references `closest`
       as a free variable now uses e.target.closest
    ───────────────────────────────────────────── */
    // All secondary listeners in this file already use e.target.closest() 
    // The main handler at line ~7195 defines its own local `closest` correctly.
    // Expose a window-level fallback for any stray references:
    if (typeof window.closest === 'undefined') {
        // Don't override Element.prototype.closest — just provide a safe wrapper
        window._safeClosest = function(el, selector) {
            try { return el && el.closest ? el.closest(selector) : null; } catch(e) { return null; }
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // FINAL FIX BLOCK — Runtime patches applied after all scripts load
    // ═══════════════════════════════════════════════════════════════
    (function applyFinalFixes() {

        // FIX A: Prevent initializeApp recursive wrapping
        // Guard against multiple wrappers calling each other
        if (!window._initAppGuard) {
            window._initAppGuard = true;
            const _safeInit = window.initializeApp;
            if (typeof _safeInit === 'function') {
                window.initializeApp = function guardedInit(guestMode, adminMode, userData) {
                    if (window._initAppRunning) return;
                    window._initAppRunning = true;
                    try { _safeInit.call(this, guestMode, adminMode, userData); }
                    finally { setTimeout(() => { window._initAppRunning = false; }, 100); }
                };
            }
        }

        // FIX B: Camera permission — pre-request on page load for faster go-live
        // On Android, getUserMedia MUST be triggered from a user gesture.
        // We attach a one-time permission primer to the Go Live nav click.
        var _cameraPermPrimed = false;
        document.addEventListener('click', function(e) {
            var goLiveTarget = e.target.closest && e.target.closest('[data-target="go-live"], .go-live-btn');
            if (goLiveTarget && !_cameraPermPrimed) {
                _cameraPermPrimed = true;
                // Pre-request camera in user-gesture context so the later getUserMedia is allowed
                if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                        .then(function(stream) {
                            // Store pre-acquired stream for immediate use when live modal opens
                            if (window.liveStreamData) window.liveStreamData._localStream = stream;
                            else window._preLiveStream = stream;
                        })
                        .catch(function(err) {
                            console.warn('[Empyrean] Camera pre-request failed:', err.name);
                        });
                }
            }
        }, true);

        // FIX C: Patch startHostCamera to use pre-acquired stream if available
        var _patchStartCamera = setInterval(function() {
            if (window.liveStreamData !== undefined) {
                clearInterval(_patchStartCamera);
                // If we pre-acquired a stream before the modal opened, attach it
                if (window._preLiveStream && !window.liveStreamData._localStream) {
                    window.liveStreamData._localStream = window._preLiveStream;
                    window._preLiveStream = null;
                }
            }
        }, 500);

        // FIX D: Mobile nav — ensure top positioning overrides any bottom CSS
        var mobileNav = document.getElementById('mobile-bottom-nav');
        if (mobileNav) {
            mobileNav.style.top = '0';
            mobileNav.style.bottom = 'auto';
            mobileNav.style.borderTop = 'none';
            mobileNav.style.borderBottom = '1px solid rgba(10,14,39,0.08)';
            mobileNav.style.boxShadow = '0 4px 20px rgba(10,14,39,0.08)';
            // Adjust main content top padding
            var mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.style.paddingBottom = '';
                mainContent.style.paddingTop = '68px';
            }
        }

        // FIX E: Public dashboard feed — ensure ALL posts appear (remove follow filter)
        // Patch createNewPostElement to always append to #feed-container regardless of author
        var _origCreatePost = window.createNewPostElement;
        if (typeof _origCreatePost === 'function' && !window._createPostPatched) {
            window._createPostPatched = true;
            // The real fix: when any post is created, also add to public feed if not already there
            var _feedObserverActive = false;
            if (!_feedObserverActive) {
                _feedObserverActive = true;
                document.addEventListener('empyrean:postCreated', function(ev) {
                    var feedContainer = document.getElementById('feed-container');
                    var emptyState = document.getElementById('feed-empty-state');
                    if (feedContainer && ev.detail && ev.detail.element) {
                        var existing = ev.detail.postId ? feedContainer.querySelector('[data-post-id="' + ev.detail.postId + '"]') : null;
                        if (!existing) {
                            feedContainer.prepend(ev.detail.element);
                            if (emptyState) emptyState.style.display = 'none';
                        }
                    }
                });
            }
        }

    })();

    console.log('[Empyrean] Comprehensive fix pack loaded ✅ — Agora:', window._agoraAvailable ? 'Active' : 'Fallback mode');

    // ═══════════════════════════════════════════════════════════
    // FINAL PATCH BLOCK — Empyrean v5.1 targeted bug fixes
    // ═══════════════════════════════════════════════════════════
    (function applyV5Patches() {

        // PATCH 1: Community Reporting (crisis-form) upload binding
        // Ensure crisisMediaFiles is always synced to window scope
        var crisisInput = document.getElementById('crisis-media-input');
        if (crisisInput && !crisisInput._v51) {
            crisisInput._v51 = true;
            crisisInput.addEventListener('change', function() {
                window.crisisMediaFiles = Array.from(this.files || []);
                var p = document.getElementById('crisis-media-preview');
                if (!p) return;
                p.innerHTML = '';
                window.crisisMediaFiles.forEach(function(f) {
                    var url = URL.createObjectURL(f);
                    var d = document.createElement('div');
                    d.style.cssText = 'display:inline-block;margin:4px;border-radius:8px;overflow:hidden;';
                    d.innerHTML = f.type.startsWith('video/')
                        ? '<video src="' + url + '" style="width:80px;height:80px;object-fit:cover;" muted playsinline></video>'
                        : '<img src="' + url + '" style="width:80px;height:80px;object-fit:cover;">';
                    p.appendChild(d);
                });
            });
        }

        // PATCH 2: SOS upload binding — ensure window.sosMediaFiles always current
        var sosInput = document.getElementById('sos-media-input');
        if (sosInput && !sosInput._v51) {
            sosInput._v51 = true;
            sosInput.addEventListener('change', function() {
                window.sosMediaFiles = Array.from(this.files || []);
                var p = document.getElementById('sos-media-preview');
                if (!p) return;
                p.innerHTML = '';
                window.sosMediaFiles.forEach(function(f) {
                    var url = URL.createObjectURL(f);
                    var d = document.createElement('div');
                    d.style.cssText = 'display:inline-block;margin:4px;border-radius:8px;overflow:hidden;';
                    d.innerHTML = f.type.startsWith('video/')
                        ? '<video src="' + url + '" style="width:80px;height:80px;object-fit:cover;" muted playsinline></video>'
                        : '<img src="' + url + '" style="width:80px;height:80px;object-fit:cover;">';
                    p.appendChild(d);
                });
            });
        }

        // PATCH 3: Status bar — force visible after any status post
        // Intercept renderStatusBar to always keep bar visible
        var _origRSB = window.renderStatusBar;
        if (_origRSB && !window._rsb_patched) {
            window._rsb_patched = true;
            window.renderStatusBar = function() {
                _origRSB.apply(this, arguments);
                var sbc = document.getElementById('status-bar-container');
                if (sbc) { sbc.classList.add('visible'); sbc.style.display = 'block'; }
            };
        }

        // PATCH 4: Reel upload — ensure reel-video-file is never blocked by browser native validation
        var reelForm = document.getElementById('reel-upload-form');
        if (reelForm && !reelForm._v51) {
            reelForm._v51 = true;
            reelForm.setAttribute('novalidate', 'true');
        }

        // PATCH 5: REMOVED — this was the root cause of "nothing works in the
        // live screen" (host control panel, gift button, viewer count, viewer
        // rankings, and the heart-bubble tap all silently no-op'ing).
        //
        // Every one of those handlers in app-fixes.js is wrapped in a single
        // `if (liveStreamData.isLive) { ... }` gate. This old listener fired on
        // ANY click whose e.target was exactly #go-live-modal-overlay itself
        // (not a child) and immediately zeroed out isLive -- but it did NOT
        // close the modal or tear down Agora. So a single stray tap on the
        // modal's own background (easy to hit: the header/footer rows have gaps,
        // and the video area isn't always full-bleed while Agora is still
        // connecting) would leave the live screen fully visible while every
        // gated control quietly stopped responding, with no error and no visual
        // change -- exactly what was reported.
        //
        // Ending a stream now has one, single, correct affordance:
        // #tk-end-live-btn -> endLiveStreamHandler() (app-live-tiktok-patch.js),
        // which does full Agora + Firestore teardown AND sets isLive:false AND
        // closes the modal, all together. This listener duplicated one third of
        // that job, out of order, and broke the UI in the process -- removing
        // it entirely rather than patching it, since nothing should silently
        // flip isLive without also tearing down the stream.

        // PATCH 6: Sign-in form — ensure login-view is visible when auth modal opens
        document.addEventListener('click', function(e) {
            var showLogin = e.target.closest && (e.target.closest('#login-signup-btn') || e.target.closest('#show-login'));
            if (showLogin) {
                setTimeout(function() {
                    var lv = document.getElementById('login-view');
                    var sv = document.getElementById('signup-view');
                    if (lv) lv.style.display = 'block';
                    if (sv) sv.style.display = 'none';
                    if (typeof window.generateCaptcha === 'function') window.generateCaptcha();
                }, 50);
            }
        });

        // PATCH 7: Complaint form upload — bind evidence file preview
        var compEvidence = document.getElementById('complaint-evidence');
        if (compEvidence && !compEvidence._v51) {
            compEvidence._v51 = true;
            compEvidence.addEventListener('change', function() {
                var p = document.getElementById('complaint-evidence-preview');
                if (!p) return;
                p.innerHTML = '';
                Array.from(this.files || []).forEach(function(f) {
                    var url = URL.createObjectURL(f);
                    var d = document.createElement('div');
                    d.style.cssText = 'display:inline-block;margin:4px;border-radius:8px;overflow:hidden;';
                    d.innerHTML = f.type.startsWith('video/')
                        ? '<video src="' + url + '" style="width:70px;height:70px;object-fit:cover;" muted></video>'
                        : f.type === 'application/pdf'
                        ? '<div style="width:70px;height:70px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:0.7rem;color:#555;"><i class="fas fa-file-pdf" style="font-size:1.4rem;color:#e74c3c;display:block;margin-bottom:4px;"></i>PDF</div>'
                        : '<img src="' + url + '" style="width:70px;height:70px;object-fit:cover;">';
                    p.appendChild(d);
                });
            });
        }

        // PATCH 8: PROMOTIONAL CAMPAIGN ALGORITHM ENGINE
        // ─────────────────────────────────────────────────────
        // Scoring formula:
        //   engagementScore  = likes*3 + comments*5 + shares*4 + retweets*3 + views*0.5
        //   recencyScore     = 1 / (1 + hoursOld * 0.15)          [decays over 48h]
        //   budgetScore      = log10(budgetNGN + 1) / log10(1000001) * 100
        //   audienceMatch    = overlap(post tags, viewer interests) * 20
        //   qualityScore     = hasMedia*10 + hasVerifiedAuthor*15 + KYC*10
        //   FINAL RANK       = engagementScore*0.35 + recencyScore*25 + budgetScore*0.25
        //                      + audienceMatch*0.1 + qualityScore*0.05
        // ─────────────────────────────────────────────────────
        (function() {
            // ── Internal promotion store ──────────────────────────
            if (!window._empyreanPromos) window._empyreanPromos = [];

            // Register a new promotion when user pays
            window.registerPromotion = function(postId, budgetNGN, targetAudience, durationDays) {
                var promo = {
                    id: 'promo-' + Date.now(),
                    postId: postId,
                    budgetNGN: parseFloat(budgetNGN) || 1000,
                    budgetRemaining: parseFloat(budgetNGN) || 1000,
                    targetAudience: targetAudience || 'all',
                    durationDays: parseInt(durationDays) || 3,
                    startTime: Date.now(),
                    endTime: Date.now() + (parseInt(durationDays)||3) * 86400000,
                    impressions: 0,
                    clicks: 0,
                    costPerImpression: Math.max(0.5, parseFloat(budgetNGN) / 10000),
                    active: true
                };
                window._empyreanPromos.push(promo);
                // Save to Firestore
                try {
                    if (window.fbDb && window.userState && window.userState.id) {
                        window.fbDb.collection('promotions').doc(promo.id).set(Object.assign({}, promo, {
                            userId: window.userState.id,
                            username: window.userState.username,
                            createdAt: new Date().toISOString()
                        }));
                    }
                } catch(e) {}
                return promo;
            };

            // ── Score a single post element for ranking ───────────
            window.scorePost = function(postEl, viewerInterests) {
                if (!postEl) return 0;
                var likes    = parseInt(postEl.querySelector('.like-count')?.textContent) || 0;
                var comments = parseInt(postEl.querySelector('.comment-count')?.textContent) || 0;
                var retweets = parseInt(postEl.querySelector('.retweet-count')?.textContent) || 0;
                var shares   = parseInt(postEl.querySelector('.share-count')?.textContent) || 0;
                var views    = parseInt(postEl.dataset.views || 0);

                // Engagement score (weighted)
                var engScore = likes*3 + comments*5 + shares*4 + retweets*3 + views*0.5;

                // Recency score (decays to ~0 after 72 hours)
                var createdAt = postEl.dataset.createdAt ? new Date(postEl.dataset.createdAt).getTime() : Date.now();
                var hoursOld = (Date.now() - createdAt) / 3600000;
                var recency = 1 / (1 + hoursOld * 0.15);

                // Promotion budget boost
                var budgetBoost = 0;
                var postId = postEl.dataset.postId || postEl.dataset.id;
                if (postId) {
                    var activePromo = (window._empyreanPromos || []).find(function(p) {
                        return p.postId === postId && p.active && Date.now() < p.endTime && p.budgetRemaining > 0;
                    });
                    if (activePromo) {
                        // Budget score: ₦1000 → 14pts, ₦10000 → 57pts, ₦100000 → 86pts, ₦1M → 100pts
                        budgetBoost = Math.log10(activePromo.budgetNGN + 1) / Math.log10(1000001) * 100;
                        // Audience match bonus
                        var interests = Array.isArray(viewerInterests) ? viewerInterests : [];
                        var postTags = (postEl.dataset.tags || '').split(',');
                        var matchCount = postTags.filter(function(t) { return interests.indexOf(t.trim()) > -1; }).length;
                        budgetBoost += matchCount * 5;
                    }
                }

                // Quality signals
                var hasMedia   = postEl.querySelector('.story-media-container, img, video') ? 10 : 0;
                var isVerified = postEl.querySelector('.verified-badge-small') ? 15 : 0;
                var qualityScore = hasMedia + isVerified;

                // Final weighted rank
                return (engScore * 0.35) + (recency * 25) + (budgetBoost * 0.25) + (qualityScore * 0.05);
            };

            // ── Re-rank the feed ──────────────────────────────────
            window.rankFeed = function() {
                var feed = document.getElementById('feed-container');
                if (!feed) return;
                // FIX (Quote/Meme card horizontal-scroll bug — confirmed live via
                // console diagnostic, not guessed): this used to be
                // feed.querySelectorAll('.impact-story'), a DEEP query. The
                // dashboard's quote/meme strip (app-feed.js,
                // #dash-feed-quotecard-strip-wrapper) and the "I Support" election
                // strip both live inside #feed-container and each wrap their own
                // .impact-story cards. The deep query pulled those nested cards
                // into the ranking list too, and the re-insert below
                // (fragment.appendChild(s.el) then feed.appendChild(fragment))
                // physically MOVES whatever it appends — so every time this ran
                // (on load, every 5 minutes, and after a post is promoted) it
                // yanked quote/meme cards straight out of the horizontal wrapper
                // and re-planted them as plain top-level (vertical) feed posts.
                // Restricting this to feed-container's own DIRECT children means
                // it only ever reorders real top-level posts — the strips and
                // everything inside them are never touched.
                var posts = Array.prototype.filter.call(feed.children, function(c) {
                    return c.classList && c.classList.contains('impact-story');
                });
                if (posts.length < 2) return;

                var interests = (window.userState && window.userState._interests) || [];
                var scored = posts.map(function(p) {
                    return { el: p, score: window.scorePost(p, interests) };
                });
                scored.sort(function(a, b) { return b.score - a.score; });

                // Re-insert in ranked order (promoted posts get pinned top)
                var _promoted = scored.filter(function(s) {
                    var id = s.el.dataset.postId || s.el.dataset.id;
                    return id && (window._empyreanPromos||[]).some(function(p) {
                        return p.postId === id && p.active && Date.now() < p.endTime;
                    });
                });
                var _organic = scored.filter(function(s) {
                    var id = s.el.dataset.postId || s.el.dataset.id;
                    return !id || !(window._empyreanPromos||[]).some(function(p) {
                        return p.postId === id && p.active && Date.now() < p.endTime;
                    });
                });
                var ordered = _promoted.concat(_organic);

                /* FIX (report — "once the business card appears the retweet
                   quote video and pictures preview card thumbnail
                   disappears"): this used to unconditionally tear every
                   top-level post out of #feed-container via a
                   DocumentFragment and reinsert them in ranked order, even
                   when that order was identical to what was already on
                   screen — which is the common case, since this runs on a
                   fixed schedule (2s after load, then every 5 minutes, then
                   after every promotion) regardless of whether anything
                   actually changed. Detaching and reattaching a post this
                   way moves its whole subtree, including any live preview
                   <video> inside a quote-retweet embed
                   (.vf-quote-video-wrap .vf-quote-embed-img in app-feed.js)
                   — and browsers reset/reload a <video> that gets removed
                   from and reinserted into the document. On a slow
                   connection that reload can fail, and the embed's own
                   onerror handler (this.parentElement.style.display='none')
                   then hides the preview permanently with no way back. The
                   business card finishing its own load lands in roughly the
                   same window as this function's first automatic call,
                   which is why the disappearance reads as caused by the
                   card — the actual trigger is this needless full-feed
                   reorder. Posts with a plain image embed aren't hit the
                   same way (moving an <img> doesn't force a browser
                   refetch), which is why only the video/picture PREVIEW
                   BOX inside quote posts was affected.
                   Bailing out here when the target order already matches
                   the current DOM order means that common no-op tick never
                   touches any post's DOM, so an already-playing preview is
                   left alone. When the order genuinely does change (a new
                   promotion, etc.) the exact original reinsertion behavior
                   below still runs unchanged. */
                var samePosition = ordered.length === posts.length
                    && ordered.every(function (s, i) { return s.el === posts[i]; });
                if (samePosition) return;

                /* FIX (report — "retweet quote video/pictures preview
                   thumbnail disappears" — confirmed STILL happening after
                   the samePosition bail-out above): that bail-out only
                   skips the reorder when the WHOLE order is unchanged. Any
                   genuine reorder — even a single post moving up or down —
                   still fell through to the code this replaces, which
                   detached every top-level post into a DocumentFragment
                   and reappended all of them, moving posts that hadn't
                   actually changed position right along with the ones that
                   had. Reparenting a <video> resets/reloads it (the same
                   browser behavior documented above), so this needlessly
                   broke a live quote-embed preview any time ANY other post
                   in the feed reordered, not just when that specific post
                   moved. Replaced the all-or-nothing fragment rebuild with
                   an in-place, slot-by-slot reorder: walk the target order
                   and only call insertBefore when the post actually sitting
                   in that slot right now isn't the one that belongs there.
                   A post already in its correct slot is never touched —
                   insertBefore/appendChild only physically move a node when
                   it's the one being placed, so an untouched post's
                   quote-embed video keeps playing uninterrupted, and only
                   the post(s) that truly changed rank get reparented (and,
                   unavoidably, only their own preview reloads). */
                ordered.forEach(function (s, i) {
                    if (feed.children[i] !== s.el) {
                        feed.insertBefore(s.el, feed.children[i] || null);
                    }
                });
            };

            // ── Track impression when promo post is visible ───────
            window.trackPromoImpression = function(postId) {
                var promo = (window._empyreanPromos||[]).find(function(p) {
                    return p.postId === postId && p.active;
                });
                if (!promo) return;
                promo.impressions++;
                promo.budgetRemaining = Math.max(0, promo.budgetRemaining - promo.costPerImpression);
                if (promo.budgetRemaining <= 0) {
                    promo.active = false;
                    var badge = document.querySelector('[data-post-id="'+postId+'"] .sponsored-badge, [data-id="'+postId+'"] .sponsored-badge');
                    if (badge) badge.style.display = 'none';
                    if (window.showNotification) window.showNotification('Your promotion for post has ended — budget exhausted.', 'info');
                }
            };

            // ── DISABLED (2026-08-08): this used to patch promotion-finalize-
            //    form to call registerPromotion, but it fired unconditionally
            //    on EVERY submit of that form -- with no check on whether the
            //    payment in app-fixes.js's own handler actually succeeded.
            //    Insufficient EMPY balance or an invalid card made that
            //    handler show an error and return early, but this listener
            //    still fired ~100ms later and registered the promotion
            //    anyway: an unpaid promotion, active for free. app-fixes.js's
            //    promotion-finalize-form case now calls window.registerPromotion()
            //    itself, and ONLY after a successful atomic wallet deduction or
            //    a successful Flutterwave payment callback (also now moved the
            //    rankFeed() re-rank call there, so nothing here is lost).
            if (false) {
            document.addEventListener('submit', function(e) {
                if (!e.target || e.target.id !== 'promotion-finalize-form') return;
                setTimeout(function() {
                    var postId = (document.getElementById('promote-post-id') || {}).value;
                    var budget = parseFloat((document.getElementById('promo-budget') || {}).value) || 1000;
                    var duration = parseInt((document.getElementById('promo-duration') || {}).value) || 3;
                    var audience = (document.getElementById('promo-audience') || {}).value || 'all';
                    if (postId) {
                        window.registerPromotion(postId, budget, audience, duration);
                        // Mark post as sponsored in UI
                        var badge = document.querySelector('[data-post-id="'+postId+'"] .sponsored-badge, [data-id="'+postId+'"] .sponsored-badge');
                        if (badge) badge.style.display = 'inline-flex';
                        // Re-rank feed so promoted post rises
                        setTimeout(window.rankFeed, 300);
                    }
                }, 100);
            }, false);
            } // end disabled block

            // ── Auto-rank feed every 5 minutes + on new post ─────
            setTimeout(function() {
                window.rankFeed();
                setInterval(window.rankFeed, 5 * 60 * 1000);
            }, 2000);

            // ── Intersection Observer: track visible promoted posts ─
            if ('IntersectionObserver' in window) {
                var _promoObserver = new IntersectionObserver(function(entries) {
                    entries.forEach(function(entry) {
                        if (!entry.isIntersecting) return;
                        var el = entry.target;
                        var postId = el.dataset.postId || el.dataset.id;
                        if (postId && el.querySelector('.sponsored-badge[style*="inline"]')) {
                            window.trackPromoImpression(postId);
                        }
                    });
                }, { threshold: 0.5 });

                // Observe existing and future posts
                function observePosts() {
                    document.querySelectorAll('.impact-story:not([data-promo-observed])').forEach(function(p) {
                        p.dataset.promoObserved = '1';
                        _promoObserver.observe(p);
                    });
                }
                observePosts();
                // Re-observe when new posts are added
                var _feedEl = document.getElementById('feed-container');
                if (_feedEl) {
                    new MutationObserver(observePosts).observe(_feedEl, { childList: true });
                }
            }

            // ── Expose promo analytics to admin ──────────────────
            window.getPromoAnalytics = function() {
                return (window._empyreanPromos || []).map(function(p) {
                    return {
                        postId: p.postId,
                        budget: p.budgetNGN,
                        spent: p.budgetNGN - p.budgetRemaining,
                        impressions: p.impressions,
                        clicks: p.clicks,
                        ctr: p.impressions > 0 ? ((p.clicks / p.impressions)*100).toFixed(1)+'%' : '0%',
                        active: p.active,
                        daysLeft: Math.max(0, Math.ceil((p.endTime - Date.now()) / 86400000))
                    };
                });
            };

        })(); // end promo algorithm engine

    })(); // end v5.1 patches

  } catch(_liveStartupErr) {
    console.error('[Live][STARTUP CRASH] app-live.js failed during init — everything defined after this point (including publishLiveStreamToFirestore) was NOT created. Real error:', _liveStartupErr && _liveStartupErr.message, '\nStack:', _liveStartupErr && _liveStartupErr.stack);
  }

}); // end onReady
})(); // end IIFE