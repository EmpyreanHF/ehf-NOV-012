/* ═══════════════════════════════════════════════════════════════════
   EMPYREAN — LINK PREVIEW PATCH  (v2.0)
   ─────────────────────────────────────────────────────────────────
   Features:
   1. URL auto-linkification in post text (formatWhatsAppText patch)
   2. Empyrean internal links → fetch post from Firestore → rich card
      (handles ?post=ID, #post/ID, #post/crisis, #post/sos patterns)
   3. External links → OGP preview card via allorigins proxy
   4. MutationObserver watches chat container for new messages
   ═══════════════════════════════════════════════════════════════════ */

(function empyreanLinkPreview() {
    'use strict';

    if (window._empLinkPreviewLoaded) return;
    window._empLinkPreviewLoaded = true;

    /* ── URL regex ─────────────────────────────────────────────────── */
    var URL_RE = /(https?:\/\/[^\s<>"']{4,})/gi;

    /* ── HTML escape ────────────────────────────────────────────────── */
    function _esc(s) {
        return String(s || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /* ── Extract domain ─────────────────────────────────────────────── */
    function _domain(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); }
        catch(e) { return ''; }
    }

    /* ── Is this an internal Empyrean URL? ──────────────────────────── */
    function _parseEmpyreanUrl(url) {
        /* Matches patterns like:
           ?post=post-1780644841148-5012
           ?post=crisis-1780172173329
           ?post=sos-...
           #post/crisis   (with data-post-id on a card)
           #post/1780...
        */
        try {
            var parsed = new URL(url);
            /* Query param style: ?post=<id> */
            var postParam = parsed.searchParams.get('post');
            if (postParam) return _classifyId(postParam);
            /* Hash style: #post/crisis or #post/<id> */
            var hash = parsed.hash || '';
            var hashMatch = hash.match(/^#post\/(.+)$/);
            if (hashMatch) return _classifyId(hashMatch[1]);
            /* Fragment in path (localhost dev URLs) */
            var pathMatch = url.match(/[#?]post[=/]([^&\s]+)/);
            if (pathMatch) return _classifyId(pathMatch[1]);
        } catch(e) {}
        return null;
    }

    function _classifyId(id) {
        if (!id) return null;
        if (id.startsWith('crisis')) return { collection: 'crisis_reports', id: id };
        if (id.startsWith('sos'))    return { collection: 'sos_queue',       id: id };
        return { collection: 'posts', id: id };
    }


    /* ═══════════════════════════════════════════════════════════════
       §1  CSS
    ═══════════════════════════════════════════════════════════════ */
    (function _css() {
        if (document.getElementById('_elp_css')) return;
        var s = document.createElement('style');
        s.id = '_elp_css';
        s.textContent = [
            /* Clickable highlighted links */
            'a.elp-link{',
            '  color:#1B2B8B;font-weight:600;',
            '  text-decoration:underline;text-decoration-color:rgba(27,43,139,.35);',
            '  word-break:break-all;cursor:pointer;transition:color .15s;',
            '}',
            'a.elp-link:hover{ color:#0d1f7a; }',
            '[data-elp-sent="1"] a.elp-link{ color:#cce0ff;text-decoration-color:rgba(204,224,255,.5); }',
            '[data-elp-sent="1"] a.elp-link:hover{ color:#fff; }',

            /* Preview card */
            '.elp-card{',
            '  display:flex;flex-direction:column;',
            '  border-radius:14px;overflow:hidden;',
            '  border:1px solid rgba(27,43,139,.18);',
            '  background:#f8f9ff;margin-top:10px;',
            '  max-width:320px;cursor:pointer;',
            '  box-shadow:0 2px 12px rgba(27,43,139,.12);',
            '  text-decoration:none;',
            '  transition:box-shadow .18s,transform .18s;',
            '}',
            '.elp-card:hover{ box-shadow:0 6px 22px rgba(27,43,139,.2);transform:translateY(-2px); }',
            '.elp-card-img,.elp-card-media{',
            '  width:100%;max-height:240px;object-fit:cover;display:block;',
            '  background:linear-gradient(135deg,#e8eaf6,#c5cae9);',
            '}',
            'video.elp-card-media{ max-height:280px;background:#000;cursor:default; }',
            'iframe.elp-card-media{ height:220px;border:0;background:#000; }',
            '.elp-card-playshell{ position:relative;cursor:pointer; }',
            '.elp-play-btn{',
            '  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
            '  width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;',
            '  background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;',
            '  transition:background .15s,transform .15s;padding:0;',
            '}',
            '.elp-play-btn:hover{ background:rgba(0,0,0,.72);transform:translate(-50%,-50%) scale(1.06); }',
            '.elp-card-body{ padding:12px 14px 11px; }',
            '.elp-card-title{',
            '  font-size:1.02rem;font-weight:700;color:#0A0E27;',
            '  margin:0 0 4px;line-height:1.3;',
            '  display:-webkit-box;-webkit-line-clamp:2;',
            '  -webkit-box-orient:vertical;overflow:hidden;',
            '}',
            '.elp-card-desc{',
            '  font-size:.82rem;color:#374151;line-height:1.45;margin-bottom:8px;',
            '  display:-webkit-box;-webkit-line-clamp:2;',
            '  -webkit-box-orient:vertical;overflow:hidden;',
            '}',
            '.elp-card-domain{',
            '  font-size:.78rem;color:#1B2B8B;font-weight:600;',
            '  display:inline-flex;align-items:center;gap:5px;',
            '  text-decoration:none;',
            '}',
            '.elp-card-domain:hover{ text-decoration:underline; }',

            /* Loading state */
            '.elp-loading{',
            '  display:flex;align-items:center;gap:9px;',
            '  padding:11px 13px;font-size:.78rem;color:#6B7280;',
            '  border-radius:12px;border:1px solid rgba(27,43,139,.13);',
            '  background:#f8f9ff;margin-top:8px;max-width:320px;',
            '}',
            '.elp-spinner{',
            '  width:15px;height:15px;border-radius:50%;flex-shrink:0;',
            '  border:2px solid #e5e7eb;border-top-color:#1B2B8B;',
            '  animation:elpSpin .7s linear infinite;',
            '}',
            '@keyframes elpSpin{ to{ transform:rotate(360deg); } }',

            /* Sent bubble dark variants */
            '[data-elp-sent="1"] .elp-card{ background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.24); }',
            '[data-elp-sent="1"] .elp-card-domain{ color:#93c5fd; }',
            '[data-elp-sent="1"] .elp-card-title{ color:#fff; }',
            '[data-elp-sent="1"] .elp-card-desc{ color:rgba(255,255,255,.8); }',
            '[data-elp-sent="1"] .elp-loading{ background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:rgba(255,255,255,.7); }',
        ].join('\n');
        document.head.appendChild(s);
    })();


    /* ═══════════════════════════════════════════════════════════════
       §2  Linkify raw text → HTML with <a> tags
    ═══════════════════════════════════════════════════════════════ */
    function _linkify(html) {
        /* FIX (2026-08-20 — post/comment/chat text showing raw
           target="_blank" rel="noopener noreferrer" style="..." markup
           as literal visible text instead of a working link):
           formatWhatsAppText() (app-fixes.js / app-patch-v41.js's
           _richFormatText override) already turns every http(s)/www URL
           in the text into a complete, real <a href="...">…</a> tag
           with its own platform icon BEFORE this function ever sees the
           text — via the formatWhatsAppText wrap in §3 below, and again
           whenever this file re-scans already-rendered post/chat HTML
           in §6/§8. URL_RE above has no concept of HTML structure, so
           re-running it against text that is already linkified matches
           the URL sitting INSIDE that real anchor's own href="..."
           attribute and wraps just that substring in a SECOND, nested
           <a> tag. Browsers can't parse that broken nested markup as one
           tag, so the outer tag's own target=/rel=/style= attributes
           spill out and render as plain visible text — exactly the bug
           reported. Any URL a person could still want linkified has
           already been caught by formatWhatsAppText itself, so it's
           always safe to leave already-linkified HTML untouched here. */
        if (/<a[\s>]/i.test(html)) return html;
        return html.replace(URL_RE, function(url) {
            /* UPGRADE (2026-10-25 — link engine): trailing sentence punctuation / formatting marks are not part of the
               link ("see https://a.com/x." no longer links the final "."), and a ")" is only stripped when unbalanced. */
            var _tr = '';
            for (;;) {
                var _c = url.charAt(url.length - 1);
                if (_c && ('.,!?;:*_~]'.indexOf(_c) !== -1 || (_c === ')' && url.split(')').length > url.split('(').length))) {
                    _tr = _c + _tr; url = url.slice(0, -1);
                } else break;
            }
            if (false) { /* original — superseded 2026-10-25 */
                return '<a class="elp-link" href="' + _esc(url)
                    + '" target="_blank" rel="noopener noreferrer">' + _esc(url) + '</a>';
            }
            return '<a class="elp-link" href="' + _esc(url)
                + '" target="_blank" rel="noopener noreferrer">' + _esc(url) + '</a>' + _esc(_tr);
        });
    }


    /* ═══════════════════════════════════════════════════════════════
       §3  Patch formatWhatsAppText → linkify post body text
    ═══════════════════════════════════════════════════════════════ */
    function _patchFormat() {
        var orig = window.formatWhatsAppText;
        if (typeof orig !== 'function' || orig._elpPatched) return;
        window.formatWhatsAppText = function(t) {
            return _linkify(orig.apply(this, arguments));
        };
        window.formatWhatsAppText._elpPatched = true;
    }
    _patchFormat();
    window.addEventListener('empyrean:firebase-ready', function(){ setTimeout(_patchFormat, 200); });
    document.addEventListener('empyrean-init-done',    function(){ setTimeout(_patchFormat, 300); });


    /* ═══════════════════════════════════════════════════════════════
       §4  Fetch preview data — Empyrean post (Firestore) or OGP
    ═══════════════════════════════════════════════════════════════ */
    var _cache = {};

    /* Internal: fetch from Firestore */
    function _fetchInternal(info) {
        var key = info.collection + '/' + info.id;
        if (_cache[key]) return _cache[key];
        _cache[key] = new Promise(function(resolve) {
            /* Wait for Firebase to be ready */
            function _attempt(tries) {
                if (!window.fbDb || !window._firebaseLoaded) {
                    if (tries < 15) { setTimeout(function(){ _attempt(tries+1); }, 400); }
                    else { resolve(null); }
                    return;
                }
                window.fbDb.collection(info.collection).doc(info.id).get()
                    .then(function(snap) {
                        if (!snap || !snap.exists) { resolve(null); return; }
                        var d = snap.data();
                        /* Normalise across posts / crisis / sos */
                        var title  = d.text || d.story || d.description || d.title || '';
                        var author = d.author || d.username || d.authorName || d.reportedBy || 'Empyrean';
                        var media  = d.mediaFiles || d.media || d.mediaUrls || [];
                        var img    = '';
                        if (Array.isArray(media) && media.length) {
                            var first = media[0];
                            img = (typeof first === 'string') ? first
                                : (first._cloudUrl || first.url || '');
                            /* Skip video URLs for thumbnail */
                            if (/\.(mp4|webm|mov|avi|mkv)/i.test(img)) img = '';
                        }
                        if (!img && d.avatar)       img = d.avatar;
                        if (!img && d.coverPhoto)   img = d.coverPhoto;
                        resolve({
                            type:   'internal',
                            title:  (author ? '@' + author + ': ' : '') + title.slice(0, 140),
                            desc:   d.type || d.crisisType || d.category || '',
                            image:  img,
                            domain: 'Empyrean',
                            label:  info.collection === 'crisis_reports' ? '🚨 Crisis Report'
                                  : info.collection === 'sos_queue'       ? '🆘 SOS Alert'
                                  : '📣 Post',
                        });
                    })
                    .catch(function(){ resolve(null); });
            }
            _attempt(0);
        });
        return _cache[key];
    }

    /* External: OGP via allorigins */
    /* UPDATED 2026-10-19: ask Empyrean's OWN server first (/api/link-preview — it reads the page itself, follows redirects
       and has Facebook handling), and only fall back to the free allorigins proxy if the server can't answer. allorigins is a
       third-party service that Facebook blocks and that is often slow or down, which is why Facebook links lost their thumbnail. */
    function _fetchExternal(url) {
        if (_cache[url]) return _cache[url];
        _cache[url] = fetch('/api/link-preview?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d || !d.ok || (!d.title && !d.image)) return null;
                return { type: 'external', title: String(d.title || '').slice(0, 120), desc: String(d.description || '').slice(0, 180),
                         image: d.image || '', domain: d.domain || _domain(url), label: d.siteName || d.domain || _domain(url), videoUrl: '', playerUrl: '' };
            })
            .catch(function () { return null; })
            .then(function (viaServer) { return viaServer || _fetchExternalViaProxy(url); });
        return _cache[url];
    }

    function _fetchExternalViaProxy(url) {
        return fetch(
            'https://api.allorigins.win/get?url=' + encodeURIComponent(url),
            { cache: 'force-cache', signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined }
        )
        .then(function(r){ return r.json(); })
        .then(function(d){
            var html = d.contents || '';
            var get = function(prop) {
                var m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)["\']','i'))
                     || html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']' + prop + '["\']','i'));
                return m ? m[1].trim() : '';
            };
            var title = get('og:title') || get('twitter:title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1] || '';
            var desc  = get('og:description') || get('twitter:description') || get('description') || '';
            var image = get('og:image') || get('twitter:image') || '';

            /* ── Video detection (so the card can play inline, not just link out) ──
               Two distinct shapes show up in the wild:
               1. og:video / og:video:url / og:video:secure_url → a DIRECT,
                  embeddable media file (mp4/webm). Goes straight into a
                  native <video> tag.
               2. twitter:player → an IFRAME embed URL (this is what X/Twitter
                  itself publishes for video tweets — it does not expose a
                  direct .mp4 via og:video). Goes into an <iframe>, same
                  mechanism Telegram/Discord/WhatsApp use to play X video
                  posts inline without leaving the app. */
            var videoUrl  = get('og:video:secure_url') || get('og:video:url') || get('og:video') || '';
            var videoType = get('og:video:type') || '';
            var isDirectVideo = !!videoUrl && (!videoType || videoType.indexOf('video/') === 0);
            var playerUrl = get('twitter:player') || '';
            if (!isDirectVideo) videoUrl = ''; /* discard non-playable swf/text og:video values */

            if (!title && !image && !playerUrl) return null;
            return {
                type:'external', title:title.slice(0,120), desc:desc.slice(0,180),
                image:image, domain:_domain(url), label:_domain(url),
                videoUrl: videoUrl, playerUrl: playerUrl
            };
        })
        .catch(function(){ return null; });
    }

    function _fetchPreview(url) {
        var info = _parseEmpyreanUrl(url);
        if (!info) return _fetchExternal(url);
        /* FIX (2026-10-28 — Empyrean share links in chat got no card): _classifyId() only knows posts/crisis/sos, so e.g.
           ?post=mkt-<id> (marketplace listings) was looked up in `posts`, found nothing, and the card was dropped. When the
           direct lookup finds nothing, ask the server — it already builds the real per-link card for every id type. */
        return _fetchInternal(info).then(function (m) { return m || _fetchExternal(url); });
    }


    /* ═══════════════════════════════════════════════════════════════
       §5  Build preview card DOM element
    ═══════════════════════════════════════════════════════════════ */
    function _buildCard(meta, url) {
        if (!meta) return null;

        var hasVideo = !!(meta.videoUrl || meta.playerUrl);

        /* Video cards must NOT be a clickable <a> wrapping the whole card —
           tapping the video itself has to play it in place, not navigate
           away. Only the domain footer stays a real link, exactly like the
           reference screenshot's small "🔗 x.com" line under the card. */
        var root = document.createElement(hasVideo ? 'div' : 'a');
        root.className = 'elp-card';
        if (!hasVideo) {
            root.href   = url;
            root.target = '_blank';
            root.rel    = 'noopener noreferrer';
            root.addEventListener('click', function(e){ e.stopPropagation(); });
        }

        var mediaHTML = '';
        if (meta.videoUrl) {
            /* Direct, embeddable media file → native <video>, plays right
               in the chat bubble, full transport controls, no navigation. */
            mediaHTML = '<video class="elp-card-media" src="' + _esc(meta.videoUrl)
                + '" poster="' + _esc(meta.image || '') + '" controls preload="metadata" playsinline></video>';
        } else if (meta.playerUrl) {
            /* iframe embed (this is the path X/Twitter video links use) —
               lazy: shows the thumbnail first, swaps to the live iframe
               only once tapped, so dozens of chat rows don't all load
               iframes/video players simultaneously. */
            mediaHTML = '<div class="elp-card-media elp-card-playshell">'
                + (meta.image ? '<img class="elp-card-img" src="' + _esc(meta.image) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '')
                + '<button type="button" class="elp-play-btn" aria-label="Play video">'
                + '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M8 5v14l11-7z"/></svg>'
                + '</button></div>';
        } else if (meta.image) {
            mediaHTML = '<img class="elp-card-img" src="' + _esc(meta.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">';
        }

        root.innerHTML = mediaHTML +
            '<div class="elp-card-body">' +
            (meta.title ? '<div class="elp-card-title">' + _esc(meta.title) + '</div>' : '') +
            (meta.desc  ? '<div class="elp-card-desc">'  + _esc(meta.desc)  + '</div>' : '') +
            '<a class="elp-card-domain" href="' + _esc(url) + '" target="_blank" rel="noopener noreferrer">' +
            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
            _esc(meta.label || meta.domain) + '</a>' +
            '</div>';

        /* Wire the lazy play-button → swap thumbnail for the live iframe player */
        if (meta.playerUrl) {
            var playBtn = root.querySelector('.elp-play-btn');
            var shell   = root.querySelector('.elp-card-playshell');
            if (playBtn && shell) {
                playBtn.addEventListener('click', function(e) {
                    e.preventDefault(); e.stopPropagation();
                    var ifr = document.createElement('iframe');
                    ifr.className = 'elp-card-media';
                    ifr.src = meta.playerUrl;
                    ifr.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
                    ifr.setAttribute('allowfullscreen', '');
                    ifr.frameBorder = '0';
                    shell.replaceWith(ifr);
                });
            }
        }
        /* Domain footer link must not bubble up into a card-level handler
           even on the (non-<a>) video card variant. */
        var domainLink = root.querySelector('.elp-card-domain');
        if (domainLink) domainLink.addEventListener('click', function(e){ e.stopPropagation(); });

        return root;
    }


    /* ═══════════════════════════════════════════════════════════════
       §6  Process a single chat message row element
    ═══════════════════════════════════════════════════════════════ */
    function _processRow(row) {
        if (row._elpDone) return;
        row._elpDone = true;

        /* Detect sent vs received */
        var isSent = row.style.justifyContent === 'flex-end'
                  || row.classList.contains('sent')
                  || row.classList.contains('outgoing')
                  || !!(row.querySelector('[style*="1B2B8B"]'));
        if (isSent) row.setAttribute('data-elp-sent','1');

        /* Find the inner text container (the bubble div) */
        var bubble = row.querySelector('[style*="border-radius"],[class*="bubble"],[class*="message-text"]')
                  || row.querySelector('div');
        if (!bubble) return;

        var raw = bubble.innerHTML || '';
        URL_RE.lastIndex = 0;
        if (!URL_RE.test(raw)) { URL_RE.lastIndex = 0; return; }
        URL_RE.lastIndex = 0;

        /* Linkify */
        bubble.innerHTML = _linkify(raw);
        bubble.querySelectorAll('a.elp-link').forEach(function(a){
            a.addEventListener('click', function(e){ e.stopPropagation(); });
        });

        /* Extract first URL → preview card */
        var urls = raw.match(URL_RE) || [];
        URL_RE.lastIndex = 0;
        if (!urls.length) return;
        var firstUrl = urls[0];

        /* Loading placeholder */
        var loader = document.createElement('div');
        loader.className = 'elp-loading';
        loader.innerHTML = '<div class="elp-spinner"></div><span>Loading preview…</span>';
        row.appendChild(loader);

        _fetchPreview(firstUrl).then(function(meta) {
            loader.remove();
            var card = _buildCard(meta, firstUrl);
            if (card) row.appendChild(card);
        });
    }


    /* ═══════════════════════════════════════════════════════════════
       §7  Scan chat container + MutationObserver
    ═══════════════════════════════════════════════════════════════ */
    var _mo = null;

    function _getContainer() {
        return document.getElementById('chat-messages-container')
            || document.getElementById('messages-list')
            || document.querySelector('#chat-view-container .messages-list,.chat-messages,.vf-chat-messages');
    }

    function _scan(root) {
        var rows = (root || document).querySelectorAll(
            '[style*="justify-content"],[class*="message-row"],[class*="msg-row"],[class*="chat-msg"]'
        );
        rows.forEach(function(r){
            URL_RE.lastIndex = 0;
            if (URL_RE.test(r.textContent)) { URL_RE.lastIndex = 0; _processRow(r); }
            URL_RE.lastIndex = 0;
        });
    }

    function _attach() {
        var c = _getContainer();
        if (!c) return;
        if (_mo) _mo.disconnect();
        _mo = new MutationObserver(function(muts){
            muts.forEach(function(m){
                m.addedNodes.forEach(function(n){
                    if (n.nodeType !== 1) return;
                    URL_RE.lastIndex = 0;
                    if (URL_RE.test(n.textContent)) { URL_RE.lastIndex = 0; _processRow(n); }
                    URL_RE.lastIndex = 0;
                    _scan(n);
                });
            });
        });
        _mo.observe(c, { childList:true, subtree:true });
        _scan(c);
    }

    /* Watch for the chat container to appear in the DOM */
    new MutationObserver(function(){ _attach(); })
        .observe(document.body || document.documentElement, { childList:true, subtree:true });

    /* Section-change hook */
    document.addEventListener('empyrean-section-change', function(ev){
        if (ev && ev.detail && ev.detail.section === 'messages') setTimeout(_attach, 380);
    });

    /* Init hooks */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function(){ setTimeout(_attach, 500); });
    } else {
        setTimeout(_attach, 500);
    }
    document.addEventListener('empyrean-init-done', function(){ setTimeout(_attach, 650); });


    /* ═══════════════════════════════════════════════════════════════
       §8  Retroactively linkify post text already in the DOM
    ═══════════════════════════════════════════════════════════════ */
    function _linkifyPosts() {
        document.querySelectorAll('.story-content p, .post-text p').forEach(function(p){
            if (p._elpDone) return;
            p._elpDone = true;
            URL_RE.lastIndex = 0;
            if (!URL_RE.test(p.innerHTML)) { URL_RE.lastIndex = 0; return; }
            URL_RE.lastIndex = 0;
            p.innerHTML = _linkify(p.innerHTML);
            p.querySelectorAll('a.elp-link').forEach(function(a){
                a.addEventListener('click', function(e){ e.stopPropagation(); });
            });
        });
    }
    document.addEventListener('empyrean-init-done', function(){ setTimeout(_linkifyPosts, 900); });

    /* ═══════════════════════════════════════════════════════════════
       §9  PHONE + WHATSAPP NUMBERS (2026-10-25)
       ───────────────────────────────────────────────────────────────
       Markup comes from formatWhatsAppText (app-fixes.js):
         a.emp-tel                         tap-to-call (tel:) — the browser handles it
         .emp-wa > a.emp-wa-chip + button.emp-wa-qr   a WhatsApp number
       Chip tap: phones follow the wa.me href straight into WhatsApp; desktops
       get a QR dialog to scan with a phone. The QR button opens the dialog on
       any device (e.g. to let someone beside you scan it). The QR image comes
       from the qrcodejs library (cdnjs), loaded the first time it's needed,
       with a qrserver.com image as a fallback if the script can't load.
       Captured at document level so tapping a number never also opens the post.
    ═══════════════════════════════════════════════════════════════ */
    (function empWhatsAppNumbers() {
        if (window._empWaLoaded) return;
        window._empWaLoaded = true;

        (function css() {
            if (document.getElementById('_emp_wa_css')) return;
            var s = document.createElement('style'); s.id = '_emp_wa_css';
            s.textContent = [
                '.emp-wa{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;vertical-align:baseline;}',
                'a.emp-wa-chip{color:#1A73E8;font-weight:600;text-decoration:underline;text-decoration-color:rgba(26,115,232,.45);text-underline-offset:2px;cursor:pointer;}',
                'a.emp-wa-chip i{color:#25D366;font-size:1.15em;margin-right:2px;vertical-align:-1px;}',
                'button.emp-wa-qr{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:rgba(37,211,102,.14);color:#128C4A;font-size:.8rem;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .15s ease,background .15s ease;}',
                'button.emp-wa-qr:hover{background:rgba(37,211,102,.26);}',
                'button.emp-wa-qr:active{transform:scale(.92);}',
                '#emp-wa-modal{position:fixed;top:0;right:0;bottom:0;left:0;z-index:100050;display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;background:rgba(10,14,39,.62);animation:empWaFade .18s ease-out both;}',
                '#emp-wa-modal .emp-wa-card{position:relative;width:100%;max-width:320px;box-sizing:border-box;background:#fff;color:#0A0E27;border-radius:20px;padding:20px 20px 18px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.35);animation:empWaPop .24s cubic-bezier(.2,.8,.2,1) both;}',
                '#emp-wa-modal .emp-wa-x{position:absolute;top:10px;right:10px;width:30px;height:30px;border:0;border-radius:50%;background:rgba(10,14,39,.07);color:#0A0E27;font-size:18px;line-height:1;cursor:pointer;}',
                '#emp-wa-modal .emp-wa-head{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:14px;text-align:left;}',
                '#emp-wa-modal .emp-wa-head i{font-size:2rem;color:#25D366;}',
                '#emp-wa-modal .emp-wa-head strong{display:block;font-size:1rem;}',
                '#emp-wa-modal .emp-wa-head span{display:block;font-size:.84rem;color:#5b6472;}',
                '#emp-wa-modal .emp-wa-qrbox{display:flex;align-items:center;justify-content:center;width:232px;height:232px;margin:0 auto 10px;padding:10px;box-sizing:border-box;background:#fff;border:1px solid rgba(10,14,39,.12);border-radius:14px;font-size:.8rem;color:#5b6472;}',
                '#emp-wa-modal .emp-wa-qrbox img,#emp-wa-modal .emp-wa-qrbox canvas{max-width:100%;height:auto;display:block;}',
                '#emp-wa-modal .emp-wa-hint{margin:0 0 14px;font-size:.82rem;color:#5b6472;line-height:1.45;}',
                '#emp-wa-modal .emp-wa-open{display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 14px;border-radius:12px;background:#25D366;color:#fff !important;font-weight:700;text-decoration:none !important;}',
                '#emp-wa-modal .emp-wa-copy{width:100%;margin-top:8px;padding:10px 14px;border:1px solid rgba(10,14,39,.14);border-radius:12px;background:#fff;color:#0A0E27;font-weight:600;cursor:pointer;}',
                '@keyframes empWaFade{from{opacity:0}to{opacity:1}}',
                '@keyframes empWaPop{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}'
            ].join('\n');
            document.head.appendChild(s);
        })();

        function isMobile() {
            return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ||
                   ((navigator.maxTouchPoints || 0) > 1 && window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
        }

        var _qrLoading = null;
        function loadQR() {
            if (window.QRCode) return Promise.resolve(true);
            if (_qrLoading) return _qrLoading;
            _qrLoading = new Promise(function (resolve) {
                var sc = document.createElement('script');
                sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
                sc.onload = function () { resolve(!!window.QRCode); };
                sc.onerror = function () { _qrLoading = null; resolve(false); };
                document.head.appendChild(sc);
            });
            return _qrLoading;
        }

        function onKey(e) { if (e.key === 'Escape') closeModal(); }
        function closeModal() {
            var m = document.getElementById('emp-wa-modal');
            if (m) m.remove();
            document.removeEventListener('keydown', onKey);
        }

        function openModal(num, label) {
            closeModal();
            var url = 'https://wa.me/' + num;
            var m = document.createElement('div');
            m.id = 'emp-wa-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Chat on WhatsApp');
            m.innerHTML = '<div class="emp-wa-card">'
                + '<button type="button" class="emp-wa-x" aria-label="Close">&times;</button>'
                + '<div class="emp-wa-head"><i class="fab fa-whatsapp"></i><div><strong>Chat on WhatsApp</strong><span>' + _esc(label || ('+' + num)) + '</span></div></div>'
                + '<div class="emp-wa-qrbox">Loading code\u2026</div>'
                + '<p class="emp-wa-hint">Scan this code with your phone camera or WhatsApp to start a chat.</p>'
                + '<a class="emp-wa-open" href="' + _esc(url) + '" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp"></i> Open WhatsApp</a>'
                + '<button type="button" class="emp-wa-copy">Copy number</button>'
                + '</div>';
            ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'wheel'].forEach(function (ev) {
                m.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
            });
            m.addEventListener('click', function (e) {
                e.stopPropagation();
                if (e.target === m || e.target.closest('.emp-wa-x')) { closeModal(); return; }
                var cp = e.target.closest('.emp-wa-copy');
                if (cp) {
                    var txt = '+' + num;
                    try { navigator.clipboard.writeText(txt).then(function () { cp.textContent = 'Copied'; }); }
                    catch (er) { cp.textContent = txt; }
                }
            });
            document.body.appendChild(m);
            document.addEventListener('keydown', onKey);
            var box = m.querySelector('.emp-wa-qrbox');
            loadQR().then(function (ok) {
                if (!document.body.contains(box)) return;
                box.textContent = '';
                if (ok) {
                    try { new window.QRCode(box, { text: url, width: 208, height: 208, colorDark: '#0A0E27', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M }); return; }
                    catch (er) { box.textContent = ''; }
                }
                var img = new Image();
                img.alt = 'WhatsApp QR code'; img.width = 208; img.height = 208;
                img.onerror = function () { box.textContent = 'Code unavailable offline. Use Open WhatsApp below.'; };
                img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=208x208&margin=0&data=' + encodeURIComponent(url);
                box.appendChild(img);
            });
        }
        window._empOpenWhatsAppQR = openModal;
        window._empLoadQR = loadQR;

        document.addEventListener('click', function (e) {
            var t = e.target; if (!t || !t.closest) return;
            var qr = t.closest('.emp-wa-qr');
            if (qr) { e.preventDefault(); e.stopPropagation(); openModal(qr.getAttribute('data-wa'), qr.getAttribute('data-wa-label')); return; }
            var chip = t.closest('.emp-wa-chip');
            if (chip) {
                e.stopPropagation();
                if (isMobile()) return;
                e.preventDefault();
                openModal(chip.getAttribute('data-wa'), chip.getAttribute('data-wa-label'));
                return;
            }
            if (t.closest('a.emp-tel')) e.stopPropagation();
        }, true);
    })();

    /* ═══════════════════════════════════════════════════════════════
       §10  WHATSAPP BANNER + "SHOW MY WHATSAPP NUMBER" COMPOSER OPTION
            (2026-10-25)
       ───────────────────────────────────────────────────────────────
       Replaces the plain WhatsApp chip with a compact banner inside posts:
       green WhatsApp icon, "Chat on WhatsApp", the number, and a small QR
       thumbnail. Tapping the banner opens WhatsApp (phones) or the QR
       dialog (desktops); tapping the QR thumbnail opens the big QR dialog
       on any device — both reuse §9's click handling via the same
       .emp-wa-chip / .emp-wa-qr classes, so nothing is duplicated.

       Source of truth is still the post TEXT: formatWhatsAppText already
       turns a number written as a WhatsApp number into <span class="emp-wa">.
       This section only re-skins that markup after render, so it works in
       every place posts are drawn (feed, profile, news, threads) without
       touching their renderers. Comments and chats keep the small chip, and
       only the first WhatsApp number in a post becomes a banner.

       Composer: the Quick Post modal gets a "Show my WhatsApp number" switch
       (off by default, reset to off after every post). When on, the entered
       number is added to the end of the post as "WhatsApp: +234 …" at submit
       time, which the formatter then renders as the banner. Switch off = the
       app adds nothing. A number the person types into the text themselves
       still follows the existing chip/banner rules.
    ═══════════════════════════════════════════════════════════════ */
    (function empWhatsAppBanner() {
        if (window._empWaBannerLoaded) return;
        window._empWaBannerLoaded = true;

        var SCOPE = '.story-content, .news-item-content, .post-text, .news-article-body, .vf-th-post-text';
        var SKIP  = '.comment-section, .comment-list, .comment-form, .emp-wab';

        /* The official WhatsApp mark (speech bubble + handset) as inline SVG, in the green of the supplied logo.
           Inline on purpose: the Font Awesome brand font is not always loaded, and when it is missing the
           fab fa-whatsapp icon falls back to a generic chat bubble. */
        var WA_LOGO_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';
        function _waLogo(px) {
            return '<svg class="emp-svg-wa" viewBox="0 0 24 24" width="' + px + '" height="' + px + '" aria-hidden="true" focusable="false">'
                + '<circle cx="12.05" cy="11.9" r="10.1" fill="#fff"/><path fill="#009A4E" d="' + WA_LOGO_PATH + '"/></svg>';
        }

        (function css() {
            if (document.getElementById('_emp_wab_css')) return;
            var s = document.createElement('style'); s.id = '_emp_wab_css';
            s.textContent = [
                '.emp-wab{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;max-width:340px;margin:8px 0 2px;padding:7px 8px 7px 7px;border-radius:12px;background:#F0FBF4;border:1px solid rgba(37,211,102,.38);white-space:normal;font-size:1rem;}',
                '.emp-wab.emp-wab-lifted{margin:10px 0 6px;width:100%;max-width:none;border-radius:0;border-left:0;border-right:0;padding:8px 16px;}',
                '.emp-wab a.emp-wab-main{display:flex;align-items:center;gap:9px;flex:1;min-width:0;color:#0A0E27;font-weight:400;text-decoration:none;}',
                '.emp-wab .emp-wab-ico{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;}',
                '.emp-wab .emp-wab-ico svg{width:40px;height:40px;display:block;}',
                'svg.emp-svg-wa{display:inline-block;width:1.15em;height:1.15em;vertical-align:-3px;margin-right:2px;}',
                '.emp-wab .emp-wab-txt{display:flex;flex-direction:column;min-width:0;line-height:1.25;}',
                '.emp-wab .emp-wab-txt b{font-size:.84rem;font-weight:700;color:#0A0E27;}',
                '.emp-wab .emp-wab-txt small{font-size:.78rem;color:#4b5563;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
                '.emp-wab button.emp-wab-qr{flex-shrink:0;width:52px;height:52px;padding:3px;border-radius:8px;background:#fff;border:1px solid rgba(10,14,39,.1);color:#0A0E27;font-size:1.3rem;overflow:hidden;}',
                '.emp-wab button.emp-wab-qr canvas,.emp-wab button.emp-wab-qr img{width:44px !important;height:44px !important;display:block;margin:0 auto;}',
                '#emp-wac{margin:0 0 12px;padding:10px 12px;border:1px solid rgba(10,14,39,.1);border-radius:12px;background:#fff;}',
                '#emp-wac .emp-wac-row{display:flex;align-items:center;gap:10px;}',
                '#emp-wac .emp-wac-ico{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:34px;height:34px;}',
                '#emp-wac .emp-wac-ico svg{width:34px;height:34px;display:block;}',
                '#emp-wac .emp-wac-lbl{flex:1;min-width:0;line-height:1.25;}',
                '#emp-wac .emp-wac-lbl b{display:block;font-size:.88rem;color:#0A0E27;}',
                '#emp-wac .emp-wac-lbl small{display:block;font-size:.74rem;color:#5b6472;}',
                '#emp-wac-sw{position:relative;flex-shrink:0;width:42px;height:24px;padding:0;border:0;border-radius:12px;background:#cbd5e1;cursor:pointer;transition:background .15s;}',
                '#emp-wac-sw span{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;}',
                '#emp-wac-sw[aria-checked="true"]{background:#25D366;}',
                '#emp-wac-sw[aria-checked="true"] span{left:21px;}',
                '#emp-wac-fields{margin-top:10px;}',
                '#emp-wac-num{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid rgba(10,14,39,.18);border-radius:8px;font-size:.95rem;font-family:inherit;}',
                '#emp-wac-err{margin:6px 0 0;font-size:.8rem;color:#b91c1c;}',
                '#emp-wac .emp-wac-note{margin:6px 0 0;font-size:.72rem;color:#5b6472;line-height:1.4;}',
                /* §10b social banners (2026-10-26) */
                '.emp-sob{display:flex;align-items:center;box-sizing:border-box;width:100%;max-width:340px;margin:8px 0 2px;border-radius:12px;background:#fff;border:1px solid rgba(10,14,39,.12);border-left:4px solid var(--sob-c,#1B2B8B);white-space:normal;font-size:1rem;}',
                '.emp-sob a.emp-sob-main{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:7px 10px 7px 8px;color:#0A0E27;font-weight:400;text-decoration:none;}',
                '.emp-sob .emp-sob-ico{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:11px;}',
                '.emp-sob .emp-sob-ico svg,#emp-soc .emp-soc-ico svg{display:block;fill:#fff;}',
                '.emp-sob .emp-sob-txt{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.25;}',
                '.emp-sob .emp-sob-txt b{font-size:.84rem;font-weight:700;color:#0A0E27;}',
                '.emp-sob .emp-sob-txt small{font-size:.78rem;color:#4b5563;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
                '.emp-sob .emp-sob-go{flex-shrink:0;display:flex;align-items:center;color:var(--sob-c,#1B2B8B);}',
                '.emp-sob-grp{display:flex;flex-direction:column;gap:6px;margin:8px 0 2px;}',
                '.emp-sob-grp.emp-sob-lifted{margin:10px 0 6px;}',
                '.emp-sob-grp.emp-sob-lifted .emp-sob{max-width:none;border-radius:0;border-right:0;}',
                '.emp-sob-grp .emp-sob{margin:0;}',
                '#emp-soc{margin:0 0 12px;border:1px solid rgba(10,14,39,.1);border-radius:12px;background:#fff;}',
                '#emp-soc .emp-soc-head{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;background:transparent;text-align:left;cursor:pointer;font-family:inherit;}',
                '#emp-soc .emp-soc-ico{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:30px;height:30px;border-radius:9px;}',
                '#emp-soc .emp-soc-ico-lg{width:34px;height:34px;background:#1B2B8B;}',
                '#emp-soc .emp-soc-lbl{flex:1;min-width:0;line-height:1.25;}',
                '#emp-soc .emp-soc-lbl b{display:block;font-size:.88rem;color:#0A0E27;}',
                '#emp-soc .emp-soc-lbl small{display:block;font-size:.74rem;color:#5b6472;}',
                '#emp-soc .emp-soc-chev{flex-shrink:0;display:flex;color:#5b6472;transition:transform .15s;}',
                '#emp-soc .emp-soc-head[aria-expanded="true"] .emp-soc-chev{transform:rotate(180deg);}',
                '#emp-soc-fields{padding:0 12px 12px;}',
                '#emp-soc .emp-soc-row{display:flex;align-items:center;gap:10px;margin-top:8px;}',
                '#emp-soc input.emp-soc-in{flex:1;min-width:0;box-sizing:border-box;padding:9px 12px;border:1px solid rgba(10,14,39,.18);border-radius:8px;font-size:.92rem;font-family:inherit;}',
                '#emp-soc-err{margin:8px 0 0;font-size:.8rem;color:#b91c1c;}',
                '#emp-soc .emp-soc-note{margin:8px 0 0;font-size:.72rem;color:#5b6472;line-height:1.4;}'
            ].join('\n');
            document.head.appendChild(s);
        })();

        /* ── banner: re-skin the chip that formatWhatsAppText produced ── */
        function _drawQr(btn, wa) {
            if (btn._empDrawn || typeof window._empLoadQR !== 'function') return;
            btn._empDrawn = true;
            window._empLoadQR().then(function (ok) {
                if (!ok || !window.QRCode || !document.body.contains(btn)) return;
                try {
                    btn.innerHTML = '';
                    new window.QRCode(btn, { text: 'https://wa.me/' + wa, width: 44, height: 44, colorDark: '#0A0E27', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.L });
                    btn.removeAttribute('title');
                } catch (er) { btn.innerHTML = '<i class="fas fa-qrcode"></i>'; }
            });
        }

        /* remove a chip from the text: strip a dangling "WhatsApp:" label before it and any blank lines left at the end */
        function _stripChip(wrap) {
            var parent = wrap.parentNode;
            var prev = wrap.previousSibling;
            if (prev && prev.nodeType === 3) {
                prev.nodeValue = prev.nodeValue.replace(/(?:(?:chat|message|contact|reach|call)\s+(?:us\s+)?(?:on|via)?\s*)?(?:whats\s?-?app(?:\s+(?:number|no\.?|line))?|wa)\s*[:\-\u2013\u2014]?\s*$/i, '');
            }
            var next = wrap.nextSibling;
            var atEnd = true;
            while (next) {
                if (!((next.nodeType === 3 && !next.nodeValue.trim()) || (next.nodeType === 1 && next.tagName === 'BR'))) { atEnd = false; break; }
                next = next.nextSibling;
            }
            parent.removeChild(wrap);
            if (atEnd) {
                var last = parent.lastChild;
                while (last && ((last.nodeType === 1 && last.tagName === 'BR') || (last.nodeType === 3 && !last.nodeValue.trim()))) {
                    parent.removeChild(last); last = parent.lastChild;
                }
            }
        }

        function _kid(card, cls) {
            var k = card.children;
            for (var i = 0; i < k.length; i++) if (k[i].classList && k[i].classList.contains(cls)) return k[i];
            return null;
        }

        /* feed posts: banner goes right after the photos/video (below the text and any quoted post, above the
           like/reply row); a text-only post gets it right above that row */
        function _placeBanner(b, host) {
            var card = host.parentNode;
            if (!card) return;
            var media = _kid(card, 'story-media-container');
            var target = media ? media.nextSibling : (_kid(card, 'story-actions') || host.nextSibling);
            if (target === b || b.nextSibling === target) return;
            card.insertBefore(b, target);
        }

        function _decorate() {
            var chips = document.querySelectorAll('span.emp-wa');
            for (var i = 0; i < chips.length; i++) {
                var wrap = chips[i];
                if (wrap.closest(SKIP)) continue;
                var host = wrap.closest(SCOPE);
                if (!host) continue;
                var chip = wrap.querySelector('a.emp-wa-chip');
                if (!chip) continue;
                var wa = chip.getAttribute('data-wa') || '';
                var label = chip.getAttribute('data-wa-label') || ('+' + wa);
                if (!wa) continue;

                /* feed posts: the banner sits right under the post text (outside the clamped text, so it is
                   visible before "Show more"); everywhere else it replaces the chip in place */
                var lift = host.classList.contains('story-content');
                var existing = lift ? _kid(host.parentNode, 'emp-wab-lifted') : host.querySelector('.emp-wab');
                if (existing) {
                    /* a re-render of the text brought the same chip back: just drop it again */
                    if (lift && existing.getAttribute('data-wa') === wa) _stripChip(wrap);
                    continue;
                }

                var b = document.createElement('span');
                b.className = 'emp-wab' + (lift ? ' emp-wab-lifted' : '');
                b.setAttribute('data-wa', wa);
                b.innerHTML =
                    '<a class="emp-wa-chip emp-wab-main" href="https://wa.me/' + _esc(wa) + '" data-wa="' + _esc(wa) + '" data-wa-label="' + _esc(label) + '" target="_blank" rel="noopener noreferrer">'
                    + '<span class="emp-wab-ico">' + _waLogo(40) + '</span>'
                    + '<span class="emp-wab-txt"><b>Chat on WhatsApp</b><small>' + _esc(label) + '</small></span></a>'
                    + '<button type="button" class="emp-wa-qr emp-wab-qr" data-wa="' + _esc(wa) + '" data-wa-label="' + _esc(label) + '" aria-label="Show WhatsApp QR code"><i class="fas fa-qrcode"></i></button>';

                if (lift) {
                    _placeBanner(b, host);
                    _stripChip(wrap);
                } else {
                    var prev = wrap.previousSibling;
                    if (prev && prev.nodeType === 3) {
                        prev.nodeValue = prev.nodeValue.replace(/(?:(?:chat|message|contact|reach|call)\s+(?:us\s+)?(?:on|via)?\s*)?(?:whats\s?-?app(?:\s+(?:number|no\.?|line))?|wa)\s*[:\-\u2013\u2014]?\s*$/i, '');
                    }
                    wrap.parentNode.replaceChild(b, wrap);
                }
                _drawQr(b.querySelector('button.emp-wab-qr'), wa);
            }
            var lifted = document.querySelectorAll('.emp-wab-lifted');
            for (var j = 0; j < lifted.length; j++) {
                var h = lifted[j].parentNode && _kid(lifted[j].parentNode, 'story-content');
                if (h) _placeBanner(lifted[j], h);
            }
            var icons = document.querySelectorAll('a.emp-wa-chip i.fa-whatsapp');
            for (var m = 0; m < icons.length; m++) {
                var tmp = document.createElement('span');
                tmp.innerHTML = _waLogo(18);
                icons[m].parentNode.replaceChild(tmp.firstChild, icons[m]);
            }
        }

        /* ── composer: "Show my WhatsApp number" in Quick Post ── */
        function _normalize(raw) {
            var d = String(raw || '').replace(/\D/g, '');
            if (!d) return '';
            var cc = window._EMP_DEFAULT_CC || '234';
            if (!/^\s*\+/.test(String(raw))) {
                if (d.indexOf('00') === 0) d = d.slice(2);
                else if (d.charAt(0) === '0') d = cc + d.slice(1);
                else if (d.length <= 10) d = cc + d;
            }
            return (d.length >= 8 && d.length <= 15) ? d : '';
        }
        function _pretty(d) {
            return /^234\d{10}$/.test(d) ? ('+234 ' + d.slice(3, 6) + ' ' + d.slice(6, 9) + ' ' + d.slice(9)) : ('+' + d);
        }

        function _ensureComposer() {
            var form = document.getElementById('quick-post-form');
            if (!form || document.getElementById('emp-wac')) return;
            var actions = form.querySelector('.quick-post-actions');
            if (!actions) return;
            var box = document.createElement('div');
            box.id = 'emp-wac';
            box.innerHTML =
                '<div class="emp-wac-row">'
                + '<span class="emp-wac-ico">' + _waLogo(34) + '</span>'
                + '<div class="emp-wac-lbl"><b>Show my WhatsApp number</b><small>Adds a Chat on WhatsApp banner to this post</small></div>'
                + '<button type="button" id="emp-wac-sw" role="switch" aria-checked="false" aria-label="Show my WhatsApp number"><span></span></button>'
                + '</div>'
                + '<div id="emp-wac-fields" hidden>'
                + '<input type="tel" id="emp-wac-num" inputmode="tel" autocomplete="tel" placeholder="+234 801 234 5678" aria-label="WhatsApp number">'
                + '<p id="emp-wac-err" hidden>Enter a valid WhatsApp number</p>'
                + '<p class="emp-wac-note">Anyone who can see this post can see this number. Switch it off any time before posting.</p>'
                + '</div>';
            form.insertBefore(box, actions);
        }

        function _resetComposer() {
            var sw = document.getElementById('emp-wac-sw'), f = document.getElementById('emp-wac-fields'),
                n = document.getElementById('emp-wac-num'), er = document.getElementById('emp-wac-err');
            if (sw) sw.setAttribute('aria-checked', 'false');
            if (f) f.hidden = true;
            if (n) n.value = '';
            if (er) er.hidden = true;
            _resetSocial();
        }

        function _watchReset() {
            var tries = 0;
            var t = setInterval(function () {
                var ta = document.getElementById('quick-post-text');
                if (++tries > 80) { clearInterval(t); return; }
                if (ta && ta.value === '') { clearInterval(t); _resetComposer(); }
            }, 500);
        }

        document.addEventListener('click', function (e) {
            var sw = e.target && e.target.closest && e.target.closest('#emp-wac-sw');
            if (!sw) return;
            e.preventDefault();
            var on = sw.getAttribute('aria-checked') !== 'true';
            sw.setAttribute('aria-checked', on ? 'true' : 'false');
            var f = document.getElementById('emp-wac-fields'), n = document.getElementById('emp-wac-num'), er = document.getElementById('emp-wac-err');
            if (f) f.hidden = !on;
            if (er) er.hidden = true;
            if (on && n) {
                if (!n.value) {
                    var ph = window.userState && window.userState.phone;
                    var d = _normalize(ph);
                    if (d) n.value = _pretty(d);
                }
                try { n.focus(); } catch (er2) {}
            }
        });
        document.addEventListener('input', function (e) {
            if (e.target && e.target.id === 'emp-wac-num') {
                var er = document.getElementById('emp-wac-err'); if (er) er.hidden = true;
            }
        });

        /* capture phase: runs before Quick Post's own submit handler reads the textarea */
        document.addEventListener('submit', function (e) {
            var form = e.target;
            if (!form || form.id !== 'quick-post-form') return;
            var sw = document.getElementById('emp-wac-sw');
            if (!sw || sw.getAttribute('aria-checked') !== 'true') return;
            var ta = document.getElementById('quick-post-text'), n = document.getElementById('emp-wac-num'), er = document.getElementById('emp-wac-err');
            var d = _normalize(n && n.value);
            if (!d) {
                e.preventDefault(); e.stopImmediatePropagation();
                if (er) er.hidden = false;
                if (n) { try { n.focus(); } catch (er2) {} }
                return;
            }
            var base = (ta.value || '').trim();
            var hasMedia = !!document.querySelector('#quick-post-media-preview > *');
            if (!base && !hasMedia) return; /* let Quick Post reject an empty post itself */
            var line = 'WhatsApp: ' + _pretty(d);
            if (base.indexOf(line) === -1) ta.value = base + (base ? '\n\n' : '') + line;
            _watchReset();
        }, true);

        /* ═══════════════════════════════════════════════════════════════
           §10b  SOCIAL LINK BANNERS (2026-10-26)
           ─────────────────────────────────────────────────────────────
           Same model as the WhatsApp banner above, for X, Facebook,
           Telegram, Instagram, TikTok, LinkedIn and YouTube. Quick Post
           gets an optional "Add social links" section (collapsed by
           default, one box per platform). At submit, each filled box is
           added to the end of the post as its own line, "Instagram:
           https://instagram.com/name". The text stays the source of
           truth: after render, a link that sits on its own line directly
           after its platform label is re-skinned into a banner (platform
           logo tile, "Follow on …", the handle, an arrow) that opens the
           profile in a new tab. Empty boxes add nothing. Links typed
           anywhere else in a post, or without that label, stay ordinary
           links. Feed posts lift the banners under the photos (same slot
           as the WhatsApp banner); everywhere else they replace the link
           in place. Comments and chats are skipped (SKIP).
        ═══════════════════════════════════════════════════════════════ */
        var SOC = [
            { key: 'whatsapp',  name: 'WhatsApp',  out: 'WhatsApp Link', lbl: 'WhatsApp\\s*Link', cta: 'Chat on WhatsApp', host: /(^|\.)(chat\.whatsapp\.com|whatsapp\.com|wa\.me)$/i, base: '', ph: 'WhatsApp group or channel link', bg: '#25D366', c: '#25D366', d: WA_LOGO_PATH },
            { key: 'x',         name: 'X',         lbl: 'X|Twitter', cta: 'Follow on X',         host: /(^|\.)(x|twitter)\.com$/i,                     base: 'https://x.com/',                  ph: 'x.com/yourname or @yourname',          bg: '#000000', c: '#0F1419', d: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z' },
            { key: 'facebook',  name: 'Facebook',  lbl: 'Facebook',  cta: 'Follow on Facebook',  host: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i,       base: 'https://facebook.com/',           ph: 'facebook.com/yourpage',                bg: '#1877F2', c: '#1877F2', d: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
            { key: 'telegram',  name: 'Telegram',  lbl: 'Telegram',  cta: 'Join on Telegram',    host: /(^|\.)(t\.me|telegram\.me|telegram\.dog)$/i,   base: 'https://t.me/',                   ph: 't.me/yourchannel or @yourchannel',     bg: '#229ED9', c: '#229ED9', d: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z' },
            { key: 'instagram', name: 'Instagram', lbl: 'Instagram', cta: 'Follow on Instagram', host: /(^|\.)(instagram\.com|instagr\.am)$/i,         base: 'https://instagram.com/',          ph: 'instagram.com/yourname or @yourname',  bg: 'linear-gradient(45deg,#F58529,#DD2A7B 55%,#8134AF)', c: '#DD2A7B', d: 'M12 2.2c3.2 0 3.6 0 4.9.1 1.2 0 1.9.2 2.4.4a4.8 4.8 0 0 1 2.7 2.7c.2.5.4 1.2.4 2.4.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.9-.4 2.4a4.8 4.8 0 0 1-2.7 2.7c-.5.2-1.2.4-2.4.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.9-.2-2.4-.4a4.8 4.8 0 0 1-2.7-2.7c-.2-.5-.4-1.2-.4-2.4C1.5 15.6 1.5 15.2 1.5 12s0-3.6.1-4.9c0-1.2.2-1.9.4-2.4A4.8 4.8 0 0 1 4.7 2c.5-.2 1.2-.4 2.4-.4C8.4 2.2 8.8 2.2 12 2.2zm0 1.8c-3.1 0-3.5 0-4.7.1-1 0-1.5.2-1.9.3a3 3 0 0 0-1.7 1.7c-.1.4-.3.9-.3 1.9-.1 1.2-.1 1.6-.1 4.7s0 3.5.1 4.7c0 1 .2 1.5.3 1.9a3 3 0 0 0 1.7 1.7c.4.1.9.3 1.9.3 1.2.1 1.6.1 4.7.1s3.5 0 4.7-.1c1 0 1.5-.2 1.9-.3a3 3 0 0 0 1.7-1.7c.1-.4.3-.9.3-1.9.1-1.2.1-1.6.1-4.7s0-3.5-.1-4.7c0-1-.2-1.5-.3-1.9a3 3 0 0 0-1.7-1.7c-.4-.1-.9-.3-1.9-.3-1.2-.1-1.6-.1-4.7-.1zm0 4.3a5.7 5.7 0 1 1 0 11.4 5.7 5.7 0 0 1 0-11.4zm0 1.8a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8zm5.9-2a1.3 1.3 0 1 1 0 2.7 1.3 1.3 0 0 1 0-2.7z' },
            { key: 'tiktok',    name: 'TikTok',    lbl: 'TikTok',    cta: 'Follow on TikTok',    host: /(^|\.)tiktok\.com$/i,                          base: 'https://www.tiktok.com/@',        ph: 'tiktok.com/@yourname or @yourname',    bg: '#010101', c: '#25F4EE', d: 'M16.5 2h-3v13.5a2.8 2.8 0 1 1-2-2.7V9.6a6 6 0 1 0 5 5.9V8.9a7.6 7.6 0 0 0 4.5 1.5V7.3A4.7 4.7 0 0 1 16.5 2z' },
            { key: 'linkedin',  name: 'LinkedIn',  lbl: 'LinkedIn',  cta: 'Connect on LinkedIn', host: /(^|\.)(linkedin\.com|lnkd\.in)$/i,             base: 'https://www.linkedin.com/in/',    ph: 'linkedin.com/in/yourname',             bg: '#0A66C2', c: '#0A66C2', d: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
            { key: 'youtube',   name: 'YouTube',   lbl: 'YouTube',   cta: 'Subscribe on YouTube', host: /(^|\.)(youtube\.com|youtu\.be)$/i,            base: 'https://www.youtube.com/@',       ph: 'youtube.com/@yourchannel',             bg: '#FF0000', c: '#FF0000', d: 'M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 4 12 4 12 4s-7.5 0-9.4.4A3 3 0 0 0 .5 6.5 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.5 3 3 0 0 0 2.1 2.1C4.5 20 12 20 12 20s7.5 0 9.4-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.5zM9.6 15.5v-7l6.3 3.5z' }
        ];
        var SOC_SEL = ['x.com', 'twitter.com', 'facebook.com', 'fb.com', 'fb.me', 't.me', 'telegram.me', 'telegram.dog', 'instagram.com', 'instagr.am', 'tiktok.com', 'linkedin.com', 'lnkd.in', 'youtube.com', 'youtu.be', 'whatsapp.com', 'wa.me']
            .map(function (d) { return 'a[href*="' + d + '"]'; }).join(',');

        function _socByKey(k) { for (var i = 0; i < SOC.length; i++) if (SOC[i].key === k) return SOC[i]; return null; }
        function _socByHost(h) { for (var i = 0; i < SOC.length; i++) if (SOC[i].host.test(h)) return SOC[i]; return null; }
        function _socGlyph(p, px) {
            return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="' + p.d + '"/></svg>';
        }

        /* "" = box empty, null = not a valid link for this platform, otherwise the clean https URL */
        function _socNormalize(p, raw) {
            var v = String(raw || '').trim();
            if (!v) return '';
            if (/\s/.test(v)) return null;
            var url;
            if (/^https?:\/\//i.test(v)) url = v;
            else {
                var first = v.split(/[\/?#]/)[0].replace(/^(?:www\.|m\.)/i, '');
                if (p.host.test(first)) url = 'https://' + v;
                else if (p.base && /^@?[A-Za-z0-9._-]{1,60}$/.test(v)) url = p.base + v.replace(/^@/, '');
                else return null;
            }
            var u; try { u = new URL(url); } catch (e) { return null; }
            if (!/^https?:$/.test(u.protocol) || !p.host.test(u.hostname)) return null;
            if (/['"`<>]/.test(u.href)) return null;
            /* a YouTube VIDEO link is turned into an embedded player by the post formatter, not a link,
               so only channel/profile links make a banner */
            if (p.key === 'youtube' && (/(^|\.)youtu\.be$/i.test(u.hostname) || /[?&]v=|\/shorts\/|\/embed\/|\/live\//i.test(u.pathname + u.search))) return null;
            return u.href.replace(/\/$/, '');
        }

        function _socHandle(p, href) {
            try {
                var u = new URL(href);
                var segs = u.pathname.split('/').filter(Boolean).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
                var s0 = segs[0] || '', s1 = segs[1] || '';
                var host = u.hostname.replace(/^www\./, '');
                if (p.key === 'whatsapp') return /^chat\./i.test(u.hostname) ? 'Group invite' : (/^\/channel\//i.test(u.pathname) ? 'Channel' : (/^wa\.me$/i.test(u.hostname) && s0 ? '+' + s0.replace(/\D/g, '') : host + u.pathname.replace(/\/$/, '')));
                if (p.key === 'x' || p.key === 'instagram' || p.key === 'tiktok' || p.key === 'telegram') return s0 ? '@' + s0.replace(/^@/, '') : host;
                if (p.key === 'youtube') return /^@/.test(s0) ? s0 : (/^(channel|c|user)$/i.test(s0) && s1 ? s1 : host + u.pathname.replace(/\/$/, ''));
                if (p.key === 'linkedin') return /^(in|company|school)$/i.test(s0) && s1 ? s1 : host + u.pathname.replace(/\/$/, '');
                if (p.key === 'facebook') return /^groups$/i.test(s0) && s1 ? s1 : (s0 && !/^profile\.php$/i.test(s0) ? s0 : host + u.pathname.replace(/\/$/, ''));
                return host + u.pathname.replace(/\/$/, '');
            } catch (e) { return href; }
        }
        function _socCta(p, href) {
            if (p.key === 'whatsapp') { try { var wu = new URL(href); if (/^chat\./i.test(wu.hostname)) return 'Join WhatsApp Group'; if (/^\/channel\//i.test(wu.pathname)) return 'Follow WhatsApp Channel'; } catch (e) {} }
            if (p.key === 'facebook') { try { if (/^\/groups\//i.test(new URL(href).pathname)) return 'Join on Facebook'; } catch (e) {} }
            return p.cta;
        }

        function _socBanner(p, href) {
            var b = document.createElement('span');
            b.className = 'emp-sob';
            b.setAttribute('data-sob', p.key);
            b.setAttribute('data-url', href);
            b.style.setProperty('--sob-c', p.c);
            b.innerHTML =
                '<a class="emp-sob-main" href="' + _esc(href) + '" target="_blank" rel="noopener noreferrer">'
                + '<span class="emp-sob-ico" style="background:' + p.bg + '">' + _socGlyph(p, 24) + '</span>'
                + '<span class="emp-sob-txt"><b>' + _esc(_socCta(p, href)) + '</b><small>' + _esc(_socHandle(p, href)) + '</small></span>'
                + '<span class="emp-sob-go" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span></a>';
            return b;
        }

        /* the text node right before the link must end with this platform's label ("Instagram:") and that
           label must start its own line */
        function _socLabelNode(a, p) {
            var prev = a.previousSibling;
            if (!prev || prev.nodeType !== 3) return null;
            var re = new RegExp('(?:^|\\n)[ \\t\\u00a0]*(?:' + p.lbl + ')[ \\t\\u00a0]*:[ \\t\\u00a0]*$', 'i');
            var m = re.exec(prev.nodeValue);
            if (!m) return null;
            var ps = prev.previousSibling;
            /* an earlier banner's label leaves an empty text node behind — look past it */
            while (ps && ps.nodeType === 3 && !ps.nodeValue.trim()) ps = ps.previousSibling;
            var startsLine = !ps || (ps.nodeType === 1 && ps.tagName === 'BR');
            if (m.index === 0 && prev.nodeValue.charAt(0) !== '\n' && !startsLine) return null;
            return prev;
        }

        /* take the label + link (and the link-card placeholder / card the formatter attached to it) out of the text */
        function _socStrip(a, p, prev) {
            var parent = a.parentNode;
            prev.nodeValue = prev.nodeValue.replace(new RegExp('[ \\t\\u00a0]*(?:' + p.lbl + ')[ \\t\\u00a0]*:[ \\t\\u00a0]*$', 'i'), '');
            var ph = a.nextElementSibling;
            if (ph && ph.classList && ph.classList.contains('emp-linkcard-ph')) {
                if (ph.dataset && ph.dataset.lpDone) {
                    var hp = ph.closest('p') || ph;
                    var card = hp.nextElementSibling;
                    if (card && card.classList && card.classList.contains('emp-linkcard')) card.parentNode.removeChild(card);
                }
                parent.removeChild(ph);
            }
            var nx = a.nextSibling;
            parent.removeChild(a);
            if (nx && nx.nodeType === 1 && nx.tagName === 'BR') parent.removeChild(nx);
            var last = parent.lastChild;
            while (last && ((last.nodeType === 1 && last.tagName === 'BR') || (last.nodeType === 3 && !last.nodeValue.trim()))) {
                parent.removeChild(last); last = parent.lastChild;
            }
            if (parent.tagName === 'P' && !parent.textContent.trim() && !parent.querySelector('img,iframe,svg,video,a')) parent.style.display = 'none';
        }

        /* lifted group goes right after the WhatsApp banner (or the photos); with no photos it goes just
           before the WhatsApp banner / like row — chosen so this and _placeBanner never fight over order */
        function _placeSocial(g, host) {
            var card = host.parentNode;
            if (!card) return;
            var wa = _kid(card, 'emp-wab-lifted');
            var media = _kid(card, 'story-media-container');
            var before;
            if (media) {
                var ref = wa || media;
                if (ref.nextSibling === g) return;
                before = ref.nextSibling;
            } else {
                before = wa || _kid(card, 'story-actions') || host.nextSibling;
                if (before === g || g.nextSibling === before) return;
            }
            card.insertBefore(g, before);
        }

        function _decorateSocial() {
            var list = document.querySelectorAll(SOC_SEL);
            for (var i = 0; i < list.length; i++) {
                var a = list[i];
                if (a._empSob || a.closest('.emp-sob, .emp-linkcard')) continue;
                var host = a.closest(SCOPE);
                if (!host || a.closest(SKIP)) continue;
                if (!/^https?:$/.test(a.protocol)) continue;
                var p = _socByHost(a.hostname);
                if (!p) continue;
                var prev = _socLabelNode(a, p);
                if (!prev) continue;
                a._empSob = true;
                var href = a.href;
                var lift = host.classList.contains('story-content');
                if (lift) {
                    var g = _kid(host.parentNode, 'emp-sob-lifted');
                    if (!g) {
                        g = document.createElement('span');
                        g.className = 'emp-sob-grp emp-sob-lifted';
                        host.parentNode.insertBefore(g, host.nextSibling);
                    }
                    var dup = false;
                    for (var k = 0; k < g.children.length; k++) if (g.children[k].getAttribute('data-url') === href) dup = true;
                    if (!dup) g.appendChild(_socBanner(p, href));
                    _socStrip(a, p, prev);
                    _placeSocial(g, host);
                } else {
                    var b = _socBanner(p, href);
                    prev.nodeValue = prev.nodeValue.replace(new RegExp('[ \\t\\u00a0]*(?:' + p.lbl + ')[ \\t\\u00a0]*:[ \\t\\u00a0]*$', 'i'), '');
                    var ph = a.nextElementSibling;
                    if (ph && ph.classList && ph.classList.contains('emp-linkcard-ph')) ph.parentNode.removeChild(ph);
                    a.parentNode.replaceChild(b, a);
                }
            }
            var groups = document.querySelectorAll('.emp-sob-lifted');
            for (var j = 0; j < groups.length; j++) {
                var h = groups[j].parentNode && _kid(groups[j].parentNode, 'story-content');
                if (h) _placeSocial(groups[j], h);
            }
        }

        /* ── composer: "Add social links" in Quick Post ── */
        function _ensureSocialComposer() {
            var form = document.getElementById('quick-post-form');
            if (!form || document.getElementById('emp-soc')) return;
            var actions = form.querySelector('.quick-post-actions');
            if (!actions) return;
            var box = document.createElement('div');
            box.id = 'emp-soc';
            var rows = SOC.map(function (p) {
                return '<div class="emp-soc-row"><span class="emp-soc-ico" style="background:' + p.bg + '">' + _socGlyph(p, 17) + '</span>'
                    + '<input type="text" class="emp-soc-in" data-soc="' + p.key + '" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + _esc(p.ph) + '" aria-label="' + _esc(p.name) + ' link"></div>';
            }).join('');
            box.innerHTML =
                '<button type="button" id="emp-soc-tg" class="emp-soc-head" aria-expanded="false" aria-controls="emp-soc-fields">'
                + '<span class="emp-soc-ico emp-soc-ico-lg"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/></svg></span>'
                + '<span class="emp-soc-lbl"><b>Add social links</b><small id="emp-soc-sub">Optional — each link becomes a tap-to-open banner</small></span>'
                + '<span class="emp-soc-chev"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span>'
                + '</button>'
                + '<div id="emp-soc-fields" hidden>' + rows
                + '<p id="emp-soc-err" hidden></p>'
                + '<p class="emp-soc-note">Use the full link or just @name. Leave a box empty to skip it. Anyone who can see this post can see these links.</p>'
                + '</div>';
            form.insertBefore(box, actions);
        }

        function _socSub() {
            var sub = document.getElementById('emp-soc-sub');
            if (!sub) return;
            var n = 0, ins = document.querySelectorAll('#emp-soc .emp-soc-in');
            for (var i = 0; i < ins.length; i++) if (ins[i].value.trim()) n++;
            sub.textContent = n ? (n + (n === 1 ? ' link' : ' links') + ' will be added as banners') : 'Optional — each link becomes a tap-to-open banner';
        }

        function _resetSocial() {
            var ins = document.querySelectorAll('#emp-soc .emp-soc-in');
            for (var i = 0; i < ins.length; i++) ins[i].value = '';
            var tg = document.getElementById('emp-soc-tg'), f = document.getElementById('emp-soc-fields'), er = document.getElementById('emp-soc-err');
            if (tg) tg.setAttribute('aria-expanded', 'false');
            if (f) f.hidden = true;
            if (er) er.hidden = true;
            _socSub();
        }

        document.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            var tg = t.closest('#emp-soc-tg');
            if (tg) {
                e.preventDefault();
                var open = tg.getAttribute('aria-expanded') !== 'true';
                tg.setAttribute('aria-expanded', open ? 'true' : 'false');
                var f = document.getElementById('emp-soc-fields'); if (f) f.hidden = !open;
                return;
            }
            /* a banner tap opens the profile only — it must not also open the post */
            if (t.closest('a.emp-sob-main')) e.stopPropagation();
        }, true);
        document.addEventListener('input', function (e) {
            if (e.target && e.target.classList && e.target.classList.contains('emp-soc-in')) {
                var er = document.getElementById('emp-soc-err'); if (er) er.hidden = true;
                _socSub();
            }
        });

        /* capture phase, registered after the WhatsApp one: runs before Quick Post reads the textarea */
        document.addEventListener('submit', function (e) {
            var form = e.target;
            if (!form || form.id !== 'quick-post-form') return;
            var ins = document.querySelectorAll('#emp-soc .emp-soc-in');
            if (!ins.length) return;
            var lines = [], bad = null;
            for (var i = 0; i < ins.length; i++) {
                var p = _socByKey(ins[i].getAttribute('data-soc'));
                var r = p ? _socNormalize(p, ins[i].value) : '';
                if (r === '') continue;
                if (r === null) { bad = { inp: ins[i], p: p }; break; }
                lines.push((p.out || p.name) + ': ' + r);
            }
            if (bad) {
                e.preventDefault(); e.stopImmediatePropagation();
                var tg = document.getElementById('emp-soc-tg'), f = document.getElementById('emp-soc-fields'), er = document.getElementById('emp-soc-err');
                if (tg) tg.setAttribute('aria-expanded', 'true');
                if (f) f.hidden = false;
                if (er) {
                    er.textContent = bad.p.key === 'youtube'
                        ? 'Add your YouTube channel link (youtube.com/@name), not a video link.'
                        : 'That doesn\u2019t look like ' + (/^[AEIOX]/i.test(bad.p.name) ? 'an ' : 'a ') + bad.p.name + ' link. Use the full link or just @name.';
                    er.hidden = false;
                }
                try { bad.inp.focus(); } catch (er2) {}
                return;
            }
            if (!lines.length) return;
            var ta = document.getElementById('quick-post-text');
            if (!ta) return;
            var base = (ta.value || '').trim();
            var hasMedia = !!document.querySelector('#quick-post-media-preview > *');
            if (!base && !hasMedia) return; /* let Quick Post reject an empty post itself */
            var cur = (ta.value || '').replace(/\s+$/, '');
            var add = lines.filter(function (l) { return cur.indexOf(l) === -1; });
            if (add.length) {
                var joiner = !cur ? '' : (/(?:^|\n)(?:WhatsApp Link|WhatsApp|X|Twitter|Facebook|Telegram|Instagram|TikTok|LinkedIn|YouTube):[^\n]*$/.test(cur) ? '\n' : '\n\n');
                ta.value = cur + joiner + add.join('\n');
            }
            _watchReset();
        }, true);

        /* ── wiring ── */
        var _t = null;
        function _run() { _t = null; _ensureComposer(); _ensureSocialComposer(); _decorate(); _decorateSocial(); }
        function _schedule() { if (_t) return; _t = setTimeout(_run, 150); }
        function _start() {
            if (!document.body) return;
            new MutationObserver(_schedule).observe(document.body, { childList: true, subtree: true });
            _run();
        }
        if (document.body) _start(); else document.addEventListener('DOMContentLoaded', _start);
        document.addEventListener('empyrean-init-done', function () { setTimeout(_run, 900); });
    })();

    /* ═══════════════════════════════════════════════════════════════
       §11  CHAT LINK CARDS — 1:1 AND GROUP CHATS  (2026-10-28)
       Request: "links shared in 1:1 or group chats appear only as plain text — detect social media links
       (Facebook, WhatsApp, YouTube, Instagram, TikTok, LinkedIn, Telegram) and generate a card thumbnail".
       WHY §6/§7 NEVER REACHED CHAT: they only watch #chat-messages-container / #messages-list, but the live chat
       screens render into #oc-messages-body (1:1, bubbles = .oc-bubble > p) and #v13-grp-body (group, text =
       .v13-grp-msg-text), and #chat-messages-container is just a hidden legacy anchor. This section watches those
       two bodies, makes every http(s) link in a message tappable, and puts a preview card for the FIRST link under
       the message text, reusing the same server-side /api/link-preview unfurler + _buildCard used for feed posts.
         • Social links (see SOCIAL below) that the unfurler cannot read (Instagram/TikTok/LinkedIn often block
           servers) still get a branded fallback card, so the link never stays a bare string.
         • Empyrean group invite links (?openGroup=<id>) get a "Group chat invite" card with a "View group" button,
           and tapping the link/card opens the group instantly inside the app (window._empOpenGroupFromLink in
           app-patch-v13.js) instead of reloading the whole app through the dashboard.
    ═══════════════════════════════════════════════════════════════ */
    (function _chatLinkCards() {
        var SOCIAL = [
            { name: 'Facebook',  color: '#1877F2', host: /(^|\.)(facebook\.com|fb\.com|fb\.watch|fb\.me)$/i },
            { name: 'WhatsApp',  color: '#25D366', host: /(^|\.)(whatsapp\.com|wa\.me)$/i },
            { name: 'YouTube',   color: '#FF0000', host: /(^|\.)(youtube\.com|youtu\.be)$/i },
            { name: 'Instagram', color: '#E1306C', host: /(^|\.)(instagram\.com|instagr\.am)$/i },
            { name: 'TikTok',    color: '#111111', host: /(^|\.)tiktok\.com$/i },
            { name: 'LinkedIn',  color: '#0A66C2', host: /(^|\.)(linkedin\.com|lnkd\.in)$/i },
            { name: 'Telegram',  color: '#229ED9', host: /(^|\.)(t\.me|telegram\.me|telegram\.dog)$/i },
            { name: 'X',         color: '#000000', host: /(^|\.)(x\.com|twitter\.com)$/i }
        ];
        function _social(host) {
            for (var i = 0; i < SOCIAL.length; i++) if (SOCIAL[i].host.test(host || '')) return SOCIAL[i];
            return null;
        }
        function _trimUrl(url) {
            var tr = '';
            for (;;) {
                var c = url.charAt(url.length - 1);
                if (c && ('.,!?;:*_~]'.indexOf(c) !== -1 || (c === ')' && url.split(')').length > url.split('(').length))) { tr = c + tr; url = url.slice(0, -1); }
                else break;
            }
            return [url, tr];
        }
        /* group id if this is one of OUR group invite links (same origin, or the production domain) */
        function _groupIdFromUrl(url) {
            try {
                var u = new URL(url);
                var g = u.searchParams.get('openGroup');
                if (g && (u.origin === location.origin || /(^|\.)joinempyrean\.com$/i.test(u.hostname))) return g;
            } catch (e) {}
            return '';
        }

        (function _css11() {
            if (document.getElementById('_elp_chat_css')) return;
            var st = document.createElement('style');
            st.id = '_elp_chat_css';
            st.textContent = [
                '.elp-chat-card-holder{ margin-top:6px; }',
                '.elp-chat-card-holder .elp-card{ max-width:100%;margin-top:0; }',
                '.elp-chat-card-holder .elp-card:hover{ transform:none; }',
                '.elp-gcard-ini{ display:flex;align-items:center;justify-content:center;height:150px;color:#fff;font-weight:800;font-size:3rem; }',
                '.elp-gcard-cta{ margin-top:8px;padding-top:8px;border-top:1px solid rgba(27,43,139,.14);text-align:center;font-weight:700;font-size:.86rem;color:#1B2B8B; }',
                '.elp-card-soc{ display:inline-block;font-size:.66rem;font-weight:800;letter-spacing:.4px;color:#fff;padding:2px 8px;border-radius:999px;margin-bottom:6px; }'
            ].join('\n');
            document.head.appendChild(st);
        })();

        /* turn plain-text URLs inside a message text element into real links (text nodes only, so mention spans
           and other markup are left untouched) */
        function _linkifyNodes(el) {
            var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
            var nodes = [], n;
            while ((n = walker.nextNode())) {
                if (n.parentNode && !(n.parentNode.closest && n.parentNode.closest('a'))) nodes.push(n);
            }
            nodes.forEach(function (tn) {
                var txt = tn.nodeValue;
                URL_RE.lastIndex = 0;
                if (!URL_RE.test(txt)) { URL_RE.lastIndex = 0; return; }
                URL_RE.lastIndex = 0;
                var frag = document.createDocumentFragment(), last = 0, m;
                while ((m = URL_RE.exec(txt))) {
                    var parts = _trimUrl(m[0]);
                    if (m.index > last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
                    var a = document.createElement('a');
                    a.className = 'elp-link'; a.href = parts[0]; a.target = '_blank'; a.rel = 'noopener noreferrer';
                    a.textContent = parts[0];
                    frag.appendChild(a);
                    if (parts[1]) frag.appendChild(document.createTextNode(parts[1]));
                    last = m.index + m[0].length;
                }
                URL_RE.lastIndex = 0;
                if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
                tn.parentNode.replaceChild(frag, tn);
            });
        }

        /* tapping one of our own group links inside a chat opens the group directly */
        function _wireGroupClick(el, gid, href) {
            if (el._elpG) return;
            el._elpG = true;
            el.addEventListener('click', function (e) {
                if (typeof window._empOpenGroupFromLink !== 'function') return; /* default navigation */
                e.preventDefault(); e.stopPropagation();
                if (window._empOpenGroupFromLink(gid) === false) { location.href = href; }
            });
        }

        /* FIX (2026-10-28 — tapping a shared photo/video/reel link inside a chat opened a NEW TAB, which cold-booted the
           whole app and ended on the dashboard): our own ?post=<id> links now open the content directly inside the
           running app via window._empOpenSharedPost (app-startup.js), exactly like group links above. */
        function _postIdFromUrl(url) {
            try {
                var u = new URL(url);
                var pid = u.searchParams.get('post');
                if (pid && (u.origin === location.origin || /(^|\.)joinempyrean\.com$/i.test(u.hostname))) return pid;
            } catch (e) {}
            return '';
        }
        function _wirePostClick(el, pid, href) {
            if (el._elpP) return;
            el._elpP = true;
            el.addEventListener('click', function (e) {
                if (typeof window._empOpenSharedPost !== 'function') return; /* default navigation */
                e.preventDefault(); e.stopPropagation();
                window._empOpenSharedPost(pid);
            });
        }

        var _gCache = {};
        function _groupMeta(gid) {
            if (_gCache[gid]) return _gCache[gid];
            _gCache[gid] = new Promise(function (resolve) {
                function attempt(t) {
                    var cached = window._empyreanGroupCache && window._empyreanGroupCache[gid];
                    if (cached && cached.name) { resolve(cached); return; }
                    if (!window.fbDb || !window._firebaseLoaded) {
                        if (t < 10) setTimeout(function () { attempt(t + 1); }, 400); else resolve(null);
                        return;
                    }
                    /* FIX (2026-10-28): the browser-side read is denied/empty for anyone who isn't in the group, which left the
                       card as a generic "Empyrean group" with no picture. /api/group-invite-meta returns just name + picture. */
                    function viaServer(local) {
                        if (local && local.name && local.avatar) { resolve(local); return; }
                        fetch('/api/group-invite-meta?id=' + encodeURIComponent(gid), { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined })
                            .then(function (r) { return r.ok ? r.json() : null; })
                            .then(function (d) {
                                if (d && d.ok) resolve(Object.assign({}, local || {}, { name: (local && local.name) || d.name, avatar: (local && local.avatar) || d.avatar, memberCount: d.members }));
                                else resolve(local || null);
                            })
                            .catch(function () { resolve(local || null); });
                    }
                    window.fbDb.collection('groups').doc(gid).get()
                        .then(function (snap) { viaServer(snap && snap.exists ? snap.data() : null); })
                        .catch(function () { viaServer(null); });
                }
                attempt(0);
            });
            /* don't let a failed/nameless lookup stick for the whole session — the next card/paste retries */
            _gCache[gid].then(function (g) { if (!g || !g.name) delete _gCache[gid]; });
            return _gCache[gid];
        }

        function _buildGroupCard(g, url, gid) {
            /* real group name as the title; if it genuinely can't be read, say "Group chat invite" rather than a made-up name */
            var realName = (g && g.name) || '';
            var name = realName || 'Group chat invite';
            var img = (g && g.avatar) || '';
            var cnt = g && g.memberCount ? (g.memberCount + ' member' + (g.memberCount === 1 ? '' : 's')) : '';
            var root = document.createElement('div');
            root.className = 'elp-card elp-gcard';
            var ini = (window.EmpAvatar && window.EmpAvatar.initials) ? window.EmpAvatar.initials(name) : name.charAt(0).toUpperCase();
            var bg  = (window.EmpAvatar && window.EmpAvatar.colorFor) ? window.EmpAvatar.colorFor(name) : '#1B2B8B';
            root.innerHTML = (img
                ? '<img class="elp-card-img" src="' + _esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
                : '<div class="elp-card-img elp-gcard-ini" style="background:' + _esc(bg) + ';">' + _esc(ini) + '</div>') +
                '<div class="elp-card-body">' +
                '<div class="elp-card-title">' + _esc(name) + '</div>' +
                '<div class="elp-card-desc">Group chat invite' + (cnt ? ' · ' + _esc(cnt) : '') + '</div>' +
                '<div class="elp-gcard-cta">View group</div>' +
                '</div>';
            _wireGroupClick(root, gid, url);
            return root;
        }

        function _attachCard(textEl, url) {
            var holder = document.createElement('div');
            holder.className = 'elp-chat-card-holder';
            textEl.parentNode.insertBefore(holder, textEl.nextSibling);
            var gid = _groupIdFromUrl(url);
            var host = '';
            try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
            var soc = _social(host);

            /* FIX (2026-10-28 — "sending a message takes too long"): on a weak connection this preview download competed with the
               message's own Firestore write. Wait (max 5s) for the app's pending writes to be acknowledged before fetching. */
            var _afterWrites = new Promise(function (go) {
                var done = false; function fin() { if (!done) { done = true; go(); } }
                setTimeout(fin, 5000);
                try { if (window.fbDb && typeof window.fbDb.waitForPendingWrites === 'function') window.fbDb.waitForPendingWrites().then(fin, fin); else fin(); } catch (e) { fin(); }
            });
            var job = _afterWrites.then(function () {
                return gid
                    ? _groupMeta(gid).then(function (g) { return { group: true, g: g }; })
                    : _fetchPreview(url).then(function (meta) { return { group: false, meta: meta }; });
            });

            job.then(function (r) {
                var card = null;
                if (r.group) {
                    card = _buildGroupCard(r.g, url, gid);
                } else if (r.meta) {
                    card = _buildCard(r.meta, url);
                    var _cpid = card && _postIdFromUrl(url);
                    if (_cpid) _wirePostClick(card, _cpid, url);
                } else if (!soc) {
                    /* any other link the unfurler could not read — still a tappable domain card, never a bare string */
                    card = _buildCard({ title: host || 'Link', desc: 'Tap to open link', image: '', domain: host, label: host }, url);
                } else if (soc) {
                    /* the unfurler could not read this social link — still show a branded card */
                    card = _buildCard({ title: soc.name + ' link', desc: 'Tap to open on ' + soc.name, image: '', domain: host, label: host }, url);
                    if (card) {
                        var body = card.querySelector('.elp-card-body');
                        if (body) {
                            var chip = document.createElement('span');
                            chip.className = 'elp-card-soc';
                            chip.style.background = soc.color;
                            chip.textContent = soc.name;
                            body.insertBefore(chip, body.firstChild);
                        }
                    }
                }
                if (card) {
                    holder.appendChild(card);
                    /* WhatsApp-style: when the message is ONLY link(s), hide the raw URL text once its card is showing */
                    var leftover = (textEl.textContent || '').replace(/https?:\/\/[^\s<>"']{4,}/gi, '').replace(/\s+/g, '');
                    if (!leftover) textEl.style.display = 'none';
                }
                else if (holder.parentNode) holder.parentNode.removeChild(holder);
            }).catch(function () { if (holder.parentNode) holder.parentNode.removeChild(holder); });
        }

        function _processText(el) {
            if (el._elpChat) return;
            URL_RE.lastIndex = 0;
            var has = URL_RE.test(el.textContent || '');
            URL_RE.lastIndex = 0;
            if (!has) return;
            el._elpChat = true;
            _linkifyNodes(el);
            var anchors = el.querySelectorAll('a[href^="http"]');
            if (!anchors.length) return;
            for (var i = 0; i < anchors.length; i++) {
                var gid = _groupIdFromUrl(anchors[i].href);
                if (gid) _wireGroupClick(anchors[i], gid, anchors[i].href);
                else { var _pid = _postIdFromUrl(anchors[i].href); if (_pid) _wirePostClick(anchors[i], _pid, anchors[i].href); }
                anchors[i].addEventListener('click', function (e) { e.stopPropagation(); });
            }
            _attachCard(el, anchors[0].href);
        }


        /* ── COMPOSER PREVIEW STRIP (2026-10-28) ──
           Pasting/typing a link into the 1:1 (#oc-text-input) or group (#v13-grp-input) composer now shows a WhatsApp-style
           strip above the input right away: square thumbnail (group picture / page image), title, and a small subtitle, with an
           × to dismiss it. It clears itself when the message is sent (input emptied) or the link is deleted. The card inside the
           sent message is still built by _attachCard above. */
        (function _composerStrip() {
            var CFG = [
                { id: 'v13-grp-input', anchor: 'v13-grp-composer-row' },
                { id: 'oc-text-input', anchor: 'oc-composer' }
            ];
            var ST = {};
            (function css() {
                if (document.getElementById('_elp_cstrip_css')) return;
                var st = document.createElement('style'); st.id = '_elp_cstrip_css';
                st.textContent = [
                    '.elp-cstrip{ display:flex;align-items:center;gap:12px;margin:6px 10px 0;padding:8px;background:#F1F3F8;border-radius:14px;flex-shrink:0;position:relative;box-sizing:border-box;max-width:calc(100% - 20px); }',
                    '.elp-cstrip-th{ width:64px;height:64px;border-radius:12px;flex-shrink:0;overflow:hidden;background:#DDE3EE;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1.4rem; }',
                    '.elp-cstrip-th img{ width:100%;height:100%;object-fit:cover;display:block; }',
                    '.elp-cstrip-tx{ flex:1;min-width:0; }',
                    '.elp-cstrip-t{ font-weight:700;font-size:.92rem;color:#14213D;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
                    '.elp-cstrip-s{ font-size:.8rem;color:#5B6B86;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
                    '.elp-cstrip-x{ background:none;border:none;color:#6B7280;font-size:1.3rem;line-height:1;cursor:pointer;padding:6px;flex-shrink:0; }'
                ].join('\n');
                document.head.appendChild(st);
            })();

            function _firstUrl(txt) {
                URL_RE.lastIndex = 0;
                var m = URL_RE.exec(txt || '');
                URL_RE.lastIndex = 0;
                return m ? _trimUrl(m[0])[0] : '';
            }
            function _stripEl(id) { return document.getElementById('elp-cstrip-' + id); }
            function _remove(id) { var el = _stripEl(id); if (el && el.parentNode) el.parentNode.removeChild(el); }

            function _fill(el, thumbImg, title, sub, seed) {
                var th = el.querySelector('.elp-cstrip-th');
                if (th) {
                    th.innerHTML = '';
                    if (thumbImg) {
                        var im = document.createElement('img');
                        im.referrerPolicy = 'no-referrer'; im.alt = ''; im.src = thumbImg;
                        im.onerror = function () { th.removeChild(im); _ini(th, title || seed); };
                        th.style.background = '#DDE3EE';
                        th.appendChild(im);
                    } else { _ini(th, title || seed); }
                }
                el.querySelector('.elp-cstrip-t').textContent = title || seed;
                el.querySelector('.elp-cstrip-s').textContent = sub || '';
            }
            function _ini(th, name) {
                th.style.background = (window.EmpAvatar && window.EmpAvatar.colorFor) ? window.EmpAvatar.colorFor(name) : '#1B2B8B';
                th.textContent = (window.EmpAvatar && window.EmpAvatar.initials) ? window.EmpAvatar.initials(name) : String(name || '?').charAt(0).toUpperCase();
            }

            function _show(cfg, inp, url) {
                var anchor = document.getElementById(cfg.anchor);
                if (!anchor || !anchor.parentNode) return;
                var st = ST[cfg.id] || (ST[cfg.id] = { url: '', dismissed: '' });
                st.url = url;
                _remove(cfg.id);
                var el = document.createElement('div');
                el.id = 'elp-cstrip-' + cfg.id;
                el.className = 'elp-cstrip';
                el.innerHTML = '<div class="elp-cstrip-th"></div><div class="elp-cstrip-tx"><div class="elp-cstrip-t"></div><div class="elp-cstrip-s"></div></div>' +
                    '<button type="button" class="elp-cstrip-x" aria-label="Remove link preview">&times;</button>';
                el.querySelector('.elp-cstrip-x').addEventListener('click', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    st.dismissed = url; _remove(cfg.id);
                });
                anchor.parentNode.insertBefore(el, anchor);

                var host = '';
                try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
                var soc = _social(host);
                _fill(el, '', host || 'Link', 'Loading preview…', host || 'Link');

                var gid = _groupIdFromUrl(url);
                var job = gid ? _groupMeta(gid).then(function (g) { return { g: g }; })
                              : _fetchPreview(url).then(function (m) { return { m: m }; });
                job.then(function (r) {
                    if (st.url !== url || !_stripEl(cfg.id)) return;
                    if (gid) {
                        var g = r.g || {};
                        _fill(el, g.avatar || '', g.name || 'Group chat invite', g.name ? ('Group chat invite' + (g.memberCount ? ' · ' + g.memberCount + ' members' : '')) : 'Empyrean', 'Group chat invite');
                    } else if (r.m) {
                        _fill(el, r.m.image || '', r.m.title || (soc ? soc.name + ' link' : host), r.m.desc && !/^tap to open/i.test(r.m.desc) ? r.m.desc : (soc && /chat\./i.test(host) ? 'Group chat invite' : host), host);
                    } else {
                        _fill(el, '', soc ? soc.name + ' link' : host, soc ? host : 'Tap to open link', host);
                    }
                }).catch(function () { _fill(el, '', soc ? soc.name + ' link' : host, host, host); });
            }

            function _check(cfg) {
                var inp = document.getElementById(cfg.id);
                if (!inp) { _remove(cfg.id); return; }
                var url = _firstUrl(inp.value);
                var st = ST[cfg.id] || (ST[cfg.id] = { url: '', dismissed: '' });
                if (!url) { st.url = ''; st.dismissed = ''; _remove(cfg.id); return; }
                if (url === st.dismissed) return;
                if (url === st.url && _stripEl(cfg.id)) return;
                _show(cfg, inp, url);
            }
            function _onEvt(e) {
                var t = e.target;
                if (!t || !t.id) return;
                for (var i = 0; i < CFG.length; i++) {
                    if (CFG[i].id === t.id) {
                        if (e.type === 'paste' && ST[t.id]) ST[t.id].dismissed = '';
                        (function (c) { setTimeout(function () { _check(c); }, e.type === 'paste' ? 30 : 0); })(CFG[i]);
                        return;
                    }
                }
            }
            document.addEventListener('input', _onEvt, true);
            document.addEventListener('paste', _onEvt, true);
            /* the composers clear their value from code after Send (no input event) — notice that and drop the strip */
            setInterval(function () {
                for (var i = 0; i < CFG.length; i++) {
                    if (_stripEl(CFG[i].id)) { try { _check(CFG[i]); } catch (e) {} }
                }
            }, 500);
        })();

        var SELS = '#v13-grp-body .v13-grp-msg-text, #oc-messages-body .oc-bubble p';
        function _scanAll() {
            var list = document.querySelectorAll(SELS);
            for (var i = 0; i < list.length; i++) { try { _processText(list[i]); } catch (e) {} }
        }
        var _t11 = null;
        function _sched() { if (_t11) return; _t11 = setTimeout(function () { _t11 = null; _scanAll(); }, 150); }
        function _start11() {
            if (!document.body) return;
            new MutationObserver(_sched).observe(document.body, { childList: true, subtree: true });
            _scanAll();
        }
        if (document.body) _start11(); else document.addEventListener('DOMContentLoaded', _start11);
        document.addEventListener('empyrean-init-done', function () { setTimeout(_scanAll, 700); });
    })();

    console.log('[ELP v2] Link preview — Empyrean internal + external OGP active.');

})();