// California Drive: marketing site behaviour. Every "Play" button deep-links into the game on GitHub Pages.
(function () {
  'use strict';
  var GAME = 'https://roszhan2684.github.io/california-drive/';
  var REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var CD = window.CD;

  function gameUrl(city, time, weather) {
    if (!city) return GAME;
    var q = 'city=' + encodeURIComponent(city) + '&time=' + encodeURIComponent(time);
    if (weather) q += '&weather=' + encodeURIComponent(weather);
    return GAME + '?' + q;
  }
  $$('[data-play]').forEach(function (a) { a.href = GAME; });

  // ---- device check: the game needs WebGL2 and a keyboard or gamepad
  (function () {
    var d = $('[data-device]');
    var gl = null;
    try { gl = document.createElement('canvas').getContext('webgl2'); } catch (e) { /* no-op */ }
    var touchOnly = matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (!gl) { d.textContent = 'Your browser has no WebGL2. Try a recent Chrome, Edge, Firefox or Safari on a computer.'; d.classList.add('warn'); }
    else if (touchOnly) { d.textContent = 'Touch controls are coming. For now, play on a laptop or desktop.'; d.classList.add('warn'); }
  })();

  // ---- nav goes solid after the hero
  var nav = $('[data-nav]');
  var onScroll = function () { nav.classList.toggle('solid', scrollY > 40); };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---- hero slideshow + HUD readout + boot log
  var HERO = [
    { place: 'SAN FRANCISCO · EMBARCADERO', heading: 'NW · 312°', speed: 38 },
    { place: 'LOS ANGELES · BUNKER HILL', heading: 'NE · 39°', speed: 46 },
    { place: 'LAKE TAHOE · HIGHWAY 89', heading: 'S · 184°', speed: 29 },
    { place: 'SANTA MONICA · THE PIER', heading: 'SW · 226°', speed: 12 },
    { place: 'YOSEMITE · NORTHSIDE DRIVE', heading: 'E · 92°', speed: 34 },
  ];
  var slides = $$('[data-slides] img');
  var si = 0, shown = 0;
  var speedEl = $('[data-speed]'), gauge = $('.gauge');
  function showSlide(i) {
    slides.forEach(function (s, k) { s.classList.toggle('on', k === i); });
    $('[data-place]').textContent = HERO[i].place;
    $('[data-compass]').textContent = HERO[i].heading;
    var from = shown, to = HERO[i].speed, t0 = performance.now();
    (function tick(now) {
      var k = Math.min(1, (now - t0) / 1200);
      var e = 1 - Math.pow(1 - k, 3) * Math.cos(k * 4.2) * (1 - k); // overshoot-and-settle, like a needle
      shown = Math.round(from + (to - from) * Math.min(1.08, e));
      speedEl.textContent = shown;
      gauge.style.setProperty('--rpm', (18 + shown * 0.9) + '%');
      if (k < 1) requestAnimationFrame(tick); else { shown = to; speedEl.textContent = to; }
    })(t0);
  }
  showSlide(0);
  if (!REDUCE) setInterval(function () { si = (si + 1) % slides.length; showSlide(si); }, 6000);

  (function bootLog() {
    var el = $('[data-syslog]');
    var lines = ['SYS.BOOT  CALIFORNIA DRIVE', 'MAP  OPENSTREETMAP · 9 DISTRICTS', 'VEH  VIREO S6 · FLAT-SIX · RWD', 'NAV  ONLINE  ·  RADAR SWEEP OK'];
    if (REDUCE) { el.textContent = lines.join('\n'); return; }
    var li = 0, ci = 0, out = '';
    (function type() {
      if (li >= lines.length) return;
      out += lines[li][ci++];
      if (ci >= lines[li].length) { li++; ci = 0; if (li < lines.length) out += '\n'; }
      el.textContent = out + (li < lines.length ? '▌' : '');
      setTimeout(type, ci === 0 ? 180 : 18);
    })();
  })();

  // ---- counters
  var counted = false;
  function countUp() {
    if (counted) return;
    counted = true;
    $$('[data-count]').forEach(function (b) {
      var to = +b.dataset.count, t0 = performance.now();
      (function tick(now) {
        var k = Math.min(1, (now - t0) / 1100);
        b.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(tick);
      })(t0);
    });
  }

  // ---- California map + city card
  var SHOT = { sf: 'media/sf-golden.jpg', la: 'media/la-night.jpg', sd: 'media/sd-golden.jpg', sj: 'media/sj-night.jpg', oak: 'media/oak-dusk.jpg', sac: 'media/sac-golden.jpg', smc: 'media/smc-wheel-golden.jpg', tahoe: 'media/tahoe-snow.jpg', yosemite: 'media/yosemite-golden.jpg' };
  var TIMES = ['dawn', 'day', 'golden', 'dusk', 'night'];
  var LABEL = { dawn: 'Dawn', day: 'Day', golden: 'Golden hour', dusk: 'Dusk', night: 'Night' };
  var svg = $('[data-map]');
  var NS = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', '0 0 ' + CD.map.w + ' ' + CD.map.h);
  var grid = '';
  for (var gx = 0; gx <= CD.map.w; gx += 40) grid += '<path class="grid" d="M' + gx + ' 0V' + CD.map.h + '"/>';
  for (var gy = 0; gy <= CD.map.h; gy += 40) grid += '<path class="grid" d="M0 ' + gy + 'H' + CD.map.w + '"/>';
  svg.innerHTML = '<defs><linearGradient id="caFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d2733"/><stop offset="1" stop-color="#2a1f1a"/></linearGradient></defs>' + grid +
    '<path class="shape" d="' + CD.map.path + '"/>';
  // a dashed "road trip" through the cities, north to south
  var trip = CD.cities.slice().sort(function (a, b) { return a.y - b.y; });
  var route = document.createElementNS(NS, 'path');
  route.setAttribute('class', 'route');
  route.setAttribute('d', 'M' + trip.map(function (c) { return c.x + ' ' + c.y; }).join(' L'));
  svg.appendChild(route);
  var pins = {};
  // hand-placed labels: Bay Area and LA-area pins sit a few pixels apart at state scale
  var LBL = { sf: [-14, 16, 'end'], oak: [12, -10, 'start'], sj: [-14, 18, 'end'], sac: [-14, 5, 'end'], la: [14, -6, 'start'], smc: [-14, 18, 'end'], sd: [-14, 5, 'end'], tahoe: [14, 5, 'start'], yosemite: [14, 5, 'start'] };
  CD.cities.forEach(function (c) {
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'pin');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', c.name + ', ' + c.district);
    var l = LBL[c.id] || [14, 5, 'start'];
    g.innerHTML = '<circle class="halo" cx="' + c.x + '" cy="' + c.y + '" r="9"/><circle class="dot" cx="' + c.x + '" cy="' + c.y + '" r="7"/>' +
      '<text x="' + (c.x + l[0]) + '" y="' + (c.y + l[1]) + '" text-anchor="' + l[2] + '">' + c.name + '</text>';
    g.addEventListener('click', function () { select(c.id); });
    g.addEventListener('mouseenter', function () { select(c.id); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.id); } });
    svg.appendChild(g);
    pins[c.id] = g;
  });
  var cur = null, curTime = null;
  function renderTimes(c) {
    var box = $('[data-times]');
    box.innerHTML = '';
    TIMES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = LABEL[t];
      b.setAttribute('aria-pressed', String(t === curTime));
      b.addEventListener('click', function () { curTime = t; renderTimes(c); updateGo(c); });
      box.appendChild(b);
    });
  }
  function updateGo(c) {
    var go = $('[data-city-go]');
    go.href = gameUrl(c.id, curTime, curTime === c.time ? c.weather : null);
    go.textContent = 'Drive ' + c.name + ' · ' + LABEL[curTime] + ' →';
  }
  function select(id) {
    if (id === cur) return;
    var c = CD.cities.filter(function (x) { return x.id === id; })[0];
    cur = id;
    curTime = c.time;
    Object.keys(pins).forEach(function (k) { pins[k].classList.toggle('on', k === id); });
    $('[data-city-img]').style.backgroundImage = 'url(' + SHOT[id] + ')';
    $('[data-city-district]').textContent = c.district;
    $('[data-city-name]').textContent = c.name;
    $('[data-city-mood]').textContent = c.mood;
    renderTimes(c);
    updateGo(c);
  }
  select('sf');

  // ---- gallery + lightbox
  var GALLERY = [
    ['sf-golden', 'San Francisco · golden hour, Karl the Fog'],
    ['la-night', 'Los Angeles · downtown at night'],
    ['smc-wheel-night', 'Santa Monica · pier Ferris wheel'],
    ['tahoe-snow', 'Lake Tahoe · Highway 89 in snow'],
    ['yosemite-golden', 'Yosemite Valley · golden hour'],
    ['sd-golden', 'San Diego · golden hour'],
    ['sf-rain-night', 'San Francisco · rain at night'],
    ['la-day', 'Los Angeles · traffic on Hill Street'],
    ['hud-cockpit-night', 'Hood camera at night · live gauges'],
    ['debris', 'Crash debris'],
    ['select', 'City select · 3D California relief'],
    ['hud-lock', 'HUD · radar and target lock'],
  ];
  var gbox = $('[data-gallery]');
  GALLERY.forEach(function (g) {
    var b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<img src="media/' + g[0] + '.jpg" alt="' + g[1] + '" loading="lazy"/><span>' + g[1] + '</span>';
    b.addEventListener('click', function () { openLb('media/' + g[0] + '.jpg', g[1], b); });
    gbox.appendChild(b);
  });
  var lb = $('[data-lightbox]'), lastFocus = null;
  function openLb(src, cap, from) {
    lastFocus = from;
    $('[data-lb-img]').src = src;
    $('[data-lb-img]').alt = cap;
    $('[data-lb-cap]').textContent = cap;
    lb.hidden = false;
    $('[data-lb-close]').focus();
  }
  function closeLb() { lb.hidden = true; if (lastFocus) lastFocus.focus(); }
  $('[data-lb-close]').addEventListener('click', closeLb);
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lb.hidden) closeLb(); });

  // ---- scroll reveals
  var targets = $$('.sec-head, .feature, .stats, .city-card, .grid button, .keys li, .credits div, .final div');
  targets.forEach(function (t) { t.classList.add('reveal'); });
  if ('IntersectionObserver' in window && !REDUCE) {
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        if (e.target.classList.contains('stats')) countUp();
        io.unobserve(e.target);
      });
    }, { threshold: 0.15 });
    targets.forEach(function (t) { io.observe(t); });
  } else {
    targets.forEach(function (t) { t.classList.add('in'); });
    countUp();
  }
})();
