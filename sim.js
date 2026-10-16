// A live S3-FIFO cache on the landing page.
//
// The rules follow libCacheSim's S3FIFO.c and the SOSP '23 paper:
//   - a miss inserts into the small queue S, or straight into the main queue M
//     when the key is still in the ghost queue G;
//   - a hit only bumps a counter, capped at 3 (two bits);
//   - when S is full, its tail moves to M if it was hit at least twice
//     (move-to-main-threshold=2), otherwise it is evicted and its key goes to G;
//   - when M is full, its tail is reinserted with counter - 1 if it was hit,
//     otherwise evicted;
//   - G holds as many keys as M and forgets them in FIFO order.
// The queues are drawn far smaller than real ones, and S is larger than its
// usual 10% of the cache, so every move stays easy to follow.

(function () {
  'use strict';

  var PROMOTE_HITS = 2;
  var MAX_FREQ = 3;

  function Cache(sCap, mCap, gCap) {
    this.sCap = sCap;
    this.mCap = mCap;
    this.gCap = gCap;
    this.reset();
  }

  Cache.prototype.reset = function () {
    this.S = [];        // index 0 is the head (newest), the last is the tail
    this.M = [];
    this.G = [];
    this.freq = {};
    this.hits = 0;
    this.misses = 0;
  };

  Cache.prototype.where = function (key) {
    if (this.S.indexOf(key) >= 0) return 'S';
    if (this.M.indexOf(key) >= 0) return 'M';
    if (this.G.indexOf(key) >= 0) return 'G';
    return null;
  };

  // Serves one request and returns what happened, in order
  Cache.prototype.request = function (key) {
    var log = [];
    var q = this.where(key);
    if (q === 'S' || q === 'M') {
      this.hits++;
      var before = this.freq[key];
      this.freq[key] = Math.min(before + 1, MAX_FREQ);
      log.push({ kind: 'hit', key: key, q: q, freq: this.freq[key], capped: before === MAX_FREQ });
      return log;
    }
    this.misses++;
    if (q === 'G') {
      this.G.splice(this.G.indexOf(key), 1);
      log.push({ kind: 'ghost-hit', key: key });
      this.insertM(key, log);
    } else {
      log.push({ kind: 'miss', key: key });
      while (this.S.length >= this.sCap) this.evictS(log);
      this.S.unshift(key);
      this.freq[key] = 0;
    }
    return log;
  };

  Cache.prototype.insertM = function (key, log) {
    while (this.M.length >= this.mCap) this.evictM(log);
    this.M.unshift(key);
    this.freq[key] = 0;
  };

  Cache.prototype.evictS = function (log) {
    var t = this.S.pop();
    var hits = this.freq[t];
    if (hits >= PROMOTE_HITS) {
      log.push({ kind: 'promote', key: t, hits: hits });
      this.insertM(t, log);       // its counter is cleared on the move
      return;
    }
    log.push({ kind: 'demote', key: t, hits: hits });
    delete this.freq[t];
    this.G.unshift(t);
    if (this.G.length > this.gCap) log.push({ kind: 'ghost-drop', key: this.G.pop() });
  };

  Cache.prototype.evictM = function (log) {
    for (;;) {
      var t = this.M.pop();
      if (this.freq[t] >= 1) {
        this.freq[t] = Math.min(this.freq[t], MAX_FREQ) - 1;
        this.M.unshift(t);
        log.push({ kind: 'reinsert', key: t, freq: this.freq[t] });
      } else {
        delete this.freq[t];
        log.push({ kind: 'evict', key: t });
        return;
      }
    }
  };

  // The opening requests walk through every rule once: A is promoted after
  // two hits, B is demoted unhit and comes back through G, D is demoted after
  // a single hit, and the last request makes a full M reinsert A and evict B.
  // After that a seeded stream mixes a few popular keys, some that return now
  // and then, and a steady flow of keys that are requested once.
  var INTRO = ['A', 'B', 'A', 'C', 'A', 'D', 'E', 'B', 'A', 'F', 'C',
    'D', 'H', 'D', 'E', 'E', 'J', 'K', 'F', 'L', 'H'];
  var HOT = ['A', 'B', 'C', 'D'];
  var HOT_W = [0.35, 0.25, 0.22, 0.18];
  var WARM = ['E', 'F', 'H', 'J', 'K'];
  var COLD = ['L', 'N', 'P', 'Q', 'R', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

  function Stream(seed) {
    this.seed = seed;
    this.reset();
  }
  Stream.prototype.reset = function () {
    this.i = 0;
    this.cold = 0;
    this.s = this.seed >>> 0;
  };
  Stream.prototype.rand = function () {   // mulberry32
    var t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Stream.prototype.next = function () {
    if (this.i < INTRO.length) return INTRO[this.i++];
    this.i++;
    var r = this.rand();
    if (r < 0.5) {
      var u = this.rand(), acc = 0;
      for (var k = 0; k < HOT.length; k++) { acc += HOT_W[k]; if (u < acc) return HOT[k]; }
      return HOT[HOT.length - 1];
    }
    if (r < 0.72) return WARM[Math.floor(this.rand() * WARM.length)];
    return COLD[this.cold++ % COLD.length];
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = { Cache: Cache, Stream: Stream, PROMOTE_HITS: PROMOTE_HITS };
  }
  if (typeof document === 'undefined') return;

  /* ---------------- drawing ---------------- */

  var root = document.getElementById('sim');
  if (!root) return;

  var S_CAP = 3, M_CAP = 6, G_CAP = 6;
  var STEP_MS = 2000;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DUR = reduce ? 0 : 650;

  var cache = new Cache(S_CAP, M_CAP, G_CAP);
  var stream = new Stream(20231023);
  var upcoming = [];

  var stage = root.querySelector('.sim-stage');
  var layer = root.querySelector('.sim-tokens');
  var nextList = root.querySelector('.sim-next');
  var logList = root.querySelector('.sim-log');
  var playBtn = root.querySelector('[data-act="play"]');
  var stepBtn = root.querySelector('[data-act="step"]');
  var resetBtn = root.querySelector('[data-act="reset"]');
  var stat = {};
  root.querySelectorAll('[data-stat]').forEach(function (el) { stat[el.getAttribute('data-stat')] = el; });

  var slots = {};
  ['S', 'M', 'G'].forEach(function (q) {
    var box = root.querySelector('.sim-slots[data-q="' + q + '"]');
    var n = q === 'S' ? S_CAP : q === 'M' ? M_CAP : G_CAP;
    box.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var s = document.createElement('span');
      s.className = 'sim-slot';
      box.appendChild(s);
    }
    slots[q] = box.children;
  });

  var tokens = {};     // key -> element, for keys in S, M or G

  function makeToken(key) {
    var el = document.createElement('div');
    el.className = 'sim-tok';
    el.innerHTML = '<span class="sim-key">' + key + '</span><span class="sim-pips"><i></i><i></i><i></i></span>';
    layer.appendChild(el);
    tokens[key] = el;
    return el;
  }

  // Centre of slot i of queue q, relative to the stage
  function spot(q, i) {
    var base = stage.getBoundingClientRect();
    var r = slots[q][i].getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, w: r.width };
  }

  function place(el, p) {
    el.style.width = el.style.height = p.w + 'px';
    el.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
    el._p = p;
  }

  function move(el, from, to, lift) {
    place(el, to);
    if (!DUR || !from) return;
    var frames = [{ transform: 'translate(' + from.x + 'px,' + from.y + 'px)' }];
    if (lift) {
      frames.push({ transform: 'translate(' + (from.x + to.x) / 2 + 'px,' + (Math.min(from.y, to.y) - lift) + 'px)', offset: 0.5 });
    }
    frames.push({ transform: 'translate(' + to.x + 'px,' + to.y + 'px)' });
    el.animate(frames, { duration: DUR, easing: 'cubic-bezier(.4,0,.2,1)' });
  }

  function leave(key, dx) {
    var el = tokens[key], p = el._p;
    delete tokens[key];
    if (!DUR) { el.remove(); return; }
    el.animate([
      { transform: 'translate(' + p.x + 'px,' + p.y + 'px)', opacity: 1 },
      { transform: 'translate(' + (p.x + dx) + 'px,' + p.y + 'px) scale(.6)', opacity: 0 }
    ], { duration: DUR, easing: 'ease-in' }).onfinish = function () { el.remove(); };
    el.style.opacity = 0;
  }

  function paint(el, q, key) {
    el.setAttribute('data-q', q);
    var f = q === 'G' ? 0 : cache.freq[key] || 0;
    var pips = el.querySelectorAll('.sim-pips i');
    for (var i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < f);
    el.title = key + (q === 'G' ? ': key only, in the ghost queue' : ': counter ' + f);
  }

  // Moves every token to where the cache now holds it
  function layout(animate, log) {
    var lifted = {}, gone = {};
    (log || []).forEach(function (e) {
      if (e.kind === 'reinsert' || e.kind === 'demote') lifted[e.key] = true;
      if (e.kind === 'evict' || e.kind === 'ghost-drop') gone[e.key] = true;
    });
    var seen = {};
    ['S', 'M', 'G'].forEach(function (q) {
      cache[q].forEach(function (key, i) {
        seen[key] = true;
        var el = tokens[key];
        var to = spot(q, i);
        if (!el) {
          el = makeToken(key);
          paint(el, q, key);
          var from = { x: to.x - to.w * 1.1, y: to.y, w: to.w };
          place(el, to);
          if (animate && DUR) {
            el.animate([
              { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(.6)', opacity: 0 },
              { transform: 'translate(' + to.x + 'px,' + to.y + 'px)', opacity: 1 }
            ], { duration: DUR, easing: 'cubic-bezier(.2,0,.2,1)' });
          }
          return;
        }
        paint(el, q, key);
        if (animate) move(el, el._p, to, lifted[key] ? to.w * 0.9 : 0);
        else place(el, to);
      });
    });
    Object.keys(tokens).forEach(function (key) {
      if (!seen[key]) leave(key, (gone[key] ? 1 : 0.5) * (tokens[key]._p.w * 1.2));
    });
  }

  function pulse(key) {
    var el = tokens[key];
    if (!el || !DUR) return;
    el.animate([{ scale: 1 }, { scale: 1.22 }, { scale: 1 }], { duration: 420, easing: 'ease-out' });
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  function times(n) { return n === 0 ? 'never hit' : n === 1 ? 'hit once' : n === 2 ? 'hit twice' : 'hit ' + n + ' times'; }
  function chip(key) { return '<b class="sim-k">' + key + '</b>'; }
  function and(keys) {
    var b = keys.map(chip);
    return b.length === 1 ? b[0] : b.slice(0, -1).join(', ') + ' and ' + b[b.length - 1];
  }

  // At most three lines per request: what the request found, what S did to
  // make room, and what M did to make room
  function narrate(log) {
    var first = log[0], k = chip(first.key), lines = [];
    if (first.kind === 'hit') {
      lines.push(['hit', k + ' is in ' + first.q + ': <em>hit</em>. ' +
        (first.capped ? 'Its counter stays at the cap of 3.' : 'Its counter goes up to ' + first.freq + '.')]);
    } else if (first.kind === 'ghost-hit') {
      lines.push(['ghost-hit', k + ' is not cached, but its key is in G: <em>miss</em>. It goes straight into M.']);
    } else {
      lines.push(['miss', k + ' is not cached: <em>miss</em>. It enters S.']);
    }
    var fromS = null, drop = null, again = [], out = null;
    log.forEach(function (e) {
      if (e.kind === 'promote' || e.kind === 'demote') fromS = e;
      else if (e.kind === 'ghost-drop') drop = e;
      else if (e.kind === 'reinsert') again.push(e.key);
      else if (e.kind === 'evict') out = e;
    });
    if (fromS) {
      lines.push([fromS.kind, 'S is full: its oldest object, ' + chip(fromS.key) + ', was ' + times(fromS.hits) +
        (fromS.kind === 'promote' ? ', so it moves to M.' : ', so it is evicted and only its key goes to G.') +
        (drop ? ' G forgets its oldest key, ' + chip(drop.key) + '.' : '')]);
    }
    if (out) {
      lines.push(['evict', 'M is full: ' + (again.length
        ? and(again) + (again.length > 1 ? ' were reused and go' : ' was reused and goes') + ' around again; ' +
          chip(out.key) + ' was not, so it is evicted.'
        : 'its oldest object, ' + chip(out.key) + ', was not reused, so it is evicted.')]);
    }
    return lines;
  }

  // Keep the text box from shrinking and growing under the page as it runs
  var logHeight = 0;
  function showLog(lines) {
    logList.innerHTML = lines.map(function (l) { return '<li data-kind="' + l[0] + '">' + l[1] + '</li>'; }).join('');
    var h = logList.offsetHeight;
    if (h > logHeight) { logHeight = h; logList.style.minHeight = h + 'px'; }
  }

  function fillUpcoming() {
    while (upcoming.length < 8) upcoming.push(stream.next());
    nextList.innerHTML = upcoming.map(function (k, i) {
      var q = cache.where(k);
      var cls = i === 0 ? ' class="now"' : '';
      return '<li' + cls + ' data-q="' + (q || '') + '">' + k + '</li>';
    }).join('');
  }

  function showStats() {
    var n = cache.hits + cache.misses;
    stat.hits.textContent = cache.hits;
    stat.misses.textContent = cache.misses;
    stat.ratio.textContent = n ? Math.round(100 * cache.misses / n) + '%' : '–';
  }

  function step() {
    var key = upcoming.shift();
    var log = cache.request(key);
    layout(true, log);
    if (log[0].kind === 'hit') pulse(key);
    showLog(narrate(log));
    fillUpcoming();
    showStats();
  }

  function restart() {
    cache.reset();
    stream.reset();
    upcoming = [];
    Object.keys(tokens).forEach(function (k) { tokens[k].remove(); });
    tokens = {};
    showLog([['', 'Requests arrive in the order shown above. Each one is a hit, a miss, or a miss on a key that G still remembers.']]);
    fillUpcoming();
    showStats();
  }

  /* autoplay: only while the simulation is on screen */
  var playing = !reduce, visible = false, timer = null;

  function sync() {
    var run = playing && visible && !document.hidden;
    if (run && !timer) timer = setInterval(step, STEP_MS);
    if (!run && timer) { clearInterval(timer); timer = null; }
    playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playBtn.querySelector('.sim-play-label').textContent = playing ? 'Pause' : 'Play';
    root.classList.toggle('is-playing', playing);
    // Read each step aloud only when someone is stepping through by hand
    logList.setAttribute('aria-live', playing ? 'off' : 'polite');
  }

  playBtn.addEventListener('click', function () { playing = !playing; sync(); });
  stepBtn.addEventListener('click', function () { playing = false; sync(); step(); });
  resetBtn.addEventListener('click', function () { restart(); sync(); });
  document.addEventListener('visibilitychange', sync);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      sync();
    }, { threshold: 0.35 }).observe(stage);
  } else {
    visible = true;
  }

  var raf = 0;
  window.addEventListener('resize', function () {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      layout(false);
      logHeight = 0;
      logList.style.minHeight = '';
    });
  });

  restart();
  sync();
})();
