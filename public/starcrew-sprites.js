/*!
 * Starcrew Sprites — procedural pixel-art characters for the Starcrew web app.
 * Every frame is drawn in code on a 48×48 grid with a 1px ink outline, so
 * characters stay crisp at any integer scale and can be recolored easily.
 *
 * Usage (browser):
 *   <script src="starcrew-sprites.js"></script>
 *   Starcrew.draw(ctx, 'ribbit', 'walk', 'left', frameIndex, x, y, scale);
 *   const anim = Starcrew.anim('ribbit', 'walk');   // { frames, fps, loop, dirs }
 *   const sheet = Starcrew.sheet('ribbit');          // { canvas, atlas }
 */
(function (global) {
  'use strict';

  const S = 48;              // frame size in px
  const OUT = '#1b1432';     // ink outline
  const GLASS = 'rgba(160,220,255,0.34)';
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /* ------------------------------------------------------------------ */
  /* Pixel layers + primitives                                          */
  /* ------------------------------------------------------------------ */
  class Layer {
    constructor() { this.p = new Array(S * S).fill(null); }
    set(x, y, c) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= S || y >= S) return;
      this.p[y * S + x] = c;
    }
    flip() {
      const n = new Array(S * S).fill(null);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) n[y * S + (S - 1 - x)] = this.p[y * S + x];
      this.p = n;
    }
  }

  const rectPx = (x, y, w, h) => {
    const a = []; x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a.push([x + i, y + j]);
    return a;
  };
  const roundPx = (x, y, w, h) => rectPx(x, y, w, h).filter(([px, py]) => {
    const l = px === Math.round(x), r = px === Math.round(x) + Math.round(w) - 1;
    const t = py === Math.round(y), b = py === Math.round(y) + Math.round(h) - 1;
    return !((l || r) && (t || b));
  });
  const ellPx = (cx, cy, rx, ry) => {
    const a = [];
    for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++)
      for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) a.push([x, y]);
      }
    return a;
  };
  const linePx = (x0, y0, x1, y1) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const a = []; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
    for (;;) {
      a.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return a;
  };
  const union = (...lists) => {
    const seen = new Set(), out = [];
    for (const l of lists) for (const p of l) {
      const k = p[1] * 1000 + p[0];
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    }
    return out;
  };

  // Painter: "O" variants stamp a 1px ink outline around the shape first,
  // which also carves clean separation lines between overlapping parts.
  function painter(L) {
    const paint = (px, c, outline) => {
      if (outline) {
        const own = new Set(px.map(([x, y]) => y * 1000 + x));
        for (const [x, y] of px) for (const [dx, dy] of N4) {
          if (!own.has((y + dy) * 1000 + x + dx)) L.set(x + dx, y + dy, OUT);
        }
      }
      for (const [x, y] of px) L.set(x, y, c);
    };
    return {
      L,
      o: (px, c) => paint(px, c, true),
      f: (px, c) => paint(px, c, false),
      r: (x, y, w, h, c) => paint(rectPx(x, y, w, h), c, false),
      R: (x, y, w, h, c) => paint(rectPx(x, y, w, h), c, true),
      p: (x, y, c) => L.set(x, y, c),
      // symmetric pair about the vertical axis cx (cx may be n or n+0.5)
      sym(cx, xl, y, w, h, c) {
        paint(rectPx(xl, y, w, h), c, false);
        paint(rectPx(Math.round(2 * cx + 1 - xl - w), y, w, h), c, false);
      },
      // shade the part of a pixel list that matches a predicate
      shade(px, pred, c) { for (const [x, y] of px) if (pred(x, y)) L.set(x, y, c); },
    };
  }

  /* ------------------------------------------------------------------ */
  /* FX glyphs (Zzz, music notes, sweat, sparkles…)                     */
  /* ------------------------------------------------------------------ */
  const GLYPHS = {
    Z: ['####', '..#.', '.#..', '####'],
    z: ['###', '.#.', '###'],
    note: ['.###', '.#.#', '.#.#', '##.#', '##..'],
    note2: ['..#', '..##', '..#.', '##..', '##..'],
    drop: ['.#.', '###', '###', '.#.'],
    spark: ['.#.', '###', '.#.'],
    spark2: ['#.#', '.#.', '#.#'],
    bang: ['#', '#', '#', '.', '#'],
    heart: ['##.##', '#####', '.###.', '..#..'],
    steam: ['.#', '#.', '.#'],
    dot: ['#'],
  };
  function glyph(d, name, x, y, c, outline = true) {
    const g = GLYPHS[name]; const px = [];
    g.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') px.push([Math.round(x) + i, Math.round(y) + j]); }));
    outline ? d.o(px, c) : d.f(px, c);
  }

  /* ------------------------------------------------------------------ */
  /* Species heads (front / side-facing-right / back)                   */
  /* f = { eyes: open|half|closed|happy, mouth: smile|open|yawn|flat }  */
  /* ------------------------------------------------------------------ */
  function eyePair(d, cx, xl, y, w, h, f, col, lidCol) {
    switch (f.eyes) {
      case 'closed': d.sym(cx, xl, y + h - 1, w, 1, OUT); break;
      case 'happy':
        d.sym(cx, xl, y + 1, 1, 1, OUT); d.sym(cx, xl + 1, y, Math.max(1, w - 2), 1, OUT);
        d.sym(cx, xl + w - 1, y + 1, 1, 1, OUT); break;
      case 'half':
        d.sym(cx, xl, y + 1, w, h - 1, col); d.sym(cx, xl, y, w, 1, lidCol || OUT); break;
      default:
        d.sym(cx, xl, y, w, h, col);
        if (w >= 2 && h >= 2) d.p(xl, y, '#ffffff'), d.p(Math.round(2 * cx + 1 - xl - w), y, '#ffffff');
    }
  }
  function eyeOne(d, x, y, w, h, f, col, lidCol) {
    switch (f.eyes) {
      case 'closed': d.r(x, y + h - 1, w, 1, OUT); break;
      case 'happy': d.p(x, y + 1, OUT); d.r(x + 1, y, Math.max(1, w - 1), 1, OUT); break;
      case 'half': d.r(x, y + 1, w, h - 1, col); d.r(x, y, w, 1, lidCol || OUT); break;
      default: d.r(x, y, w, h, col); if (w >= 2 && h >= 2) d.p(x + w - 1, y, '#ffffff');
    }
  }
  function mouthFront(d, cx, y, f, w, col = OUT, tongue = '#ff7a8a') {
    const xl = Math.round(cx + 0.5 - w / 2);
    switch (f.mouth) {
      case 'open': d.r(xl + 1, y, w - 2, 2, col); d.r(xl + 2, y + 1, Math.max(1, w - 4), 1, tongue); break;
      case 'yawn': d.r(xl + 1, y - 1, w - 2, 3, col); d.r(xl + 2, y + 1, Math.max(1, w - 4), 1, tongue); break;
      case 'flat': d.r(xl + 1, y, w - 2, 1, col); break;
      default: d.r(xl + 1, y, w - 2, 1, col); d.sym(cx, xl, y - 1, 1, 1, col);
    }
  }
  function mouthSide(d, x, y, f, w, col = OUT, tongue = '#ff7a8a') {
    switch (f.mouth) {
      case 'open': d.r(x + 1, y, w - 1, 2, col); d.r(x + 2, y + 1, Math.max(1, w - 3), 1, tongue); break;
      case 'yawn': d.r(x + 1, y - 1, w - 1, 3, col); d.r(x + 2, y + 1, Math.max(1, w - 3), 1, tongue); break;
      case 'flat': d.r(x + 1, y, w - 1, 1, col); break;
      default: d.r(x + 1, y, w - 1, 1, col); d.p(x, y - 1, col);
    }
  }

  const HEADS = {
    frog(d, view, hx, hy, f) {
      const G = '#62d36a', GS = '#3f9f4d', GL = '#b9f08e', CHEEK = '#ff8fa3';
      if (view === 'front') {
        const px = union(ellPx(hx, hy + 2, 8, 6), ellPx(hx - 4.5, hy - 3, 3.2, 3), ellPx(hx + 4.5, hy - 3, 3.2, 3));
        d.o(px, G);
        d.shade(px, (x, y) => (y - hy - 2) / 6 > 0.62, GS);
        d.shade(px, (x, y) => y === hy + 6 && Math.abs(x - hx) < 3, GL);
        if (f.eyes === 'open' || f.eyes === 'half') {
          d.sym(hx, 18, hy - (f.eyes === 'half' ? 3 : 4), 3, f.eyes === 'half' ? 2 : 3, '#ffffff');
          d.sym(hx, 19, hy - 3, 2, 2, OUT);
          d.p(19, hy - 3, '#ffffff'); d.p(Math.round(2 * hx + 1 - 19 - 1), hy - 3, '#ffffff');
          if (f.eyes === 'half') d.sym(hx, 18, hy - 4, 3, 1, GS);
        } else eyePair(d, hx, 18, hy - 4, 3, 3, f, OUT);
        mouthFront(d, hx, hy + 4, f, 10);
        d.sym(hx, 16, hy + 2, 2, 1, CHEEK);
      } else if (view === 'side') {
        const px = union(ellPx(hx + 1, hy + 2, 8, 6), ellPx(hx + 3, hy - 3, 3.2, 3), ellPx(hx - 3, hy - 3, 2.6, 2.6));
        d.o(px, G);
        d.shade(px, (x, y) => (y - hy - 2) / 6 > 0.62 || (x < hx - 1 && y < hy - 1), GS);
        if (f.eyes === 'open' || f.eyes === 'half') {
          d.r(hx + 2, hy - 4, 3, 3, '#ffffff'); d.r(hx + 3, hy - 3, 2, 2, OUT); d.p(hx + 4, hy - 3, '#ffffff');
          if (f.eyes === 'half') d.r(hx + 2, hy - 4, 3, 1, GS);
        } else eyeOne(d, hx + 2, hy - 4, 3, 3, f, OUT);
        mouthSide(d, hx + 2, hy + 4, f, 7);
        d.r(hx + 2, hy + 2, 2, 1, CHEEK);
      } else {
        const px = union(ellPx(hx, hy + 2, 8, 6), ellPx(hx - 4.5, hy - 3, 3.2, 3), ellPx(hx + 4.5, hy - 3, 3.2, 3));
        d.o(px, G);
        d.shade(px, (x, y) => (y - hy - 2) / 6 > 0.62, GS);
        d.r(hx - 3.5, hy + 1, 2, 1, GS); d.p(hx + 3, hy + 3, GS); d.r(hx, hy - 1, 2, 1, GS); d.p(hx - 1, hy + 4, GS);
      }
    },

    human(d, view, hx, hy, f) {
      const SK = '#c88a5a', SKS = '#a86c42', H = '#3a2230', HL = '#5e3a50', BL = '#ff9d9d', TIE = '#3fd0c9';
      if (view === 'front') {
        const hair = union(ellPx(hx, hy, 8, 7.5), ellPx(hx, hy - 8, 3, 2.4));
        d.o(hair, H); d.shade(hair, (x, y) => y < hy - 5 && x < hx, HL);
        d.r(hx - 1.5, hy - 6, 4, 1, TIE);
        const face = ellPx(hx, hy + 2, 6.5, 6);
        d.o(face, SK); d.shade(face, (x, y) => y > hy + 6, SKS);
        d.r(17.5 + (hx - 23.5), hy - 4, 13, 1, H);
        d.sym(hx, 17 + (hx - 23.5), hy - 3, 4, 1, H);
        eyePair(d, hx, 19 + (hx - 23.5), hy, 2, 2, f, OUT, SKS);
        d.sym(hx, 17 + (hx - 23.5), hy + 3, 2, 1, BL);
        mouthFront(d, hx, hy + 5, f, 6, '#7a3b3b');
      } else if (view === 'side') {
        const hair = union(ellPx(hx - 1, hy, 7.5, 7.5), ellPx(hx - 6, hy - 5, 3, 3));
        d.o(hair, H); d.shade(hair, (x, y) => y < hy - 4, HL);
        d.p(hx - 4, hy - 3, TIE); d.p(hx - 4, hy - 2, TIE);
        const face = ellPx(hx + 2, hy + 2, 5.5, 6);
        d.o(face, SK); d.shade(face, (x, y) => y > hy + 6, SKS);
        d.r(hx - 1, hy - 4, 9, 1, H); d.r(hx + 4, hy - 3, 4, 1, H);
        d.p(hx - 1, hy + 2, SKS);
        eyeOne(d, hx + 4, hy, 2, 2, f, OUT, SKS);
        d.r(hx + 4, hy + 3, 2, 1, BL);
        mouthSide(d, hx + 4, hy + 5, f, 3, '#7a3b3b');
      } else {
        const hair = union(ellPx(hx, hy + 1, 8, 7.5), ellPx(hx, hy - 7, 3, 2.4));
        d.o(hair, H); d.shade(hair, (x, y) => y < hy - 3 && x > hx, HL);
        d.r(hx - 1.5, hy - 5, 4, 1, TIE);
      }
    },

    cyclops(d, view, hx, hy, f, frame) {
      const P = '#a575ff', PS = '#7a4fd6', PL = '#cdb2ff', TIP = '#ffd23f';
      const wob = frame % 2 === 0 ? 0 : 1;
      if (view === 'front' || view === 'back') {
        d.o(union(linePx(hx - 3, hy - 6, hx - 6 - wob, hy - 12), linePx(hx + 3, hy - 6, hx + 6 + wob, hy - 12)), PS);
        d.o(union(ellPx(hx - 6 - wob, hy - 13, 1.6, 1.6), ellPx(hx + 6 + wob, hy - 13, 1.6, 1.6)), TIP);
        const head = ellPx(hx, hy + 1, 9, 8.5);
        d.o(head, P); d.shade(head, (x, y) => (y - hy - 1) / 8.5 > 0.6, PS);
        if (view === 'front') {
          d.p(hx - 6, hy - 3, PL); d.p(hx - 5, hy - 4, PL);
          d.r(hx - 7, hy + 3, 1, 1, PS); d.p(hx + 6, hy - 3, PS);
          if (f.eyes === 'open' || f.eyes === 'half') {
            const white = ellPx(hx, hy, 3.6, 3.6);
            d.f(white, '#ffffff');
            d.f(ellPx(hx, hy + 0.5, 2, 2), '#2fb8a6');
            d.r(hx - 0.5, hy, 2, 2, OUT); d.p(hx - 1, hy - 1, '#ffffff');
            if (f.eyes === 'half') d.f(white.filter(([, y]) => y <= hy - 1), PS);
          } else if (f.eyes === 'closed') d.r(hx - 2.5, hy + 1, 6, 1, OUT);
          else { d.r(hx - 1.5, hy - 1, 4, 1, OUT); d.p(hx - 3, hy, OUT); d.p(hx + 3, hy, OUT); }
          mouthFront(d, hx, hy + 6, f, 8);
          if (f.mouth === 'smile') d.p(hx + 1, hy + 7, '#ffffff');
        } else {
          d.p(hx - 4, hy - 2, PS); d.p(hx + 3, hy + 2, PS); d.r(hx - 1, hy + 4, 2, 1, PS);
        }
      } else {
        d.o(union(linePx(hx, hy - 6, hx - 3 - wob, hy - 12), linePx(hx + 3, hy - 6, hx + 3, hy - 12)), PS);
        d.o(union(ellPx(hx - 3 - wob, hy - 13, 1.6, 1.6), ellPx(hx + 3, hy - 13, 1.6, 1.6)), TIP);
        const head = ellPx(hx + 1, hy + 1, 9, 8.5);
        d.o(head, P); d.shade(head, (x, y) => (y - hy - 1) / 8.5 > 0.6 || x < hx - 5, PS);
        if (f.eyes === 'open' || f.eyes === 'half') {
          d.f(ellPx(hx + 5, hy, 2.6, 3.4), '#ffffff');
          d.r(hx + 6, hy, 2, 2, OUT); d.p(hx + 6, hy - 1, '#ffffff');
          if (f.eyes === 'half') d.r(hx + 3, hy - 3, 5, 2, PS);
        } else eyeOne(d, hx + 3, hy, 4, 2, f, OUT);
        mouthSide(d, hx + 4, hy + 6, f, 5);
      }
    },

    grey(d, view, hx, hy, f) {
      const C = '#b9e0c0', CS = '#88bd95', GL = '#7ef2ff';
      if (view === 'front') {
        const head = union(ellPx(hx, hy - 1, 8, 6.5), ellPx(hx, hy + 3, 5, 5));
        d.o(head, C); d.shade(head, (x, y) => y > hy + 5 || (x > hx + 5 && y > hy), CS);
        const xo = hx - 23.5;
        if (f.eyes === 'open' || f.eyes === 'half') {
          const L = [[17, 0], [18, 0], [19, 0], [17, 1], [18, 1], [19, 1], [20, 1], [18, 2], [19, 2], [20, 2]]
            .filter(([, j]) => f.eyes !== 'half' || j > 0);
          for (const [x, j] of L) { d.p(x + xo, hy + j, OUT); d.p(Math.round(2 * hx + 1 - (x + xo) - 1), hy + j, OUT); }
          d.p(18 + xo, hy + 1, GL); d.p(Math.round(2 * hx - 18 - xo), hy + 1, GL);
        } else eyePair(d, hx, 17 + xo, hy, 4, 3, f, OUT);
        mouthFront(d, hx, hy + 6, f, 4);
      } else if (view === 'side') {
        const head = union(ellPx(hx + 1, hy - 1, 8, 6.5), ellPx(hx + 3, hy + 3, 4.5, 4.5));
        d.o(head, C); d.shade(head, (x, y) => y > hy + 5 || x < hx - 4, CS);
        if (f.eyes === 'open' || f.eyes === 'half') {
          const L = [[4, 0], [5, 0], [6, 0], [4, 1], [5, 1], [6, 1], [7, 1], [5, 2], [6, 2], [7, 2]]
            .filter(([, j]) => f.eyes !== 'half' || j > 0);
          for (const [x, j] of L) d.p(hx + x, hy + j, OUT);
          d.p(hx + 6, hy + 1, GL);
        } else eyeOne(d, hx + 4, hy, 4, 3, f, OUT);
        mouthSide(d, hx + 5, hy + 6, f, 3);
      } else {
        const head = union(ellPx(hx, hy - 1, 8, 6.5), ellPx(hx, hy + 3, 5, 5));
        d.o(head, C); d.shade(head, (x, y) => y > hy + 4, CS);
      }
    },

    axolotl(d, view, hx, hy, f, frame) {
      const K = '#ffb3d1', KS = '#e886b0', GI = '#ff5c9e', GD = '#c93a7a';
      const w = frame % 2;
      if (view === 'front' || view === 'back') {
        const gills = union(
          linePx(hx - 6, hy - 2, hx - 9, hy - 5 - w), linePx(hx - 7, hy + 1, hx - 10, hy + 0),
          linePx(hx - 6, hy + 3, hx - 9, hy + 5 + w),
          linePx(hx + 6, hy - 2, hx + 9, hy - 5 - w), linePx(hx + 7, hy + 1, hx + 10, hy + 0),
          linePx(hx + 6, hy + 3, hx + 9, hy + 5 + w));
        d.o(gills, GI);
        for (const [x, y] of gills) if ((x + y) % 3 === 0) d.p(x, y, GD);
        const head = ellPx(hx, hy + 1, 8, 6.5);
        d.o(head, K); d.shade(head, (x, y) => (y - hy - 1) / 6.5 > 0.62, KS);
        if (view === 'front') {
          eyePair(d, hx, 18 + (hx - 23.5), hy, 2, 2, f, OUT, KS);
          d.sym(hx, 16 + (hx - 23.5), hy + 3, 2, 1, GI);
          mouthFront(d, hx, hy + 4, f, 8, '#a8466e');
        } else {
          d.p(hx - 2, hy - 2, KS); d.p(hx + 2, hy, KS); d.p(hx, hy + 3, KS);
        }
      } else {
        const gills = union(
          linePx(hx - 4, hy - 3, hx - 7, hy - 7 - w), linePx(hx - 5, hy, hx - 9, hy - 1),
          linePx(hx - 4, hy + 3, hx - 8, hy + 5 + w));
        d.o(gills, GI);
        for (const [x, y] of gills) if ((x + y) % 3 === 0) d.p(x, y, GD);
        const head = ellPx(hx + 1, hy + 1, 8, 6.5);
        d.o(head, K); d.shade(head, (x, y) => (y - hy - 1) / 6.5 > 0.62, KS);
        eyeOne(d, hx + 4, hy, 2, 2, f, OUT, KS);
        d.r(hx + 4, hy + 3, 2, 1, GI);
        mouthSide(d, hx + 3, hy + 4, f, 5, '#a8466e');
      }
    },
  };

  Object.assign(HEADS, {
    brain(d, view, hx, hy, f, frame) {
      const B = '#f4a3c4', BS = '#d9789f', BL = '#ffd2e4', FOLD = '#c45e8a', ZAP = '#ffe066';
      const xo = hx - 23.5;
      const folds = (cx, side) => {
        const paths = [[[-6, -2], [-5, -3], [-3, -3], [-2, -2]], [[-5, -5], [-4, -6], [-2, -5]], [[-5, 1], [-3, 0], [-2, 1]]];
        const mirror = side ? [] : paths.map(p => p.map(([x, y]) => [-x + (hx % 1 ? 1 : 0), y]));
        const shift = side ? 1 : 0;
        for (const p of [...paths, ...mirror]) for (let k = 0; k < p.length - 1; k++)
          d.f(linePx(Math.round(cx + p[k][0]) + shift, hy + p[k][1], Math.round(cx + p[k + 1][0]) + shift, hy + p[k + 1][1]), FOLD);
        if (side) d.f(linePx(Math.round(cx) + 3, hy - 4, Math.round(cx) + 5, hy - 3), FOLD);
      };
      if (frame % 4 === 1 && view !== 'back') { d.p(Math.round(hx + 6), hy - 8, ZAP); d.p(Math.round(hx + 7), hy - 9, ZAP); d.p(Math.round(hx + 6), hy - 10, ZAP); }
      if (view === 'side') {
        const head = ellPx(hx + 1, hy, 8.5, 7);
        d.o(head, B); d.shade(head, (x, y) => y > hy + 4, BS); d.shade(head, (x, y) => y < hy - 4 && x < hx - 1, BL);
        folds(hx, true);
        eyeOne(d, hx + 4, hy + 1, 2, 2, f, OUT, BS);
        d.r(hx + 4, hy + 3, 2, 1, '#ff7aa8');
        mouthSide(d, hx + 4, hy + 5, f, 3, '#8a3a5a');
        return;
      }
      const head = ellPx(hx, hy, 8.5, 7);
      d.o(head, B); d.shade(head, (x, y) => y > hy + 4, BS); d.shade(head, (x, y) => y < hy - 4 && x < hx - 2, BL);
      d.r(Math.round(hx - 0.5), hy - 7, hx % 1 ? 1 : 1, 6, FOLD);
      folds(hx, false);
      if (view === 'back') { d.p(Math.round(hx - 3), hy + 2, FOLD); d.p(Math.round(hx + 3), hy + 1, FOLD); d.p(Math.round(hx - 5), hy + 3, FOLD); d.p(Math.round(hx + 5), hy + 3, FOLD); return; }
      eyePair(d, hx, 19 + xo, hy + 1, 2, 2, f, OUT, BS);
      d.sym(hx, 17 + xo, hy + 3, 2, 1, '#ff7aa8');
      mouthFront(d, hx, hy + 5, f, 4, '#8a3a5a');
    },

    robot(d, view, hx, hy, f, frame) {
      const M = '#b8c0d8', MS = '#8a93b3', SCR = '#13233a', CY = '#5be3d1';
      const xo = hx - 23.5, bulb = frame % 2 ? '#ff5d6c' : '#ffd23f';
      if (view === 'side') {
        d.o(linePx(hx, hy - 7, hx, hy - 10), MS); d.o([[hx, hy - 11]], bulb);
        d.o(roundPx(hx - 6, hy - 6, 14, 13), M);
        d.r(hx - 5, hy + 5, 12, 1, MS);
        d.o(rectPx(hx - 2, hy, 2, 2), MS);
        d.r(hx + 3, hy - 4, 4, 8, SCR);
        const e = f.eyes;
        if (e === 'open') d.r(hx + 4, hy - 2, 2, 3, CY); else if (e === 'half') d.r(hx + 4, hy - 1, 2, 2, CY);
        else d.r(hx + 4, hy, 2, 1, CY);
        d.r(hx + 4, hy + 2, f.mouth === 'open' || f.mouth === 'yawn' ? 3 : 2, f.mouth === 'yawn' ? 2 : 1, CY);
        return;
      }
      d.o(linePx(24 + xo, hy - 7, 24 + xo, hy - 10), MS); d.o([[24 + xo, hy - 11]], bulb);
      d.o(rectPx(14 + xo, hy - 1, 2, 4), MS); d.o(rectPx(32 + xo, hy - 1, 2, 4), MS);
      d.o(roundPx(16 + xo, hy - 6, 16, 13), M);
      d.r(17 + xo, hy + 5, 14, 1, MS); d.r(30 + xo, hy - 5, 1, 10, MS);
      if (view === 'back') {
        for (const y of [-3, -1, 1]) d.r(19 + xo, hy + y, 10, 1, MS);
        d.p(17 + xo, hy - 5, MS); d.p(30 + xo, hy + 4, MS); return;
      }
      d.r(18 + xo, hy - 4, 12, 8, SCR);
      d.r(18 + xo, hy - 4 + (frame % 8), 12, 1, '#1c3350');
      const e = f.eyes;
      if (e === 'open') d.sym(hx, 20 + xo, hy - 2, 2, 3, CY);
      else if (e === 'half') d.sym(hx, 20 + xo, hy - 1, 2, 2, CY);
      else if (e === 'happy') { d.sym(hx, 20 + xo, hy - 1, 1, 1, CY); d.sym(hx, 21 + xo, hy - 2, 1, 1, CY); d.sym(hx, 22 + xo, hy - 1, 1, 1, CY); }
      else d.sym(hx, 20 + xo, hy, 2, 1, CY);
      if (f.mouth === 'open' || f.mouth === 'yawn') d.r(22 + xo, hy + 1, 4, 2, CY);
      else if (f.mouth === 'flat') d.r(22 + xo, hy + 2, 4, 1, CY);
      else { d.r(22 + xo, hy + 2, 4, 1, CY); d.sym(hx, 21 + xo, hy + 1, 1, 1, CY); }
    },

    cat(d, view, hx, hy, f) {
      const O = '#ffb15e', OS = '#e0883a', ST = '#d9762c', WH = '#fff1dc', PK = '#ff9bb0', EYE = '#2a5a30';
      const xo = hx - 23.5;
      if (view === 'side') {
        const ear = [[hx - 2, hy - 8], [hx - 3, hy - 7], [hx - 2, hy - 7], [hx - 1, hy - 7], ...rectPx(hx - 4, hy - 6, 5, 1), ...rectPx(hx - 4, hy - 5, 6, 1)];
        const head = union(ear, ellPx(hx + 1, hy + 1, 8, 6.5));
        d.o(head, O); d.shade(head, (x, y) => y > hy + 5, OS);
        d.r(hx - 3, hy - 6, 2, 1, PK);
        d.r(hx - 3, hy - 2, 1, 3, ST); d.r(hx - 5, hy, 1, 3, ST);
        d.f(ellPx(hx + 6, hy + 3, 2.5, 2), WH);
        d.p(hx + 8, hy + 2, PK);
        eyeOne(d, hx + 4, hy, 2, 2, f, EYE, OS);
        mouthSide(d, hx + 5, hy + 5, f, 3);
        d.r(hx + 7, hy + 4, 2, 1, WH);
        return;
      }
      const ear = s => { const px = []; const rows = [[1, 1], [0, 3], [0, 4], [0, 5]]; rows.forEach(([o, w], j) => { for (let i = 0; i < w; i++) { const x = 16 + o + i + xo; px.push([s < 0 ? x : Math.round(2 * hx + 1 - x - 1), hy - 8 + j]); } }); return px; };
      const head = union(ear(-1), ear(1), ellPx(hx, hy + 1, 8, 6.5));
      d.o(head, O); d.shade(head, (x, y) => y > hy + 5, OS);
      d.sym(hx, 17 + xo, hy - 6, 1, 2, PK);
      if (view === 'back') { d.r(23 + xo, hy - 5, 2, 3, ST); d.sym(hx, 19 + xo, hy - 3, 1, 3, ST); d.sym(hx, 17 + xo, hy, 1, 3, ST); return; }
      d.r(23 + xo, hy - 5, 2, 2, ST); d.sym(hx, 19 + xo, hy - 4, 1, 2, ST);
      d.f(ellPx(hx, hy + 3, 3.5, 2.2), WH);
      eyePair(d, hx, 19 + xo, hy, 2, 2, f, EYE, OS);
      d.r(23 + xo, hy + 2, 2, 1, PK);
      mouthFront(d, hx, hy + 4, f, 4);
      d.sym(hx, 14 + xo, hy + 2, 2, 1, WH); d.sym(hx, 14 + xo, hy + 4, 2, 1, WH);
    },

    octo(d, view, hx, hy, f, frame) {
      const CO = '#ff7f7f', COS = '#d9575f', SP = '#ffb0a8';
      const xo = hx - 23.5, w = frame % 2;
      if (view === 'side') {
        const t = union(linePx(hx - 3, hy + 4, hx - 6, hy + 7 + w), linePx(hx, hy + 4, hx - 2, hy + 8), linePx(hx + 3, hy + 4, hx + 2, hy + 8 - w));
        d.o(t, CO);
        const dome = ellPx(hx + 1, hy - 1, 8, 6.8);
        d.o(dome, CO); d.shade(dome, (x, y) => y > hy + 3, COS);
        d.p(hx - 3, hy - 5, SP); d.p(hx - 5, hy - 2, SP); d.p(hx, hy - 6, SP);
        if (f.eyes === 'open' || f.eyes === 'half') { d.r(hx + 3, hy - 2, 3, 3, '#ffffff'); d.r(hx + 4, hy - 1, 2, 2, OUT); if (f.eyes === 'half') d.r(hx + 3, hy - 2, 3, 1, COS); }
        else eyeOne(d, hx + 3, hy - 2, 3, 3, f, OUT);
        mouthSide(d, hx + 5, hy + 3, f, 3);
        return;
      }
      const t = union(...[-6, -3, 2, 5].map((o, k) => {
        const x = Math.round(hx + o); const out = o < 0 ? -1 : 1;
        return union(linePx(x, hy + 4, x, hy + 7), [[x + out * ((k + w) % 2 ? 1 : 0) + out, hy + 8]]);
      }));
      d.o(t, CO);
      const dome = ellPx(hx, hy - 1, 8, 6.8);
      d.o(dome, CO); d.shade(dome, (x, y) => y > hy + 3, COS);
      if (view === 'back') { d.p(hx - 4, hy - 4, SP); d.p(hx + 3, hy - 2, SP); d.p(hx - 1, hy + 1, SP); d.p(hx + 1, hy - 6, SP); return; }
      d.p(hx - 5, hy - 5, SP); d.p(hx + 4, hy - 6, SP);
      if (f.eyes === 'open' || f.eyes === 'half') {
        d.sym(hx, 18 + xo, hy - 2, 3, 3, '#ffffff'); d.sym(hx, 19 + xo, hy - 1, 2, 2, OUT);
        if (f.eyes === 'half') d.sym(hx, 18 + xo, hy - 2, 3, 1, COS);
      } else eyePair(d, hx, 18 + xo, hy - 2, 3, 3, f, OUT);
      d.sym(hx, 16 + xo, hy + 1, 2, 1, SP);
      mouthFront(d, hx, hy + 3, f, 4);
    },

    radish(d, view, hx, hy, f, frame) {
      const R = '#f7e3ee', RS = '#e6bfd6', TOP = '#d94a8a', MID = '#ef8fbd', L = '#5be37d', LS = '#35b25a';
      const xo = hx - 23.5, sway = frame % 4 < 2 ? 0 : 1;
      const lx = view === 'side' ? hx : 24 + xo;
      const leaves = union(linePx(lx, hy - 5, lx, hy - 7), ellPx(lx - 3 + sway, hy - 8, 2.4, 1.4), ellPx(lx + 3 + sway, hy - 8.5, 2.4, 1.4));
      d.o(leaves, L); d.shade(leaves, (x) => x > lx + 1, LS);
      const head = ellPx(view === 'side' ? hx + 1 : hx, hy + 1, 7.5, 7);
      d.o(head, R);
      d.shade(head, (x, y) => y < hy - 2, TOP); d.shade(head, (x, y) => y === hy - 2, MID); d.shade(head, (x, y) => y > hy + 6, RS);
      if (view === 'back') return;
      if (view === 'side') {
        eyeOne(d, hx + 4, hy + 1, 2, 2, f, OUT, RS); d.r(hx + 4, hy + 3, 2, 1, '#ff9bc0'); mouthSide(d, hx + 4, hy + 5, f, 3, '#a8466e');
        return;
      }
      eyePair(d, hx, 19 + xo, hy + 1, 2, 2, f, OUT, RS);
      d.sym(hx, 17 + xo, hy + 3, 2, 1, '#ff9bc0');
      mouthFront(d, hx, hy + 5, f, 4, '#a8466e');
    },

    dino(d, view, hx, hy, f) {
      const D = '#5aa9ff', DS = '#3a7fd8', BEL = '#bfe3ff', SPK = '#ffd23f';
      const xo = hx - 23.5;
      if (view === 'side') {
        d.o([[hx - 6, hy - 5], [hx - 7, hy - 4], [hx - 8, hy - 2], [hx - 8, hy - 1], [hx - 8, hy + 2], [hx - 9, hy + 3]], SPK);
        const head = union(ellPx(hx, hy - 1, 7, 6.5), ellPx(hx + 4, hy + 2, 6, 4));
        d.o(head, D); d.shade(head, (x, y) => y > hy + 4, DS);
        d.f(ellPx(hx + 3, hy + 5, 4, 1.2), BEL);
        d.p(hx + 9, hy, DS);
        eyeOne(d, hx + 1, hy - 3, 2, 2, f, OUT, DS); d.r(hx, hy - 4, 3, 1, DS);
        const open = f.mouth === 'open' || f.mouth === 'yawn';
        d.r(hx + 2, hy + 3, 8, open ? 2 : 1, OUT);
        for (const x of [3, 5, 7, 9]) d.p(hx + x, hy + (open ? 3 : 4), '#ffffff');
        return;
      }
      const head = union(ellPx(hx, hy, 8, 6.5), ellPx(hx, hy + 4, 7, 3.5));
      if (view === 'back') {
        d.o(head, D); d.shade(head, (x, y) => y > hy + 5, DS);
        d.o([[23 + xo, hy - 7], [24 + xo, hy - 7], [23 + xo, hy - 4], [24 + xo, hy - 4], [23 + xo, hy - 1], [24 + xo, hy - 1], [23 + xo, hy + 2], [24 + xo, hy + 2]], SPK);
        return;
      }
      d.o([[23 + xo, hy - 7], [24 + xo, hy - 7], [23 + xo, hy - 8]], SPK);
      d.o(head, D); d.shade(head, (x, y) => y > hy + 5, DS);
      d.f(ellPx(hx, hy + 5, 5, 1.6), BEL);
      eyePair(d, hx, 18 + xo, hy - 4, 2, 3, f, OUT, DS);
      d.sym(hx, 22 + xo, hy + 1, 1, 1, DS);
      const open = f.mouth === 'open' || f.mouth === 'yawn';
      d.r(18 + xo, hy + 3, 12, open ? 2 : 1, OUT);
      d.sym(hx, 17 + xo, hy + 2, 1, 1, OUT);
      d.sym(hx, 19 + xo, hy + (open ? 3 : 4), 1, 1, '#ffffff'); d.sym(hx, 22 + xo, hy + (open ? 3 : 4), 1, 1, '#ffffff');
    },
  });
  const FACE_EXTRA = ({
    brain: { ey: 0, lx: 18, lw: 4, lh: 4, sx: 3, sw: 4, my: 4, smx: 4 },
    robot: { ey: -3, lx: 19, lw: 4, lh: 5, sx: 3, sw: 4, my: 1, smx: 4 },
    cat: { ey: -1, lx: 18, lw: 4, lh: 4, sx: 3, sw: 4, my: 3, smx: 5 },
    octo: { ey: -3, lx: 17, lw: 5, lh: 5, sx: 2, sw: 5, my: 2, smx: 5 },
    radish: { ey: 0, lx: 18, lw: 4, lh: 4, sx: 3, sw: 4, my: 4, smx: 4 },
    dino: { ey: -4, lx: 17, lw: 4, lh: 4, sx: 0, sw: 4, my: 2, smx: 3 },
  });
  const HEAD_TOP = { cyclops: -7, robot: -6 };

  // tails (Mochi, Rex)
  function tail(d, ch, view, xo, by, frame) {
    const T = ch.tail; if (!T) return;
    if (view === 'front') {
      if (T.thick) { d.o(union(rectPx(29 + xo, 37 + by, 5, 3), rectPx(32 + xo, 35 + by, 3, 3)), T.c); d.r(29 + xo, 39 + by, 5, 1, T.s); }
      else { const px = union(linePx(30 + xo, 38 + by, 35 + xo, 31 + by - (frame % 2)), linePx(31 + xo, 38 + by, 36 + xo, 31 + by - (frame % 2))); d.o(px, T.c); d.shade(px, (x, y) => (x + y) % 2 === 0, T.s); }
    } else if (view === 'side') {
      if (T.thick) { const px = union(rectPx(11, 34 + by, 8, 4), rectPx(7, 35 + by, 4, 2), [[6, 36 + by]]); d.o(px, T.c); d.shade(px, (x, y) => y === 37 + by, T.s); }
      else { const px = linePx(16, 36 + by, 10, 30 + by - (frame % 2)); d.o(px, T.c); d.shade(px, (x, y) => (x + y) % 2 === 0, T.s); }
    } else {
      if (T.thick) { const px = union(rectPx(21 + xo, 36 + by, 6, 4), rectPx(22 + xo, 40 + by, 4, 3)); d.o(px, T.c); d.r(22 + xo, 38 + by, 4, 1, T.s); }
      else { const px = linePx(24 + xo, 36 + by, 28 + xo + (frame % 2), 29 + by); d.o(px, T.c); d.shade(px, (x, y) => (x + y) % 2 === 0, T.s); }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Characters                                                         */
  /* ------------------------------------------------------------------ */
  const CREW = {
    cortex: {
      name: 'Captain Cortex', role: 'Head Captain', species: 'Brain astronaut', head: 'brain', helmet: true, antenna: true,
      suit: '#c8324f', shade: '#952140', accent: '#ffd23f', glove: '#ffd23f', boot: '#2a1d3f', pack: '#e9ecf8', bag: '#ffd23f', bagS: '#d9a91c', chest: 'star',
      bio: 'Thinks so hard you can hear it crackle. Plans every mission, then hands out the jobs.',
    },
    ribbit: {
      name: 'Ribbit', role: 'First Officer', species: 'Frog astronaut', head: 'frog', helmet: true, antenna: true,
      suit: '#eef1fb', shade: '#b4bddb', accent: '#ff8a3d', glove: '#ff8a3d', boot: '#5b5f86', pack: '#d2d8ee', bag: '#ff8a3d', bagS: '#d9692a', chest: 'star',
      bio: 'Former captain, demoted after the Lily Pad Incident. Still leaps first, now checks the work twice.',
    },
    nova: {
      name: 'Nova', role: 'Pilot', species: 'Human astronaut', head: 'human', helmet: true,
      suit: '#ff9a4d', shade: '#d4692c', accent: '#3fd0c9', glove: '#eef1fb', boot: '#4a4f78', pack: '#e9ecf8', bag: '#3fd0c9', bagS: '#24a39c', chest: 'panel',
      bio: 'Can thread the ship through an asteroid field. Cannot parallel park.',
    },
    zorp: {
      name: 'Zorp', role: 'Engineer', species: 'Cyclops from Glorbon-7', head: 'cyclops', helmet: false,
      suit: '#2fb8a6', shade: '#1f8577', accent: '#ffd23f', glove: '#a575ff', boot: '#3d3a6b', pack: '#ffd23f', bag: '#ffd23f', bagS: '#d9a91c', chest: 'wrench',
      bio: 'Fixes anything with a wrench and a hum. The hum is load-bearing.',
    },
    pip: {
      name: 'Pip', role: 'Science Officer', species: 'Grey from Zeta Reticuli', head: 'grey', helmet: true,
      suit: '#f3f4fb', shade: '#bfc3dc', accent: '#7b6cff', glove: '#7b6cff', boot: '#4a4f78', pack: '#cfd4ee', bag: '#7b6cff', bagS: '#5a4bd6', chest: 'atom',
      bio: 'Has catalogued 4,012 rocks. Has a favourite. Will not say which.',
    },
    koda: {
      name: 'Koda', role: 'Medic & Botanist', species: 'Axolotl astronaut', head: 'axolotl', helmet: true,
      suit: '#b9a7ff', shade: '#8b77e0', accent: '#5be37d', glove: '#ffb3d1', boot: '#4a3f86', pack: '#e5dcff', bag: '#5be37d', bagS: '#35b25a', chest: 'cross',
      bio: 'Grows tomatoes in zero-g. Regrows a lost finger in about a week.',
    },
    gizmo: {
      name: 'Gizmo', role: 'Systems Officer', species: 'Service robot', head: 'robot', helmet: false,
      suit: '#ffd23f', shade: '#d9a91c', accent: '#3f8cff', glove: '#8a93b3', boot: '#4a4f78', pack: '#b8c0d8', bag: '#3f8cff', bagS: '#2a6ad8', chest: 'panel',
      bio: 'Runs every system on the ship. Sleeps anyway, because the crew made it look fun.',
    },
    mochi: {
      name: 'Mochi', role: 'Comms Officer', species: 'Space cat', head: 'cat', helmet: true, tail: { c: '#ffb15e', s: '#d9762c' },
      suit: '#7fd8ff', shade: '#4aa8d8', accent: '#ff8a3d', glove: '#ffffff', boot: '#4a4f78', pack: '#d8f2ff', bag: '#ff8a3d', bagS: '#d9692a', chest: 'paw',
      bio: 'Speaks 40 alien languages, mostly by meowing at them until they agree.',
    },
    inky: {
      name: 'Inky', role: 'Cartographer', species: 'Nebula octopus', head: 'octo', helmet: true,
      suit: '#4b4f8f', shade: '#33366a', accent: '#ff7f7f', glove: '#ff7f7f', boot: '#26284f', pack: '#6a6fae', bag: '#ff7f7f', bagS: '#d9575f', chest: 'star',
      bio: 'Draws star maps with all eight arms at once. Signs them in ink, naturally.',
    },
    sprig: {
      name: 'Sprig', role: 'Hydroponics', species: 'Radish from Verdana-4', head: 'radish', helmet: true,
      suit: '#f1e3c2', shade: '#cdb98f', accent: '#5be37d', glove: '#8a5a3a', boot: '#5a3a2a', pack: '#e0cc9f', bag: '#5be37d', bagS: '#35b25a', chest: 'leaf',
      bio: 'Talks to the tomatoes. The tomatoes have started talking back.',
    },
    rex: {
      name: 'Rex', role: 'Security Chief', species: 'Tyrannosaur astronaut', head: 'dino', helmet: true, tail: { c: '#5aa9ff', s: '#3a7fd8', thick: true },
      suit: '#5b4b9a', shade: '#433673', accent: '#ffd23f', glove: '#ffd23f', boot: '#2a2350', pack: '#7a6ab8', bag: '#ffd23f', bagS: '#d9a91c', chest: 'shield',
      bio: 'Tiny arms, enormous heart. Cannot reach the top shelf of the armoury.',
    },
  };

  const PETS = {
    blorb: { name: 'Blorb', role: 'Station slime', species: 'Gel-blob', draw: 'blob', bio: 'Eats space dust. The antenna glows brighter when it is happy (always).' },
    glim: { name: 'Glim', role: 'Night-light', species: 'Void jelly', draw: 'jelly', bio: 'Floats around the corridors at night so nobody stubs a toe.' },
    moonpup: { name: 'Moonpup', role: 'Good pup', species: 'Six-legged lunar hound', draw: 'pup', bio: 'Six legs, one braincell, all of it devoted to fetch.' },
    orbit: { name: 'Orbit', role: 'Pocket planet', species: 'Ringed planetoid', draw: 'planet', bio: 'Brought its own moon. Rolls everywhere. Mildly gravitational.' },
  };

  /* ------------------------------------------------------------------ */
  /* Wardrobe: accessories + color variants                             */
  /* ------------------------------------------------------------------ */
  const SUITS = {
    default: null,
    midnight: { suit: '#3b3f7a', shade: '#2a2c5c', accent: '#ffd23f', pack: '#4b4f8f', bag: '#3b3f7a', bagS: '#2a2c5c' },
    mint: { suit: '#9ee6c9', shade: '#62b89a', accent: '#ff8a3d', pack: '#c9f2e2', bag: '#62b89a', bagS: '#3f8f74' },
    rose: { suit: '#ffb0c8', shade: '#e07ea0', accent: '#7b6cff', pack: '#ffd6e3', bag: '#ff7ab8', bagS: '#d9508f' },
    sunset: { suit: '#ff7a59', shade: '#cc4f37', accent: '#ffd23f', pack: '#ffc2a8', bag: '#ff7a59', bagS: '#cc4f37' },
    snow: { suit: '#eef1fb', shade: '#b4bddb', accent: '#3fd0c9', pack: '#d2d8ee', bag: '#3fd0c9', bagS: '#24a39c' },
  };
  const SUIT_SWATCH = { midnight: '#3b3f7a', mint: '#9ee6c9', rose: '#ffb0c8', sunset: '#ff7a59', snow: '#eef1fb' };

  const PET_COLORS = {
    blorb: {
      base: ['#47e0c4', '#2fb7a0', '#c9fff3', '#2fb7a0'],
      berry: ['#ff7ab8', '#d9508f', '#ffd6ea', '#d9508f'], lime: ['#a8e05a', '#78b23a', '#e6ffc4', '#78b23a'], lava: ['#ff9a4d', '#d96a2a', '#ffe0c4', '#d96a2a'],
    },
    glim: {
      base: ['#c58cff', '#9a5fe0', '#e2c6ff', '#ff9bd2', '#e07ad0', '#a97ae0', '#ffd3ec', '#f3e3ff'],
      aqua: ['#7fd8ff', '#4aa8d8', '#c8f0ff', '#9bfff0', '#5fd0c8', '#5fa8d0', '#d8fffa', '#e8f8ff'],
      sun: ['#ffd25a', '#e0a830', '#fff0b8', '#ffb08a', '#ff8a5a', '#d0a040', '#ffe0cc', '#fff8e0'],
    },
    moonpup: {
      base: ['#c3bdf2', '#958ed6', '#a59ee0', '#8279c4', '#e9e6ff'],
      cocoa: ['#d9a982', '#a8764f', '#c08f68', '#8a5a3a', '#f4e2d0'], snow: ['#f2f2fa', '#c4c6dc', '#d8d9ea', '#a9abc8', '#ffffff'], mars: ['#ff9c7a', '#d06a4c', '#e8836a', '#b8523a', '#ffe0d4'],
    },
    orbit: {
      base: ['#ff9f5a', '#e0703a', '#ffd27a', '#ffe1c4', '#e88d4f', '#8fe3ff', '#4fb6dc'],
      neptune: ['#6f9bff', '#4a6ad8', '#a8c8ff', '#dbe8ff', '#5a7ae0', '#ffd23f', '#d9a91c'],
      jade: ['#5be37d', '#35b25a', '#b8f5a8', '#e2ffd8', '#45c06a', '#ffb3d1', '#e886b0'],
    },
  };

  const LABELS = {
    suit: { default: 'Classic', midnight: 'Midnight', mint: 'Mint', rose: 'Rose', sunset: 'Sunset', snow: 'Snow' },
    hat: { none: 'None', cap: "Captain's cap", beanie: 'Beanie', crown: 'Crown', propeller: 'Propeller', party: 'Party hat', lilypad: 'Lily pad', bow: 'Bow', headphones: 'Headphones', halo: 'Halo' },
    face: { none: 'None', shades: 'Shades', round: 'Round specs', goggles: 'Goggles', visor: 'Visor', stache: 'Moustache' },
    neck: { none: 'None', scarf: 'Scarf', bowtie: 'Bow tie', medal: 'Medal' },
    back: { none: 'None', cape: 'Cape', jetpack: 'Jetpack' },
    color: { default: 'Classic', berry: 'Berry', lime: 'Lime', lava: 'Lava', aqua: 'Aqua', sun: 'Sunny', cocoa: 'Cocoa', snow: 'Snow', mars: 'Mars', neptune: 'Neptune', jade: 'Jade' },
  };
  const CREW_SLOTS = {
    suit: Object.keys(SUITS),
    hat: ['none', 'cap', 'beanie', 'crown', 'propeller', 'party', 'lilypad', 'bow', 'headphones', 'halo'],
    face: ['none', 'shades', 'round', 'goggles', 'visor', 'stache'],
    neck: ['none', 'scarf', 'bowtie', 'medal'],
    back: ['none', 'cape', 'jetpack'],
  };
  const PET_HATS = ['none', 'party', 'crown', 'beanie', 'propeller', 'bow', 'halo', 'lilypad'];

  // where eyes and mouth sit for each species (relative to head centre)
  const FACE = {
    frog: { ey: -5, lx: 17, lw: 5, lh: 5, sx: 2, sw: 4, my: 3, smx: 2 },
    human: { ey: -1, lx: 18, lw: 4, lh: 4, sx: 3, sw: 4, my: 4, smx: 4 },
    cyclops: { ey: -4, single: true, sx: 3, sw: 6, lh: 7, my: 5, smx: 4 },
    grey: { ey: -1, lx: 16, lw: 6, lh: 5, sx: 3, sw: 6, my: 5, smx: 5 },
    axolotl: { ey: -1, lx: 17, lw: 4, lh: 4, sx: 3, sw: 4, my: 3, smx: 3 },
  };
  Object.assign(FACE, FACE_EXTRA);
  const CAPE = '#d6334f', CAPE_S = '#a8233c', METAL = '#9aa3c7', METAL_S = '#6b7398';

  function frameRect(x, y, w, h) {
    return rectPx(x, y, w, h).filter(([px, py]) => px === x || py === y || px === x + w - 1 || py === y + h - 1);
  }
  function mix(c, t, a) {
    if (!c || c[0] !== '#') return c;
    const n = parseInt(c.slice(1), 16), m = parseInt(t.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * (1 - a) + ((m >> 16) & 255) * a);
    const g = Math.round(((n >> 8) & 255) * (1 - a) + ((m >> 8) & 255) * a);
    const b = Math.round((n & 255) * (1 - a) + (m & 255) * a);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function drawHat(d, kind, view, A, frame, small) {
    if (!kind || kind === 'none') return;
    const hx = A.hx, t = A.top, W = small ? 8 : 12;
    const xl = Math.round(hx + 0.5 - W / 2);
    const mid = (y, c) => { if (hx % 1) d.r(hx - 0.5, y, 2, 1, c); else d.p(hx, y, c); };
    switch (kind) {
      case 'cap': {
        d.o(roundPx(xl, t - 3, W, 4), '#2d3270');
        d.r(xl + 1, t - 3, W - 2, 1, '#454b96');
        d.r(xl, t, W, 1, '#ffd23f');
        if (view === 'front') { mid(t - 2, '#ffd23f'); d.o(rectPx(xl - 1, t + 1, W + 2, 1), '#1f2350'); }
        if (view === 'side') d.o(rectPx(xl + W - 3, t + 1, 6, 1), '#1f2350');
        break;
      }
      case 'beanie': {
        const dome = ellPx(hx, t + 1, W / 2 + 0.5, small ? 4 : 5).filter(([, y]) => y <= t - 1);
        d.o(dome, '#ff5d6c');
        d.shade(dome, (x, y) => (t - y) % 2 === 0, '#ffffff');
        d.o(rectPx(xl, t - 1, W, 2), '#c93a4f');
        d.o(ellPx(hx, t - (small ? 5 : 6), 1.6, 1.6), '#ffffff');
        break;
      }
      case 'crown': {
        const h = small ? 2 : 3;
        const px = union(rectPx(xl + 1, t - h + 1, W - 2, h), [[xl + 1, t - h], [xl + W - 2, t - h]],
          hx % 1 ? [[hx - 0.5, t - h], [hx + 0.5, t - h], [hx - 0.5, t - h - 1], [hx + 0.5, t - h - 1]] : [[hx, t - h], [hx, t - h - 1]]);
        d.o(px.map(([x, y]) => [Math.round(x), y]), '#ffd23f');
        d.r(xl + 1, t, W - 2, 1, '#d9a91c');
        mid(t - 1, '#ff5d6c');
        break;
      }
      case 'propeller': {
        const dome = ellPx(hx, t + 1, W / 2, small ? 3.5 : 4.5).filter(([, y]) => y <= t);
        d.o(dome, '#ff5d6c');
        d.shade(dome, (x) => x > hx, '#3f8cff');
        d.shade(dome, (x) => Math.abs(x - hx) < 1, '#ffd23f');
        const top = Math.min(...dome.map(([, y]) => y));
        const sx = Math.round(hx - 0.01);
        d.r(sx, top - 2, 1, 2, OUT);
        if (frame % 2) d.o(rectPx(sx - (small ? 3 : 5), top - 3, small ? 7 : 11, 1), '#ffd23f');
        else d.o(rectPx(sx - 1, top - 3, 3, 1), '#ffd23f');
        break;
      }
      case 'party': {
        const h = small ? 6 : 8, px = [];
        for (let j = 0; j < h; j++) {
          const w = Math.max(1, Math.round((W - 2) * (1 - j / h)));
          const x0 = Math.round(hx + 0.5 - w / 2);
          for (let i = 0; i < w; i++) px.push([x0 + i, t - j]);
        }
        d.o(px, '#ff7ab8');
        d.shade(px, (x, y) => (x + y) % 4 === 0, '#ffd23f');
        d.o(ellPx(Math.round(hx - 0.01), t - h - 1, 1.4, 1.4), '#5be3d1');
        break;
      }
      case 'lilypad': {
        const pad = ellPx(hx, t, W / 2 + 2, 1.8).filter(([x, y]) => !(x > hx + 1 && x < hx + 4 && y < t));
        d.o(pad, '#4fbf5a'); d.shade(pad, (x, y) => y > t, '#35994a');
        const fx = Math.round(hx) - 2, fy = t - 2;
        d.o([[fx, fy - 1], [fx - 1, fy], [fx + 1, fy], [fx, fy + 1]], '#ff8fb8');
        d.p(fx, fy, '#ffe066');
        break;
      }
      case 'bow': {
        const bx = view === 'back' ? hx - 2 : hx + 2;
        d.o(union(ellPx(bx - 2.5, t - 1, 2, 1.6), ellPx(bx + 2.5, t - 1, 2, 1.6), rectPx(Math.round(bx - 0.5), t - 2, 2, 2)), '#ff6fae');
        d.r(Math.round(bx - 0.5), t - 2, 2, 2, '#d94a8a');
        break;
      }
      case 'headphones': {
        const R = A.R, hy = A.hy;
        const band = ellPx(hx, hy, R + 1.6, R + 1.6).filter(([x, y]) => y < hy - 2 && ((x - hx) / (R + 0.5)) ** 2 + ((y - hy) / (R + 0.5)) ** 2 > 1);
        d.o(band, '#3d3f63');
        if (view === 'side') d.o(roundPx(Math.round(hx - 3), hy - 3, 5, 6), '#ff5d6c');
        else {
          const cl = Math.round(hx - R - 2);
          d.o(roundPx(cl, hy - 3, 3, 6), '#ff5d6c'); d.o(roundPx(Math.round(2 * hx + 1 - cl - 3), hy - 3, 3, 6), '#ff5d6c');
        }
        break;
      }
      case 'halo': {
        const b = frame % 2, cy = t - (small ? 3 : 4) - b, rx = W / 2;
        const ring = ellPx(hx, cy, rx, 1.7).filter(([x, y]) => ((x - hx) / rx) ** 2 + ((y - cy) / 1.7) ** 2 >= 0.35);
        d.o(ring, '#ffe066');
        break;
      }
    }
  }

  function drawFaceAcc(d, ch, view, hx, hy, frame) {
    const kind = ch.look && ch.look.face; if (!kind || kind === 'none' || view === 'back') return;
    const F = FACE[ch.head], xo = hx - 23.5, ey = hy + F.ey;
    if (kind === 'visor') {
      if (ch.helmet) {
        const px = ellPx(hx, hy, 9.4, 9.4).filter(([, y]) => y <= hy - 1);
        for (const [x, y] of px) {
          const k = y * S + x, c = d.L.p[k];
          if (c === OUT) continue;
          d.L.p[k] = c && c[0] === '#' ? mix(c, '#ffb43c', 0.55) : 'rgba(255,186,70,0.62)';
        }
        d.r(Math.round(hx - 7), hy - 1, 15, 1, '#d98a1c');
      } else if (view === 'front') {
        d.o(roundPx(Math.round(hx - 6.5), hy - 2, 14, 3), '#ff3b6b'); d.r(Math.round(hx - 5), hy - 2, 4, 1, '#ffb3c6');
      } else { d.o(roundPx(hx - 2, hy - 2, 11, 3), '#ff3b6b'); d.r(hx + 4, hy - 2, 3, 1, '#ffb3c6'); }
      return;
    }
    if (kind === 'stache') {
      const c = '#5a3a2a', my = hy + F.my;
      if (view === 'front') { d.sym(hx, Math.round(hx - 4), my, 3, 1, c); d.sym(hx, Math.round(hx - 5), my - 1, 1, 1, c); d.r(Math.round(hx - 1), my, hx % 1 ? 2 : 1, 1, c); }
      else { d.r(hx + F.smx, my, 4, 1, c); d.p(hx + F.smx - 1, my - 1, c); }
      return;
    }
    if (kind === 'goggles') {
      const gy = hy - 7;
      if (view === 'front') {
        d.r(Math.round(hx - 8), gy + 1, 17, 1, '#5a3a2a');
        for (const ox of [-3, 3]) { d.o(ellPx(hx + ox, gy + 1, 2.3, 1.8), '#c98a3a'); d.f(ellPx(hx + ox, gy + 1, 1.2, 0.9), '#7fe8ff'); }
      } else { d.r(hx - 6, gy + 1, 9, 1, '#5a3a2a'); d.o(ellPx(hx + 4, gy + 1, 2.3, 1.8), '#c98a3a'); d.f(ellPx(hx + 4, gy + 1, 1.2, 0.9), '#7fe8ff'); }
      return;
    }
    // shades / round specs
    const frameCol = kind === 'shades' ? OUT : '#7a4a2a';
    if (view === 'front') {
      if (F.single) {
        const ring = ellPx(hx, hy, 4.8, 4.8).filter(([x, y]) => ((x - hx) / 4.8) ** 2 + ((y - hy) / 4.8) ** 2 > 0.62);
        if (kind === 'shades') { d.f(ellPx(hx, hy, 4.4, 4.4), '#20183a'); d.p(Math.round(hx - 2), hy - 2, '#ffffff'); d.p(Math.round(hx - 1), hy - 3, '#ffffff'); }
        d.f(ring, frameCol); return;
      }
      const lx = F.lx + xo, rx = Math.round(2 * hx + 1 - lx - F.lw);
      for (const x of [lx, rx]) {
        if (kind === 'shades') { d.r(x, ey, F.lw, F.lh - 1, '#20183a'); d.p(x + 1, ey + 1, '#ffffff'); d.f(frameRect(x, ey, F.lw, F.lh - 1).filter(([, y]) => y === ey), OUT); }
        else d.f(frameRect(x, ey, F.lw, F.lh), frameCol);
      }
      d.r(lx + F.lw, ey + 1, rx - lx - F.lw, 1, frameCol);
    } else {
      const x = hx + F.sx;
      d.r(hx - 4, ey + 1, F.sx + 4, 1, frameCol);
      if (kind === 'shades') { d.r(x, ey, F.sw, F.lh - 1, '#20183a'); d.p(x + 1, ey + 1, '#ffffff'); }
      else d.f(frameRect(x, ey, F.sw, F.lh), frameCol);
    }
  }

  function drawNeckAcc(d, ch, view, hx, hy, frame) {
    const kind = ch.look && ch.look.neck; if (!kind || kind === 'none') return;
    const cl = Math.round(hx - 6);
    if (kind === 'scarf') {
      const R = '#ff5d6c', RS = '#c93a4f', Y = '#ffd23f';
      if (view === 'side') {
        d.o(rectPx(hx - 6, hy + 8, 12, 3), R);
        d.o(rectPx(hx - 11 - (frame % 2), hy + 9 + (frame % 2), 6, 2), R);
        d.p(hx - 11 - (frame % 2), hy + 10 + (frame % 2), Y);
      } else {
        d.o(rectPx(cl, hy + 8, 12, 3), R);
        d.r(cl, hy + 10, 12, 1, RS);
        const tx = view === 'back' ? cl + 7 : cl + 1;
        d.o(rectPx(tx, hy + 11, 3, 4 + (frame % 2)), R);
        d.r(tx, hy + 14 + (frame % 2), 3, 1, Y);
      }
      return;
    }
    if (view === 'back') return;
    if (kind === 'bowtie') {
      const B = '#ff5d6c', K = '#c93a4f';
      if (view === 'side') { d.o(rectPx(hx + 3, hy + 9, 2, 3), B); return; }
      const xc = Math.round(hx - 0.5), y = hy + 9;
      const wing = (x0, dir) => [[x0, y], [x0, y + 1], [x0, y + 2], [x0 + dir, y + 1], [x0 + 2 * dir, y + 1]];
      d.o(union(wing(xc - 3, 1), wing(Math.round(2 * hx) - xc + 3, -1), rectPx(xc, y + 1, hx % 1 ? 2 : 1, 1)), B);
      d.r(xc, y + 1, hx % 1 ? 2 : 1, 1, K);
      return;
    }
    if (kind === 'medal') {
      if (view === 'side') { d.r(hx + 1, hy + 10, 1, 4, '#3f8cff'); d.o(ellPx(hx + 1, hy + 15, 1.6, 1.6), '#ffd23f'); return; }
      d.f(union(linePx(hx - 4, hy + 10, hx - 1, hy + 13), linePx(hx + 4, hy + 10, hx + 1, hy + 13)), '#3f8cff');
      d.o(ellPx(hx, hy + 15, 2, 2), '#ffd23f');
      d.p(Math.round(hx - 1), hy + 14, '#fff4b8');
    }
  }

  // back gear, drawn at the right depth by each body function
  function backBehindFront(d, ch, xo, by) {
    const k = ch.look && ch.look.back;
    if (k === 'cape') { d.o(roundPx(15 + xo, 27 + by, 18, 13), CAPE); d.r(15 + xo, 38 + by, 18, 1, CAPE_S); }
    if (k === 'jetpack') { d.o(rectPx(13 + xo, 23 + by, 3, 5), METAL); d.o(rectPx(32 + xo, 23 + by, 3, 5), METAL); }
  }
  function backOverBack(Ly, ch, xo, by, frame) {
    const d = Ly.body, k = ch.look && ch.look.back;
    if (k === 'cape') {
      const px = roundPx(16 + xo, 26 + by, 16, 14);
      d.o(px, CAPE);
      d.r(20 + xo, 29 + by, 1, 10, CAPE_S); d.r(27 + xo, 29 + by, 1, 10, CAPE_S);
      for (let x = 16; x < 32; x++) if ((x + frame) % 3 === 0) d.p(x + xo, 39 + by, CAPE_S);
      d.r(17 + xo, 26 + by, 14, 1, '#ffd23f');
    }
    if (k === 'jetpack') {
      d.o(roundPx(16 + xo, 24 + by, 16, 13), METAL);
      d.r(18 + xo, 26 + by, 5, 8, '#c4cbe6'); d.r(25 + xo, 26 + by, 5, 8, '#c4cbe6');
      d.r(23 + xo, 25 + by, 2, 11, METAL_S);
      d.p(20 + xo, 28 + by, LIGHTS[frame % 3]);
      d.o(rectPx(17 + xo, 37 + by, 4, 2), '#5b5f86'); d.o(rectPx(27 + xo, 37 + by, 4, 2), '#5b5f86');
      flame(Ly.fx, 18 + xo, 40 + by, frame); flame(Ly.fx, 28 + xo, 40 + by, frame + 1);
    }
  }
  function flame(fx, x, y, frame) {
    const h = 2 + (frame % 2);
    fx.f(rectPx(x, y, 2, h), '#ff8a3d'); fx.f(rectPx(x, y, 2, 1), '#ffe066'); if (h > 2) fx.p(x + (frame % 2), y + h, '#ffd23f');
  }
  function backSide(Ly, ch, by, frame, packX) {
    const d = Ly.body, k = ch.look && ch.look.back;
    if (k === 'cape') {
      const px = [];
      for (let y = 27; y <= 39; y++) {
        const w = (y + frame) % 3 === 0 ? 1 : 0;
        for (let x = Math.round(packX + 2 - (y - 27) * 0.45 - w); x <= packX + 4; x++) px.push([x, y + by]);
      }
      d.o(px, CAPE); d.shade(px, (x, y) => y > 36 + by, CAPE_S);
      return true;
    }
    if (k === 'jetpack') {
      d.o(roundPx(packX - 4, 24 + by, 8, 13), METAL);
      d.r(packX - 2, 26 + by, 3, 8, '#c4cbe6');
      d.o(rectPx(packX - 3, 37 + by, 4, 2), '#5b5f86');
      flame(Ly.fx, packX - 2, 40 + by, frame);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Crew body                                                          */
  /* ------------------------------------------------------------------ */
  const LIGHTS = ['#ff5d6c', '#ffd23f', '#5be37d'];

  function chest(d, ch, cx, y, frame) {
    const x = Math.round(cx - 0.5);
    switch (ch.chest) {
      case 'star':
        d.r(x - 3, y + 1, 7, 1, ch.shade);
        glyph(d, 'spark', x - 1, y, '#ffd23f', false); d.p(x, y + 1, '#fff4b8');
        d.p(x + 3, y + 3, LIGHTS[frame % 3]); break;
      case 'wrench':
        d.r(x - 3, y, 3, 1, '#d7dbe8'); d.r(x - 2, y + 1, 1, 3, '#d7dbe8'); d.p(x + 2, y + 1, LIGHTS[frame % 3]); break;
      case 'atom':
        d.r(x - 2, y + 1, 5, 1, ch.accent); d.r(x, y, 1, 3, ch.accent); d.p(x, y + 1, '#ffd23f'); break;
      case 'cross':
        d.r(x - 1, y + 1, 3, 1, '#ff5d6c'); d.r(x, y, 1, 3, '#ff5d6c'); break;
      case 'paw':
        d.r(x - 1, y + 2, 3, 1, '#ff9bb0'); d.p(x - 2, y + 1, '#ff9bb0'); d.p(x, y, '#ff9bb0'); d.p(x + 2, y + 1, '#ff9bb0'); break;
      case 'leaf':
        d.r(x, y, 2, 1, '#35b25a'); d.r(x - 1, y + 1, 3, 1, '#5be37d'); d.p(x - 2, y + 2, '#35b25a'); break;
      case 'shield':
        d.r(x - 1, y, 3, 2, '#ffd23f'); d.p(x, y + 2, '#ffd23f'); d.p(x, y, '#fff4b8'); break;
      default:
        d.r(x - 3, y, 7, 3, ch.shade);
        for (let i = 0; i < 3; i++) d.p(x - 2 + i * 2, y + 1, (frame + i) % 3 === 0 ? '#ffffff' : LIGHTS[i]);
    }
  }

  function headUnit(d, ch, view, hx, hy, face, frame, noNeck) {
    if (ch.helmet) d.o(ellPx(hx, hy, 10, 10), GLASS);
    HEADS[ch.head](d, view, hx, hy, face, frame);
    drawFaceAcc(d, ch, view, hx, hy, frame);
    if (ch.helmet) {
      const g = view === 'back' ? 1 : -1;
      d.p(hx + 6 * g, hy - 5, '#ffffff'); d.p(hx + 5 * g, hy - 6, '#ffffff'); d.p(hx + 7 * g, hy - 3, '#ffffff');
    }
    if (ch.antenna) {
      const s = view === 'back' ? -1 : 1;
      const bx = view === 'side' ? hx - 4 : hx + 6 * s, ex = view === 'side' ? hx - 6 : hx + 8 * s;
      d.o(linePx(bx, hy - 8, ex, hy - 13), '#9aa3c7');
      d.o([[Math.round(ex), hy - 14]], frame % 4 < 2 ? '#ff5d6c' : '#ffd23f');
    }
    d.o(rectPx(Math.round(hx - 6), hy + 8, 12, 3), ch.shade);
    d.r(Math.round(hx - 5), hy + 9, 10, 1, ch.accent);
    if (!noNeck) drawNeckAcc(d, ch, view, hx, hy, frame);
    const hat = ch.look && ch.look.hat;
    if (hat && hat !== 'none') {
      const top = ch.helmet ? hy - 10 : hy + (HEAD_TOP[ch.head] || -7);
      drawHat(d, hat, view, { hx: view === 'side' && !ch.helmet ? hx + 1 : hx, hy, R: ch.helmet ? 10 : 9, top }, frame, false);
    }
  }

  function armFront(d, ch, cx, by, side, mode, sw) {
    // left side geometry (relative to cx=23.5); right side mirrored
    const xo = cx - 23.5;
    let parts, glove;
    switch (mode) {
      case 'up': parts = [[13, 27, 4, 3], [11, 18, 3, 11]]; glove = [11, 16, 3, 2]; break;
      case 'out': parts = [[9, 28, 8, 3]]; glove = [7, 28, 2, 3]; break;
      case 'hip': parts = [[14, 28, 3, 4], [13, 31, 3, 3]]; glove = [15, 33, 2, 2]; break;
      default: parts = [[14, 28 + sw, 3, 7]]; glove = [14, 35 + sw, 3, 2];
    }
    const mx = (x, w) => side < 0 ? x + xo : Math.round(2 * cx + 1 - (x + xo) - w);
    const arm = union(...parts.map(([x, y, w, h]) => rectPx(mx(x, w), y + by, w, h)));
    d.o(arm, ch.suit);
    if (mode === 'down') d.r(mx(side < 0 ? 16 : 14, 1), 28 + by + sw, 1, 7, ch.shade);
    d.o(rectPx(mx(glove[0], glove[2]), glove[1] + by, glove[2], glove[3]), ch.glove);
  }

  function crewFront(Ly, ch, P, frame, back) {
    const d = Ly.body; const xo = P.dx || 0; const cx = 23.5 + xo; const by = P.by || 0;
    if (!P.noShadow) Ly.bg.f(ellPx(cx, 44.5, P.airborne ? 6 : 9, 1.6), 'rgba(10,6,30,0.32)');
    if (!back && !P.sit) backBehindFront(d, ch, xo, by);
    if (!back && !P.noLegs) tail(d, ch, 'front', xo, by, frame);
    // legs
    if (!P.noLegs && !P.sit) {
      const sp = P.spread || 0;
      [[19 + xo - sp, P.lLift || 0, -1], [25 + xo + sp, P.rLift || 0, 1]].forEach(([x, lift, s]) => {
        const top = 36 + by, bot = 41 - lift;
        if (bot > top) d.o(rectPx(x, top, 4, bot - top), ch.suit);
        d.o(rectPx(s < 0 ? x - 1 : x, 41 - lift, 5, 3), ch.boot);
        d.r(s < 0 ? x - 1 : x, 43 - lift, 5, 1, OUT);
      });
    }
    // torso
    const torso = roundPx(17 + xo, 27 + by, 14, 10);
    if (back) {
      d.o(torso, ch.suit);
      armFront(d, ch, cx, by, -1, P.lArm || 'down', P.lSw || 0);
      armFront(d, ch, cx, by, 1, P.rArm || 'down', P.rSw || 0);
      d.o(roundPx(18 + xo, 26 + by, 12, 10), ch.pack);
      d.r(20 + xo, 28 + by, 8, 1, ch.shade); d.r(20 + xo, 30 + by, 8, 1, ch.shade);
      d.p(21 + xo, 33 + by, LIGHTS[frame % 3]); d.p(26 + xo, 33 + by, LIGHTS[(frame + 1) % 3]);
      backOverBack(Ly, ch, xo, by, frame);
      tail(d, ch, 'back', xo, by, frame);
    } else {
      d.o(torso, ch.suit);
      d.r(29 + xo, 28 + by, 1, 6, ch.shade);
      d.r(18 + xo, 34 + by, 12, 1, ch.accent);
      chest(d, ch, cx, 29 + by, frame);
      armFront(d, ch, cx, by, -1, P.lArm || 'down', P.lSw || 0);
      armFront(d, ch, cx, by, 1, P.rArm || 'down', P.rSw || 0);
    }
    if (P.sit) {
      d.o(rectPx(16 + xo, 40, 16, 3), ch.suit);
      d.o(rectPx(13 + xo, 40, 3, 3), ch.boot); d.o(rectPx(32 + xo, 40, 3, 3), ch.boot);
      d.r(19 + xo, 40, 10, 1, ch.shade);
    }
    headUnit(d, ch, back ? 'back' : 'front', cx, 17 + by + (P.hy || 0), P.face, frame);
  }

  function crewSide(Ly, ch, P, frame) {
    const d = Ly.body; const by = P.by || 0;
    Ly.bg.f(ellPx(24, 44.5, 9, 1.6), 'rgba(10,6,30,0.32)');
    const fl = P.fLift || 0, bl = P.bLift || 0, fx = P.fLeg || 0, bx = P.bLeg || 0, fa = P.fArm || 0, ba = P.bArm || 0;
    tail(d, ch, 'side', 0, by, frame);
    d.o(rectPx(23 + ba, 28 + by, 3, 7), ch.shade);
    d.o(rectPx(23 + ba, 35 + by, 3, 2), ch.glove);
    const leg = (x, lift, col, boot) => {
      const top = 36 + by, bot = 41 - lift;
      if (bot > top) d.o(rectPx(x, top, 4, bot - top), col);
      d.o(rectPx(x, 41 - lift, 6, 3), boot); d.r(x, 43 - lift, 6, 1, OUT);
    };
    leg(22 + bx, bl, ch.shade, ch.boot);
    leg(22 + fx, fl, ch.suit, ch.boot);
    if (!backSide(Ly, ch, by, frame, 15)) {
      d.o(roundPx(15, 27 + by, 5, 9), ch.pack);
      d.p(16, 29 + by, LIGHTS[frame % 3]);
    }
    d.o(roundPx(19, 27 + by, 11, 10), ch.suit);
    d.r(20, 28 + by, 1, 6, ch.shade);
    d.r(20, 34 + by, 10, 1, ch.accent);
    d.o(rectPx(24 + fa, 28 + by, 3, 7), ch.suit);
    d.o(rectPx(24 + fa, 35 + by, 3, 2), ch.glove);
    headUnit(d, ch, 'side', 25, 17 + by, P.face, frame);
  }

  function crewWork(Ly, ch, frame) {
    const d = Ly.body;
    Ly.bg.f(ellPx(28, 44.5, 16, 1.8), 'rgba(10,6,30,0.32)');
    workChair(d);
    const tap = [[0, 1], [1, 0], [0, 0], [1, 1]][frame % 4];
    // back arm
    d.o(rectPx(23, 30, 9, 3), ch.shade);
    // legs (seated)
    d.o(rectPx(19, 35, 11, 4), ch.suit);
    d.o(rectPx(27, 37, 4, 4), ch.suit);
    d.o(rectPx(27, 41, 6, 3), ch.boot); d.r(27, 43, 6, 1, OUT);
    // pack + torso
    if (!backSide(Ly, ch, -1, frame, 13)) d.o(roundPx(13, 27, 5, 9), ch.pack);
    d.o(roundPx(17, 26, 11, 11), ch.suit);
    d.r(18, 27, 1, 7, ch.shade); d.r(18, 34, 10, 1, ch.accent);
    headUnit(d, ch, 'side', 23, 16, { eyes: frame === 3 ? 'half' : 'open', mouth: 'flat' }, frame);
    workDesk(d, frame, true, ch.accent);
    // front arm typing
    d.o(rectPx(24, 31, 8, 3), ch.suit);
    d.o(rectPx(32, 32 - tap[0], 2, 2), ch.glove);
    d.o(rectPx(30, 32 - tap[1], 2, 2), ch.glove);
  }

  function workChair(d) {
    d.o(union(rectPx(9, 27, 3, 13), rectPx(9, 38, 14, 2)), '#5b5f86');
    d.o(rectPx(15, 40, 2, 3), '#3d3f63');
    d.o(rectPx(11, 43, 10, 1), '#3d3f63');
  }
  function workDesk(d, frame, on, accent) {
    d.o(rectPx(30, 35, 18, 2), '#7d84ad');
    d.o(rectPx(43, 37, 3, 7), '#5b5f86');
    d.o(rectPx(39, 31, 2, 4), '#3d3f63');
    d.o(rectPx(34, 19, 13, 12), '#3d3f63');
    d.r(35, 20, 11, 10, '#102438');
    if (on) {
      const code = ['#5be37d', '#3fd0c9', '#ffd23f', '#ff8a3d', '#a575ff'];
      for (let r = 0; r < 4; r++) {
        const len = [6, 4, 8, 5, 7, 3][(r + frame) % 6];
        const ind = [0, 2, 2, 0, 4, 2][(r + frame) % 6];
        d.r(36 + ind, 21 + r * 2, Math.min(len, 9 - ind), 1, code[(r + frame) % code.length]);
      }
      d.p(36 + (frame % 2) * 2, 29, '#ffffff');
    } else {
      d.r(36, 21, 3, 1, '#1d3a5a'); d.r(36, 22, 1, 2, '#1d3a5a');
      d.p(45, 30, '#5be37d');
    }
    d.o(rectPx(32, 34, 7, 1), '#c9cee6');
    d.o(rectPx(44, 31, 3, 4), '#ffffff'); d.r(44, 32, 3, 1, accent || '#ff8a3d');
  }

  function crewSleep(Ly, ch, frame, face, bubble) {
    const d = Ly.body; const br = frame % 2;
    Ly.bg.f(ellPx(24, 44.5, 20, 1.8), 'rgba(10,6,30,0.32)');
    d.o(ellPx(12, 40, 9, 3.5), '#e6e8fb');
    headUnit(d, ch, 'front', 12.5, 30, face, frame, true);
    const bag = roundPx(19, 34 + br, 27, 10 - br);
    d.o(bag, ch.bag);
    d.r(19, 34 + br, 27, 2, ch.bagS);
    d.r(21, 35 + br, 24, 1, '#ffffff');
    for (const x of [27, 34, 41]) d.r(x, 37 + br, 1, 6 - br, ch.bagS);
    if (bubble) glyph(d, 'bang', 22, 14, '#ffd23f');
  }

  function crewSitUp(Ly, ch, frame, armsUp, face) {
    const d = Ly.body;
    Ly.bg.f(ellPx(24, 44.5, 20, 1.8), 'rgba(10,6,30,0.32)');
    d.o(ellPx(12, 41, 9, 3), '#e6e8fb');
    const P = { dx: -6, by: 4, noLegs: true, noShadow: true, lArm: armsUp ? 'up' : 'down', rArm: armsUp ? 'up' : 'down', face };
    crewFront({ body: d, bg: Ly.bg, fx: Ly.fx }, ch, P, frame, false);
    const bag = roundPx(11, 37, 35, 7);
    d.o(bag, ch.bag); d.r(11, 37, 35, 2, ch.bagS);
    for (const x of [27, 34, 41]) d.r(x, 39, 1, 4, ch.bagS);
  }

  /* ------------------------------------------------------------------ */
  /* Crew actions                                                       */
  /* ------------------------------------------------------------------ */
  const CREW_ACTIONS = {
    idle: { frames: 6, fps: 4, loop: true, dirs: ['front', 'back', 'left', 'right'] },
    walk: { frames: 4, fps: 8, loop: true, dirs: ['front', 'back', 'left', 'right'] },
    dance: { frames: 8, fps: 8, loop: true, dirs: ['front'] },
    rest: { frames: 4, fps: 3, loop: true, dirs: ['front'] },
    work: { frames: 4, fps: 6, loop: true, dirs: ['left', 'right'] },
    sleep: { frames: 4, fps: 2, loop: true, dirs: ['front'] },
    wakeup: { frames: 7, fps: 4, loop: false, dirs: ['front'] },
    exercise: { frames: 4, fps: 6, loop: true, dirs: ['front'] },
  };

  function drawCrew(Ly, ch, action, view, i) {
    const smile = { eyes: 'open', mouth: 'smile' };
    const fx = Ly.fx;
    if (action === 'idle') {
      const by = [0, 0, 1, 1, 1, 0][i];
      const face = { eyes: i === 5 ? 'closed' : 'open', mouth: 'smile' };
      if (view === 'side') return crewSide(Ly, ch, { by, face }, i);
      return crewFront(Ly, ch, { by, face }, i, view === 'back');
    }
    if (action === 'walk') {
      if (view === 'side') {
        const P = [
          { fLeg: 3, bLeg: -3, fArm: -2, bArm: 2, by: 0 },
          { fLeg: 0, bLeg: 0, bLift: 2, by: -1 },
          { fLeg: -3, bLeg: 3, fArm: 2, bArm: -2, by: 0 },
          { fLeg: 0, bLeg: 0, fLift: 2, by: -1 },
        ][i];
        P.face = smile; return crewSide(Ly, ch, P, i);
      }
      const P = [
        { lLift: 2, lSw: -1, rSw: 1, by: 0 }, { by: -1 },
        { rLift: 2, lSw: 1, rSw: -1, by: 0 }, { by: -1 },
      ][i];
      P.face = smile; return crewFront(Ly, ch, P, i, view === 'back');
    }
    if (action === 'dance') {
      const arms = [['up', 'down'], ['out', 'out'], ['down', 'up'], ['out', 'out'], ['up', 'up'], ['hip', 'hip'], ['up', 'up'], ['out', 'out']][i];
      const P = {
        lArm: arms[0], rArm: arms[1], by: [0, -1, 0, -1, 0, -2, 0, -1][i], dx: [-1, 0, 1, 0, -1, 0, 1, 0][i],
        lLift: i % 4 === 1 ? 2 : 0, rLift: i % 4 === 3 ? 2 : 0,
        face: { eyes: 'happy', mouth: i % 2 ? 'open' : 'smile' },
      };
      crewFront(Ly, ch, P, i, false);
      const notes = [[6, 10], [36, 6], [8, 4], [38, 12]];
      const [nx, ny] = notes[i % 4];
      glyph(fx, i % 2 ? 'note2' : 'note', nx, ny - (i % 2), i % 2 ? '#ffd23f' : '#5be3d1');
      return;
    }
    if (action === 'rest') {
      Ly.body.o(ellPx(23.5, 43, 13, 2.4), '#5b4b9a');
      const by = 6 + [0, 0, 1, 1][i];
      crewFront(Ly, ch, { by, sit: true, noShadow: true, lArm: 'down', rArm: 'out', face: { eyes: i < 2 ? 'half' : 'happy', mouth: 'smile' } }, i, false);
      const d = Ly.body;
      d.o(rectPx(38, 29 + by - 6, 4, 4), '#ffffff'); d.r(38, 30 + by - 6, 4, 1, ch.accent); d.p(42, 30 + by - 6, OUT);
      glyph(fx, 'steam', 38 + (i % 2), 22 - (i % 2) + by - 6, '#e6e8fb', false);
      glyph(fx, 'steam', 40 - (i % 2), 19 + (i % 2) + by - 6, '#e6e8fb', false);
      return;
    }
    if (action === 'work') return crewWork(Ly, ch, i);
    if (action === 'sleep') {
      crewSleep(Ly, ch, i, { eyes: 'closed', mouth: i % 2 ? 'flat' : 'smile' });
      const zs = [[26, 18, 'z'], [30, 12, 'Z'], [36, 5, 'Z']];
      for (let k = 0; k < 3; k++) {
        const [x, y, g] = zs[k]; if (k <= i % 4 || k === 0) glyph(fx, g, x + (i % 2), y - (i % 2), '#cfe3ff');
      }
      return;
    }
    if (action === 'wakeup') {
      switch (i) {
        case 0: return crewSleep(Ly, ch, 0, { eyes: 'closed', mouth: 'flat' });
        case 1: return crewSleep(Ly, ch, 1, { eyes: 'open', mouth: 'flat' }, true);
        case 2: return crewSitUp(Ly, ch, 2, false, { eyes: 'half', mouth: 'flat' });
        case 3: return crewSitUp(Ly, ch, 3, true, { eyes: 'closed', mouth: 'yawn' });
        default: {
          Ly.body.o(roundPx(27, 40, 20, 4), ch.bag); Ly.body.r(27, 40, 20, 1, ch.bagS);
          const P = i === 4 ? { lArm: 'up', rArm: 'up', by: -1, face: { eyes: 'closed', mouth: 'yawn' } }
            : { face: { eyes: i === 5 ? 'open' : 'happy', mouth: 'smile' } };
          crewFront(Ly, ch, P, i, false);
          if (i >= 5) { glyph(fx, 'spark', 8, 8 + (i - 5), '#ffd23f'); glyph(fx, 'spark2', 37, 5 + (6 - i), '#ffffff'); }
        }
      }
      return;
    }
    if (action === 'exercise') {
      const P = [
        { lArm: 'down', rArm: 'down', spread: 0, by: 0 },
        { lArm: 'out', rArm: 'out', spread: 2, by: -2, lLift: 2, rLift: 2, airborne: true },
        { lArm: 'up', rArm: 'up', spread: 3, by: 0 },
        { lArm: 'out', rArm: 'out', spread: 2, by: -2, lLift: 2, rLift: 2, airborne: true },
      ][i];
      P.face = { eyes: i === 2 ? 'happy' : 'open', mouth: i === 2 ? 'open' : 'flat' };
      crewFront(Ly, ch, P, i, false);
      if (i >= 2) glyph(fx, 'drop', 35, 9 + (i - 2) * 2, '#7fd8ff');
      if (i === 3) glyph(fx, 'drop', 9, 12, '#7fd8ff');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Pets                                                               */
  /* ------------------------------------------------------------------ */
  const PET_ACTIONS = {
    idle: { frames: 6, fps: 5, loop: true, dirs: ['front', 'back', 'left', 'right'] },
    walk: { frames: 4, fps: 8, loop: true, dirs: ['front', 'back', 'left', 'right'] },
    dance: { frames: 6, fps: 8, loop: true, dirs: ['front'] },
    play: { frames: 6, fps: 8, loop: true, dirs: ['front'] },
    sleep: { frames: 4, fps: 2, loop: true, dirs: ['front'] },
    wakeup: { frames: 6, fps: 4, loop: false, dirs: ['front'] },
  };

  function petState(action, i) {
    switch (action) {
      case 'idle': return { pose: 'stand', yoff: [0, 0, 1, 1, 0, 0][i], sq: [1, 1.04, 1.07, 1.04, 1, 0.97][i], eyes: i === 5 ? 'closed' : 'open', mouth: 'smile', wag: [0, 1, 0, -1, 0, 1][i] };
      case 'walk': return { pose: 'stand', walk: i, yoff: [0, -1, 0, -1][i], eyes: 'open', mouth: 'smile', wag: [1, 0, -1, 0][i] };
      case 'dance': return { pose: 'stand', yoff: [0, -3, -4, 0, -3, -4][i], sq: [0.82, 1.15, 1.08, 0.82, 1.15, 1.08][i], lean: [-1, -1, -1, 1, 1, 1][i], eyes: 'happy', mouth: i % 2 ? 'open' : 'smile', wag: [1, -1, 1, -1, 1, -1][i], tilt: [-1, -1, -1, 1, 1, 1][i] };
      case 'play': return { pose: 'stand', yoff: [0, -2, -3, -2, 0, 0][i], sq: [0.85, 1.1, 1.05, 1.1, 0.85, 1][i], eyes: i === 4 ? 'happy' : 'open', mouth: 'open', wag: [1, -1, 1, -1, 1, -1][i] };
      case 'sleep': return { pose: 'sleep', breath: i % 2, eyes: 'closed', mouth: 'flat' };
      case 'wakeup': return [
        { pose: 'sleep', breath: 0, eyes: 'closed', mouth: 'flat' },
        { pose: 'sleep', breath: 1, eyes: 'open', mouth: 'flat', bang: true },
        { pose: 'stand', yoff: 0, sq: 0.8, eyes: 'half', mouth: 'flat' },
        { pose: 'stand', yoff: -4, sq: 1.15, eyes: 'open', mouth: 'open' },
        { pose: 'stand', yoff: 0, sq: 0.9, eyes: 'happy', mouth: 'smile', sparkle: true, wag: 1 },
        { pose: 'stand', yoff: 0, sq: 1, eyes: 'open', mouth: 'smile', wag: -1 },
      ][i];
    }
  }

  const PET_DRAW = {
    blob(Ly, view, st, frame) {
      const d = Ly.body;
      let sq = st.sq || 1, yoff = st.yoff || 0;
      if (st.walk !== undefined) { sq = [0.82, 1.15, 1.06, 0.9][st.walk]; yoff = [0, -3, -5, -2][st.walk]; }
      let rx = 8 + (1 - sq) * 8, ry = 6 * sq;
      if (st.pose === 'sleep') { rx = 10; ry = 3.6 + st.breath * 0.4; yoff = 0; }
      const cx = 23.5 + (st.lean || 0), cy = 43.5 - ry + yoff;
      Ly.bg.f(ellPx(23.5, 44.5, Math.max(4, 8 + yoff * 0.6), 1.5), 'rgba(10,6,30,0.32)');
      const top = Math.round(cy - ry);
      Ly.anchor = { hx: cx, hy: cy, R: rx, top: top + 1 };
      const lean = view === 'side' ? -2 : view === 'back' ? 1 : 1;
      const base = Math.round(cx) + (st.hasHat ? (view === 'side' ? -5 : 5) : 0);
      const bulbX = base + lean + (st.hasHat ? (view === 'side' ? -1 : 1) : 0) + (frame % 2 ? 1 : 0);
      {
        d.o(linePx(base, Math.round(cy - ry * (st.hasHat ? 0.6 : 1)), bulbX, top - 4), '#2fb7a0');
        d.o(ellPx(bulbX, top - 5, 1.6, 1.6), st.pose === 'sleep' ? '#a59a52' : '#ffe066');
        if (st.pose !== 'sleep') Ly.bg.f(ellPx(bulbX, top - 5, 4, 4), 'rgba(255,224,102,0.18)');
      }
      const body = ellPx(cx, cy, rx, ry);
      d.o(body, '#47e0c4');
      d.shade(body, (x, y) => (y - cy) / ry + (x - cx) / rx * 0.3 > 0.5, '#2fb7a0');
      d.r(Math.round(cx - rx * 0.6), Math.round(cy - ry * 0.5), 2, 1, '#c9fff3');
      d.p(Math.round(cx - rx * 0.6), Math.round(cy - ry * 0.5) + 1, '#c9fff3');
      if (view === 'back') return;
      const ey = Math.round(cy - (st.pose === 'sleep' ? 0 : 1));
      if (view === 'front') {
        const xl = Math.round(cx - 4.5);
        if (st.eyes === 'open') { d.sym(cx, xl, ey - 1, 2, 3, OUT); d.p(xl, ey - 1, '#fff'); d.p(Math.round(2 * cx - xl - 1), ey - 1, '#fff'); }
        else eyePair(d, cx, xl - (st.eyes === 'happy' ? 1 : 0), ey, st.eyes === 'happy' ? 3 : 2, 2, st, OUT, '#2fb7a0');
        mouthFront(d, cx, ey + 3, st, 4, OUT, '#ff7a8a');
        d.sym(cx, xl - 2, ey + 2, 2, 1, '#ff9bc0');
      } else {
        const ex1 = Math.round(cx + 1), ex2 = Math.round(cx + 5);
        if (st.eyes === 'open') { d.r(ex1, ey - 1, 2, 3, OUT); d.r(ex2, ey - 1, 2, 3, OUT); d.p(ex1, ey - 1, '#fff'); d.p(ex2, ey - 1, '#fff'); }
        else { eyeOne(d, ex1, ey, 2, 2, st, OUT); eyeOne(d, ex2, ey, 2, 2, st, OUT); }
        mouthSide(d, ex1 + 1, ey + 3, st, 4);
      }
    },

    jelly(Ly, view, st, frame) {
      const d = Ly.body;
      const sleep = st.pose === 'sleep';
      const bob = sleep ? 0 : [0, -1, -1, 0, 1, 1][frame % 6];
      const cx = 23.5 + (st.lean || 0), cy = sleep ? 37 + st.breath : 29 + (st.yoff || 0) + bob;
      Ly.bg.f(ellPx(23.5, 44.5, sleep ? 9 : 5, 1.4), 'rgba(10,6,30,0.28)');
      Ly.bg.f(ellPx(cx, cy, 13, 11), sleep ? 'rgba(197,140,255,0.08)' : 'rgba(197,140,255,0.16)');
      const tent = [];
      [-4.5, -1.5, 1.5, 4.5].forEach((o, k) => {
        const len = sleep ? 4 : 9;
        for (let j = 0; j < len; j++) {
          let x = cx + o + Math.round(Math.sin((j * 0.9) + frame * 1.4 + k) * (j > 2 ? 1 : 0));
          if (view === 'side') x -= Math.round(j * 0.45);
          if (sleep) x += Math.round(o * j * 0.25);
          tent.push([Math.round(x), Math.round(cy + 3 + j)]);
        }
      });
      d.o(tent, '#ff9bd2');
      for (const [x, y] of tent) if (y > cy + 8 + (sleep ? -4 : 0)) d.p(x, y, '#ffd3ec');
      Ly.anchor = { hx: cx, hy: cy, R: 8, top: Math.round(cy - 6) };
      const dome = ellPx(cx, cy, 8, 7).filter(([, y]) => y <= cy + 2);
      d.o(dome, sleep ? '#a97ae0' : '#c58cff');
      d.shade(dome, (x, y) => y >= cy + 1, '#9a5fe0');
      d.shade(dome, (x, y) => y < cy - 3 && x < cx - 1 && x > cx - 6, '#e2c6ff');
      d.p(Math.round(cx + 3), Math.round(cy - 4), '#f3e3ff'); d.p(Math.round(cx + 5), Math.round(cy - 2), '#e2c6ff');
      const fr = [];
      for (let x = Math.round(cx - 7); x <= Math.round(cx + 7); x++) { fr.push([x, Math.round(cy + 3)]); if ((x + frame) % 2 === 0) fr.push([x, Math.round(cy + 4)]); }
      d.o(fr, '#e07ad0');
      if (view === 'back') return;
      const ey = Math.round(cy - 1);
      if (view === 'front') {
        eyePair(d, cx, Math.round(cx - 4), ey, 2, 2, st, OUT, '#9a5fe0');
        mouthFront(d, cx, ey + 3, st, 4);
        d.sym(cx, Math.round(cx - 6), ey + 2, 2, 1, '#ff9bd2');
      } else {
        eyeOne(d, Math.round(cx + 3), ey, 2, 2, st, OUT, '#9a5fe0');
        mouthSide(d, Math.round(cx + 4), ey + 3, st, 3);
      }
    },

    pup(Ly, view, st, frame) {
      const d = Ly.body;
      const B = '#c3bdf2', BS = '#958ed6', SP = '#a59ee0', EAR = '#8279c4', SN = '#e9e6ff', RED = '#ff5d6c', GOLD = '#ffd23f';
      const y = st.yoff || 0, wag = st.wag || 0;
      if (st.pose === 'sleep') {
        Ly.bg.f(ellPx(23.5, 44.5, 12, 1.6), 'rgba(10,6,30,0.32)');
        d.o(ellPx(21, 40 - st.breath * 0.5, 9, 4 + st.breath * 0.4), B);
        d.r(16, 38, 2, 1, SP); d.p(21, 37, SP); d.r(24, 40, 2, 1, SP);
        d.o(linePx(13, 42, 9, 38), B); d.p(9, 38, '#ffffff');
        d.o(rectPx(28, 36, 2, 4), EAR);
        d.o(ellPx(32, 39.5, 5, 4.2), B);
        Ly.anchor = { hx: 32, hy: 39.5, R: 5, top: 36 };
        d.p(30, 37, SP); d.r(28, 41, 2, 1, '#ff9bc0');
        d.o(ellPx(36, 41, 2.4, 1.8), SN); d.p(38, 40, OUT);
        if (st.eyes === 'open') { d.r(32, 38, 2, 2, OUT); d.p(32, 38, '#ffffff'); } else d.r(31, 39, 3, 1, OUT);
        if (!st.hasHat) { d.o(linePx(30, 36, 33, 33), BS); d.o([[34, 32]], '#a59a52'); }
        if (st.bang) glyph(Ly.fx, 'bang', 33, 22, GOLD);
        return;
      }
      Ly.bg.f(ellPx(23.5, 44.5, 10, 1.6), 'rgba(10,6,30,0.32)');
      const w = st.walk;
      if (view === 'side') {
        const liftA = w === 0 ? 2 : 0, liftB = w === 2 ? 2 : 0;
        const fwd = w === undefined ? 0 : [1, 0, -1, 0][w];
        [[17, liftB], [22, liftA], [27, liftB]].forEach(([x, l]) => d.o(rectPx(x + 1 - fwd, 40 + y, 2, 44 - l - (40 + y)), BS));
        d.o(linePx(15, 37 + y, 11, 33 + y - wag), B); d.p(11, 33 + y - wag, '#ffffff');
        const body = ellPx(22, 38 + y, 8, 4);
        d.o(body, B); d.shade(body, (x, yy) => yy > 40 + y, BS);
        d.r(17, 37 + y, 2, 1, SP); d.p(22, 36 + y, SP); d.r(24, 39 + y, 2, 1, SP);
        [[16, liftA], [21, liftB], [26, liftA]].forEach(([x, l]) => { d.o(rectPx(x + fwd, 41 + y, 2, 43 - l - (41 + y)), B); d.r(x + fwd, 43 - l, 2, 1, OUT); });
        if (!st.hasHat) { d.o(linePx(29, 29 + y, 31, 25 + y), BS); glyph(d, 'spark', 30, 22 + y, GOLD); }
        Ly.anchor = { hx: 30, hy: 33 + y, R: 5, top: 29 + y };
        const head = ellPx(30, 33 + y, 5, 4.6);
        d.o(head, B); d.shade(head, (x, yy) => yy > 36 + y, BS);
        d.o(ellPx(34, 35 + y, 2.6, 2), SN);
        d.p(36, 34 + y, OUT);
        eyeOne(d, 31, 32 + y, 1, 2, st, OUT);
        d.o(rectPx(27, 30 + y + (w === 1 || w === 3 ? 1 : 0), 2, 5), EAR);
        d.r(27, 37 + y, 3, 1, RED); d.p(28, 38 + y, GOLD);
        if (st.mouth === 'open') d.p(34, 37 + y, '#ff7a9a');
        return;
      }
      const lL = w === 0 ? 2 : 0, rL = w === 2 ? 2 : 0;
      if (view === 'back') {
        d.o(rectPx(16, 40 + y, 2, 4), BS); d.o(rectPx(30, 40 + y, 2, 4), BS);
        d.o(ellPx(23.5, 32 + y, 6, 5), B);
        d.o(rectPx(16, 30 + y, 3, 6), EAR); d.o(rectPx(29, 30 + y, 3, 6), EAR);
        if (!st.hasHat) { d.o(linePx(24, 27 + y, 24, 25 + y), BS); glyph(d, 'spark', 23, 22 + y, GOLD); }
        Ly.anchor = { hx: 23.5, hy: 32 + y, R: 6, top: 28 + y };
        const body = ellPx(23.5, 38 + y, 7.5, 4.5);
        d.o(body, B); d.shade(body, (x, yy) => yy > 40 + y, BS);
        d.r(19, 37 + y, 2, 1, SP); d.p(27, 39 + y, SP);
        d.o(rectPx(19, 41 + y, 3, 3 - lL), B); d.o(rectPx(26, 41 + y, 3, 3 - rL), B);
        d.o(linePx(24, 37 + y, 24 + wag * 2, 31 + y), B); d.p(24 + wag * 2, 31 + y, '#ffffff');
        return;
      }
      d.o(linePx(28, 38 + y, 32 + wag, 33 + y), B); d.p(32 + wag, 33 + y, '#ffffff');
      d.o(rectPx(15, 41 + y, 3, 3), BS); d.o(rectPx(30, 41 + y, 3, 3), BS);
      const body = ellPx(23.5, 39.5 + y, 7, 3.6);
      d.o(body, B); d.shade(body, (x, yy) => yy > 41 + y, BS);
      d.o(rectPx(19, 42 - lL, 4, 2), B); d.o(rectPx(25, 42 - rL, 4, 2), B);
      if (!st.hasHat) { d.o(linePx(24, 27 + y, 24, 25 + y), BS); glyph(d, 'spark', 23, 22 + y, GOLD); }
      Ly.anchor = { hx: 23.5, hy: 33 + y, R: 6.6, top: 28 + y };
      const head = ellPx(23.5, 33 + y, 6.6, 5.4);
      d.o(head, B); d.shade(head, (x, yy) => yy > 36 + y, BS);
      d.o(rectPx(15, 31 + y, 2, 5), EAR); d.o(rectPx(31, 31 + y, 2, 5), EAR);
      d.p(19, 30 + y, SP); d.p(28, 30 + y, SP); d.p(27, 29 + y, SP);
      d.o(ellPx(23.5, 36 + y, 2.6, 1.6), SN);
      d.r(23, 35 + y, 2, 1, OUT);
      if (st.eyes === 'open') { d.sym(23.5, 19, 32 + y, 2, 2, OUT); d.p(19, 32 + y, '#ffffff'); d.p(27, 32 + y, '#ffffff'); }
      else eyePair(d, 23.5, 19, 32 + y, 3, 2, st, OUT);
      d.sym(23.5, 17, 35 + y, 2, 1, '#ff9bc0');
      d.r(21, 38 + y, 6, 1, RED); d.p(23, 39 + y, GOLD); d.p(24, 39 + y, GOLD);
      if (st.mouth === 'open') d.r(23, 37 + y, 2, 1, '#ff7a9a');
    },

    planet(Ly, view, st, frame) {
      const d = Ly.body; const sleep = st.pose === 'sleep';
      const cx = 23.5 + (st.lean || 0), cy = sleep ? 38 + st.breath * 0.5 : 35 + (st.yoff || 0);
      Ly.bg.f(ellPx(23.5, 44.5, 9, 1.6), 'rgba(10,6,30,0.32)');
      const w = st.walk;
      if (!sleep) {
        const lL = w === 0 ? 1 : 0, rL = w === 2 ? 1 : 0;
        const fx = view === 'side' ? 2 : 0;
        d.o(rectPx(Math.round(cx - 4) + fx, 41 + Math.min(0, st.yoff || 0) - lL, 3, 3), '#6b3f5a');
        d.o(rectPx(Math.round(cx + 2) - fx, 41 + Math.min(0, st.yoff || 0) - rL, 3, 3), '#6b3f5a');
      }
      const tilt = sleep ? 2 : (st.tilt !== undefined ? st.tilt : (w !== undefined ? [-1, 0, 1, 0][w] : [0, 0, 1, 1, 0, 0][frame % 6] * 0.5));
      const rcy = cy + 3, rx = 12, ry = view === 'side' ? 1.8 : 2.8;
      const ring = [], ringBack = [];
      for (let y = Math.floor(rcy - 8); y <= rcy + 8; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const yy = y - tilt * (x - cx) / rx * 2;
        const e = ((x - cx) / rx) ** 2 + ((yy - rcy) / ry) ** 2;
        if (e <= 1 && e >= 0.45) (yy < rcy ? ringBack : ring).push([x, y]);
      }
      d.o(ringBack, '#4fb6dc');
      Ly.anchor = { hx: cx, hy: cy, R: 6.6, top: Math.round(cy - 6) };
      const sph = ellPx(cx, cy, 6.6, 6.6);
      d.o(sph, sleep ? '#e88d4f' : '#ff9f5a');
      d.shade(sph, (x, y) => y === Math.round(cy) - 4 || y === Math.round(cy) - 3 && x > cx, '#ffd27a');
      d.shade(sph, (x, y) => (x - cx) / 6.6 * 0.5 + (y - cy) / 6.6 > 0.55, '#e0703a');
      d.r(Math.round(cx - 4), Math.round(cy - 2), 1, 2, '#ffe1c4');
      if (view !== 'back') {
        const ey = Math.round(cy - 1);
        if (view === 'front') {
          if (st.eyes === 'open') { d.sym(cx, Math.round(cx - 3.5), ey - 1, 2, 2, OUT); d.p(Math.round(cx - 3.5), ey - 1, '#fff'); d.p(Math.round(2 * cx - Math.round(cx - 3.5) - 1), ey - 1, '#fff'); }
          else eyePair(d, cx, Math.round(cx - 4), ey - 1, 3, 2, st, OUT, '#e0703a');
          mouthFront(d, cx, ey + 2, st, 4);
          d.sym(cx, Math.round(cx - 5), ey + 1, 2, 1, '#ff6f8f');
        } else {
          eyeOne(d, Math.round(cx + 1), ey - 1, 2, 2, st, OUT, '#e0703a');
          eyeOne(d, Math.round(cx + 4), ey - 1, 2, 2, st, OUT, '#e0703a');
          mouthSide(d, Math.round(cx + 2), ey + 2, st, 3);
        }
      }
      d.o(ring, '#8fe3ff');
      for (const [x, y] of ring) if ((x + y + frame) % 5 === 0) d.p(x, y, '#ffffff');
      if (!sleep) {
        const a = frame * 1.1;
        const mx = Math.round(cx + Math.cos(a) * 15), my = Math.round(cy - 9 + Math.sin(a) * 3);
        Ly.fx.o(ellPx(mx, my, 1.6, 1.6), '#ddd8ee'); Ly.fx.p(mx - 1, my, '#b3abd0');
      } else {
        Ly.fx.o(ellPx(Math.round(cx + 11), 42, 1.6, 1.6), '#b3abd0');
      }
    },
  };

  function drawPet(Ly, pet, action, view, i) {
    const st = Object.assign({}, petState(action, i));
    const hat = pet.look && pet.look.hat;
    st.hasHat = !!hat && hat !== 'none';
    PET_DRAW[pet.draw](Ly, view, st, i);
    if (st.hasHat && Ly.anchor) drawHat(Ly.body, hat, view, Ly.anchor, i, true);
    const fx = Ly.fx;
    if (st.pose === 'sleep' && action === 'sleep') {
      const zs = [[30, 24, 'z'], [34, 18, 'z'], [38, 11, 'Z']];
      for (let k = 0; k <= Math.min(2, i); k++) glyph(fx, zs[k][2], zs[k][0] + (i % 2), zs[k][1] - (i % 2), '#cfe3ff');
    }
    if (st.bang && pet.draw !== 'pup') glyph(fx, 'bang', 32, 18, '#ffd23f');
    if (st.sparkle) { glyph(fx, 'spark', 10, 22, '#ffd23f'); glyph(fx, 'spark2', 35, 18, '#ffffff'); }
    if (action === 'dance') {
      glyph(fx, i % 2 ? 'heart' : 'note', [8, 34, 10, 33, 7, 35][i], [18, 14, 12, 20, 16, 11][i], i % 2 ? '#ff7aa8' : '#5be3d1');
    }
    if (action === 'play') {
      const bx = [16, 19, 23, 27, 30, 27][i], by = [26, 15, 10, 15, 26, 30][i];
      fx.o(ellPx(bx, by, 2.2, 2.2), '#ffd23f'); fx.p(bx - 1, by - 1, '#fff6c4'); fx.p(bx + 1, by + 1, '#ff8a3d');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                         */
  /* ------------------------------------------------------------------ */
  const ALL = {};
  for (const [id, c] of Object.entries(CREW)) ALL[id] = Object.assign({ id, kind: 'crew' }, c);
  for (const [id, p] of Object.entries(PETS)) ALL[id] = Object.assign({ id, kind: 'pet' }, p);

  function actionsFor(id) { return ALL[id].kind === 'crew' ? CREW_ACTIONS : PET_ACTIONS; }

  /** What each character can wear: { slot: [choice, …] } */
  function options(id) {
    const ch = ALL[id];
    if (ch.kind === 'crew') return JSON.parse(JSON.stringify(CREW_SLOTS));
    const colors = Object.keys(PET_COLORS[id]).filter(k => k !== 'base');
    return { color: ['default', ...colors], hat: PET_HATS.slice() };
  }
  function label(slot, value) { return (LABELS[slot] && LABELS[slot][value]) || value; }
  function swatch(id, slot, value) {
    if (slot === 'suit') return value === 'default' ? ALL[id].suit : SUIT_SWATCH[value];
    if (slot === 'color') { const P = PET_COLORS[id]; return (value === 'default' ? P.base : P[value])[0]; }
    return null;
  }
  function cleanLook(id, look) {
    if (!look) return {};
    const opt = options(id), out = {};
    for (const k of Object.keys(opt)) if (look[k] && look[k] !== 'none' && look[k] !== 'default' && opt[k].includes(look[k])) out[k] = look[k];
    return out;
  }
  const lookKey = look => Object.keys(look).sort().map(k => k + '=' + look[k]).join(',');
  function dressed(id, look) {
    const base = ALL[id], ch = Object.assign({}, base, { look });
    if (base.kind === 'crew' && look.suit && SUITS[look.suit]) Object.assign(ch, SUITS[look.suit]);
    return ch;
  }

  function renderLayers(id, action, dir, i, look) {
    if (!ALL[id]) throw new Error('Unknown character ' + id);
    look = cleanLook(id, look);
    const ch = dressed(id, look);
    const A = actionsFor(id)[action]; if (!A) throw new Error(id + ' has no action ' + action);
    if (!A.dirs.includes(dir)) dir = A.dirs.includes('front') ? 'front' : A.dirs[A.dirs.length - 1];
    i = ((i % A.frames) + A.frames) % A.frames;
    const raw = { bg: new Layer(), body: new Layer(), fx: new Layer() };
    const Ly = { bg: painter(raw.bg), body: painter(raw.body), fx: painter(raw.fx) };
    const view = dir === 'left' || dir === 'right' ? 'side' : dir;
    if (ch.kind === 'crew') drawCrew(Ly, ch, action, view, i);
    else {
      drawPet(Ly, ch, action, view, i);
      if (look.color && PET_COLORS[id][look.color]) {
        const from = PET_COLORS[id].base, to = PET_COLORS[id][look.color], map = {};
        from.forEach((c, k) => { map[c] = to[k]; });
        raw.body.p = raw.body.p.map(c => (c && map[c]) || c);
        raw.fx.p = raw.fx.p.map(c => (c && map[c]) || c);
      }
    }
    if (dir === 'left') { raw.bg.flip(); raw.body.flip(); raw.fx.flip(); }
    return raw;
  }

  const cache = new Map();
  function frameCanvas(id, action, dir, i, look) {
    const A = actionsFor(id)[action];
    const fi = ((i % A.frames) + A.frames) % A.frames;
    const lk = cleanLook(id, look);
    const key = id + '|' + action + '|' + dir + '|' + fi + '|' + lookKey(lk);
    let c = cache.get(key);
    if (c) return c;
    const raw = renderLayers(id, action, dir, fi, lk);
    c = document.createElement('canvas'); c.width = S; c.height = S;
    const g = c.getContext('2d');
    for (const layer of [raw.bg, raw.body, raw.fx]) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const col = layer.p[y * S + x];
        if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }
    }
    if (cache.size > 6000) cache.clear();
    cache.set(key, c);
    return c;
  }

  /** Draw a frame. (x, y) is the top-left of the 48×48 frame; feet sit at (x+24*scale, y+44*scale).
   *  look (optional): { suit, hat, face, neck, back } for crew, { color, hat } for pets. */
  function draw(ctx, id, action, dir, i, x, y, scale = 1, look) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frameCanvas(id, action, dir, i, look), Math.round(x), Math.round(y), S * scale, S * scale);
  }

  /** Build a sprite sheet: one row per action+direction, one column per frame. */
  function sheet(id, look) {
    const acts = actionsFor(id);
    const rows = [];
    for (const [a, def] of Object.entries(acts)) for (const dir of def.dirs) rows.push({ a, dir, def });
    const cols = Math.max(...rows.map(r => r.def.frames));
    const c = document.createElement('canvas'); c.width = cols * S; c.height = rows.length * S;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const atlas = { character: id, name: ALL[id].name, look: cleanLook(id, look), frameWidth: S, frameHeight: S, anchor: { x: 24, y: 44 }, animations: {} };
    rows.forEach((r, ri) => {
      for (let f = 0; f < r.def.frames; f++) g.drawImage(frameCanvas(id, r.a, r.dir, f, look), f * S, ri * S);
      atlas.animations[r.a + '_' + r.dir] = { row: ri, y: ri * S, frames: r.def.frames, fps: r.def.fps, loop: r.def.loop };
    });
    return { canvas: c, atlas };
  }

  /** Furniture that matches the sprites exactly: 'desk' is the empty workstation
   *  that a 'work' frame sits in, so it can stand in the room while nobody is working. */
  function prop(name, dir = 'right') {
    const key = 'prop|' + name + '|' + dir;
    let c = cache.get(key); if (c) return c;
    const L = new Layer(), d = painter(L);
    if (name === 'desk') { d.f(ellPx(28, 44.5, 16, 1.8), 'rgba(10,6,30,0.32)'); workChair(d); workDesk(d, 0, false); }
    if (dir === 'left') L.flip();
    c = document.createElement('canvas'); c.width = S; c.height = S;
    const g = c.getContext('2d');
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const col = L.p[y * S + x]; if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } }
    cache.set(key, c); return c;
  }

  /** Pick a random outfit (each slot has a fair chance of staying empty). */
  function randomLook(id) {
    const opt = options(id), look = {};
    for (const [k, v] of Object.entries(opt)) { const pick = v[Math.floor(Math.random() * v.length)]; if (Math.random() < 0.75) look[k] = pick; }
    return cleanLook(id, look);
  }

  const API = {
    FRAME: S, OUTLINE: OUT,
    characters: ALL,
    crew: Object.keys(CREW), pets: Object.keys(PETS),
    actions: id => actionsFor(id),
    anim: (id, action) => actionsFor(id)[action],
    options, label, swatch, cleanLook, randomLook,
    renderLayers, frameCanvas, draw, sheet, prop,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.Starcrew = API;
})(typeof window !== 'undefined' ? window : globalThis);
