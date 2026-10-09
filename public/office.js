/*!
 * Starcrew office: draws the pixel office and moves each crew member according
 * to what their agent is really doing (sent live from the server).
 */
(function (global) {
  'use strict';
  function createOffice(canvas, overlay, opts = {}) {
    const SC = global.Starcrew;
    const W = 480, H = 240, WALL = 76, INK = '#1b1432';
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d'); g.imageSmoothingEnabled = false;
    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const frameAt = (id, action, t) => { const A = SC.anim(id, action); const f = Math.floor(t * A.fps); return A.loop ? f % A.frames : Math.min(f, A.frames - 1); };
    const reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // tiny pixel painter shared by the background and the props
    const R = (c2, x, y, w, h, c) => { c2.fillStyle = c; c2.fillRect(x, y, w, h); };
    const BOX = (c2, x, y, w, h, c) => { R(c2, x - 1, y - 1, w + 2, h + 2, INK); R(c2, x, y, w, h, c); };
    const ellPts = (cx, cy, rx, ry) => { const p = []; for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) p.push([x, y]); return p; };
    function shape(c2, pts, fill) {
      const own = new Set(pts.map(([x, y]) => y * 4096 + x));
      c2.fillStyle = INK;
      for (const [x, y] of pts) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!own.has((y + dy) * 4096 + x + dx)) c2.fillRect(x + dx, y + dy, 1, 1);
      c2.fillStyle = fill; for (const [x, y] of pts) c2.fillRect(x, y, 1, 1);
    }
    const mk = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d')); return c; };
    const line = (c2, x0, y0, x1, y1, c) => {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
      c2.fillStyle = c;
      for (;;) { c2.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    };

    // activity spots (feet positions)
    const DESKS = [[36, 118], [108, 118], [36, 168], [108, 168], [36, 220], [108, 220]].map(([x, y]) => ({ x, y, by: null }));
    const PODS = [[378, 152], [446, 152], [378, 194], [446, 194], [378, 236], [446, 236]].map(([x, y]) => ({ x, y, by: null }));
    const ZONES = {
      rug: { x: [222, 300], y: [154, 168] }, gym: { x: [206, 284], y: [112, 114] },
      lounge: { x: [214, 306], y: [224, 232] }, pantry: { x: [356, 408], y: [96, 112] },
      any: { x: [24, 456], y: [92, 234] },
    };
    const spot = z => ({ x: Math.round(rand(...ZONES[z].x)), y: Math.round(rand(...ZONES[z].y)) });

    const stars = [];
    const bgc = mk(W, H, b => {
      // wall + ceiling
      R(b, 0, 0, W, WALL, '#1d1842');
      for (let x = 0; x < W; x += 48) R(b, x, 4, 1, 54, '#241e4e');
      R(b, 0, 0, W, 4, '#2e2858');
      for (const lx of [40, 120, 200, 280, 360, 440]) {
        R(b, lx - 8, 4, 16, 2, '#fff1c4'); R(b, lx - 8, 6, 16, 1, '#c9b98a');
        for (let j = 0; j < 14; j++) R(b, lx - 8 - j, 7 + j, 16 + j * 2, 1, 'rgba(255,240,200,' + (0.05 - j * 0.003).toFixed(3) + ')');
      }
      R(b, 0, 58, W, 14, '#221d4b'); R(b, 0, 58, W, 1, '#2e2858');
      R(b, 0, 72, W, 4, '#2e2858'); R(b, 0, WALL, W, 1, INK);
      // windows
      const win = (x, y, w, h, mull) => {
        BOX(b, x - 2, y - 2, w + 4, h + 4, '#3a3470'); R(b, x - 1, y - 1, w + 2, h + 2, INK); R(b, x, y, w, h, '#070514');
        for (let i = 0; i < w * h / 70; i++) stars.push({ x: x + Math.floor(Math.random() * w), y: y + Math.floor(Math.random() * h), p: Math.random() * 6, b: Math.random() < 0.2 });
        if (mull) { R(b, x + Math.floor(w / 2), y, 1, h, '#3a3470'); }
        R(b, x, y + h, w, 1, '#4b4f8f');
      };
      win(8, 10, 52, 28, true); win(68, 10, 52, 28, true); win(378, 10, 70, 26, false);
      b.fillStyle = 'rgba(165,117,255,0.2)'; b.fillRect(20, 18, 20, 10); b.fillRect(26, 14, 24, 16); b.fillStyle = 'rgba(255,138,61,0.14)'; b.fillRect(32, 20, 14, 6);
      for (const [x, y] of ellPts(100, 22, 5, 5)) { b.fillStyle = x + y < 120 ? '#d9d4ee' : '#a7a0cc'; b.fillRect(x, y, 1, 1); }
      b.fillStyle = '#8a83b8'; b.fillRect(99, 20, 2, 2); b.fillRect(102, 24, 1, 1);
      for (const [x, y] of ellPts(430, 30, 13, 13)) if (y < 36 && x < 448) { b.fillStyle = y < 23 ? '#ffd27a' : (x + y > 465 ? '#e0703a' : '#ff9f5a'); if (y === 27 || y === 31) b.fillStyle = '#ffb877'; b.fillRect(x, y, 1, 1); }
      b.fillStyle = '#8fe3ff'; for (let x = -22; x <= 17; x++) { const yy = 31 + Math.round(x * 0.2); if ((Math.abs(x) > 12 || yy > 32) && yy < 36) b.fillRect(430 + x, yy, 1, 1); }
      // clock face (hands are drawn live)
      shape(b, ellPts(140, 24, 9, 9), '#7d84ad'); for (const [x, y] of ellPts(140, 24, 7.5, 7.5)) R(b, x, y, 1, 1, '#eef1fb');
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; R(b, Math.round(140 + Math.sin(a) * 6), Math.round(24 - Math.cos(a) * 6), 1, 1, k % 3 ? '#b4bddb' : INK); }
      // mission board screen (contents drawn live)
      BOX(b, 160, 8, 140, 44, '#2b2a55'); R(b, 163, 11, 134, 38, '#0b1530'); R(b, 228, 52, 4, 6, '#2b2a55'); R(b, 222, 57, 16, 2, '#2b2a55');
      // bulletin board
      BOX(b, 306, 12, 52, 22, '#7a4a2a'); R(b, 308, 14, 48, 18, '#b07a4a');
      for (let i = 0; i < 40; i++) R(b, 308 + Math.floor(Math.random() * 48), 14 + Math.floor(Math.random() * 18), 1, 1, '#a06c40');
      [[311, 16, '#ffe066'], [321, 19, '#ff9bc0'], [342, 16, '#7fd8ff'], [348, 23, '#a8e05a'], [312, 25, '#7fd8ff']].forEach(([x, y, c]) => { R(b, x, y, 7, 6, c); R(b, x + 1, y + 2, 5, 1, 'rgba(27,20,50,0.35)'); R(b, x + 1, y + 4, 3, 1, 'rgba(27,20,50,0.35)'); R(b, x + 3, y, 1, 1, '#ff5d6c'); });
      R(b, 330, 15, 9, 11, '#ffffff'); R(b, 331, 16, 7, 6, '#62d36a'); R(b, 332, 17, 2, 2, '#ffffff'); R(b, 335, 17, 2, 2, '#ffffff'); R(b, 333, 20, 3, 1, INK);
      // filing cabinet
      BOX(b, 6, 46, 20, 29, '#7d84ad'); for (const y of [55, 64]) R(b, 6, y, 20, 1, '#5b5f86'); for (const y of [50, 59, 68]) R(b, 13, y, 6, 1, '#c9cee6');
      // bookshelf
      BOX(b, 30, 40, 36, 35, '#6b4a3a'); R(b, 32, 42, 32, 31, '#3a2a2a');
      const bookC = ['#ff5d6c', '#3fd0c9', '#ffd23f', '#a575ff', '#62d36a', '#ff8a3d', '#7fd8ff', '#eef1fb'];
      for (const sy of [42, 53, 64]) { let x = 33; while (x < 62) { const w = 2 + Math.floor(Math.random() * 2), h = 6 + Math.floor(Math.random() * 3); R(b, x, sy + 10 - h, w, h, bookC[Math.floor(Math.random() * bookC.length)]); x += w + (Math.random() < 0.2 ? 2 : 0); } R(b, 32, sy + 10, 32, 1, '#6b4a3a'); }
      R(b, 52, 43, 6, 6, '#ff9f5a'); R(b, 51, 46, 8, 1, '#8fe3ff');
      // printer
      BOX(b, 72, 62, 28, 13, '#5b5f86'); R(b, 72, 68, 28, 1, '#3d3f63');
      BOX(b, 74, 51, 24, 10, '#d7dbe8'); R(b, 76, 49, 18, 2, '#ffffff'); R(b, 78, 55, 14, 2, '#3d3f63'); R(b, 76, 52, 8, 1, '#b4bddb');
      // tall plant
      const tallPlant = (x, y) => {
        for (const [lx, ly, h] of [[x + 2, y - 18, 14], [x + 5, y - 24, 20], [x + 8, y - 20, 16], [x + 11, y - 15, 11]]) { R(b, lx - 1, ly - 1, 4, h + 2, INK); }
        for (const [lx, ly, h] of [[x + 2, y - 18, 14], [x + 5, y - 24, 20], [x + 8, y - 20, 16], [x + 11, y - 15, 11]]) { R(b, lx, ly, 2, h, '#5be37d'); R(b, lx, ly, 1, h, '#35b25a'); }
        BOX(b, x + 1, y - 6, 13, 9, '#ff8a3d'); R(b, x + 1, y - 6, 13, 2, '#ffb07a');
      };
      tallPlant(104, 72);
      // water cooler
      BOX(b, 128, 58, 13, 17, '#d7dbe8'); R(b, 131, 62, 3, 2, '#3fd0c9'); R(b, 135, 62, 3, 2, '#ff5d6c'); R(b, 129, 70, 11, 1, '#b4bddb');
      BOX(b, 130, 43, 9, 14, '#7fd8ff'); R(b, 131, 44, 2, 12, '#c8f0ff'); R(b, 132, 41, 5, 2, '#3f8cff');
      // credenza under the board
      BOX(b, 166, 62, 128, 13, '#4a3f86'); R(b, 166, 62, 128, 2, '#5a4bb0'); for (const x of [198, 230, 262]) R(b, x, 64, 1, 11, '#3a2f74');
      R(b, 172, 54, 6, 8, '#ffd23f'); R(b, 170, 52, 10, 3, '#ffd23f'); R(b, 174, 61, 2, 1, '#d9a91c'); R(b, 171, 50, 1, 2, '#ffd23f'); R(b, 178, 50, 1, 2, '#ffd23f');
      for (const [x, y] of ellPts(280, 56, 4, 4)) R(b, x, y, 1, 1, (x + y) % 3 ? '#3f8cff' : '#5be37d'); R(b, 279, 60, 2, 2, '#7d84ad');
      R(b, 250, 56, 8, 6, '#eef1fb'); R(b, 251, 57, 6, 1, '#b4bddb'); R(b, 251, 59, 4, 1, '#b4bddb');
      // jukebox
      BOX(b, 306, 42, 20, 33, '#6b2f6b'); for (const [x, y] of ellPts(316, 44, 10, 6)) if (y < 44) R(b, x, y, 1, 1, '#6b2f6b');
      R(b, 309, 52, 14, 8, '#0b1530'); R(b, 309, 64, 14, 6, '#3a2f74'); for (let x = 310; x < 322; x += 2) R(b, x, 65, 1, 4, '#9aa3c7');
      // vending machine
      BOX(b, 330, 36, 26, 39, '#3f8cff'); R(b, 330, 36, 26, 2, '#7fb0ff');
      R(b, 333, 40, 15, 26, '#0b1530');
      const snack = ['#ff5d6c', '#ffd23f', '#5be37d', '#ff8a3d', '#a575ff'];
      for (let r = 0; r < 4; r++) { for (let k = 0; k < 4; k++) R(b, 334 + k * 4, 42 + r * 6, 2, 4, snack[(r + k) % 5]); R(b, 333, 46 + r * 6, 15, 1, '#2b3a66'); }
      R(b, 350, 42, 4, 8, '#d7dbe8'); R(b, 351, 44, 2, 1, INK); R(b, 351, 47, 2, 1, INK); R(b, 334, 68, 13, 4, INK);
      // pantry counter + appliances + fridge
      BOX(b, 376, 58, 70, 17, '#b8c0d8'); R(b, 376, 58, 70, 3, '#eef1fb'); for (const x of [399, 422]) R(b, x, 61, 1, 14, '#8a93b3'); for (const x of [393, 405, 416, 428]) R(b, x, 66, 2, 1, '#5b5f86');
      BOX(b, 380, 43, 13, 14, '#3d3f63'); R(b, 382, 45, 9, 3, '#5b5f86'); R(b, 384, 52, 5, 4, '#ffffff'); R(b, 384, 53, 5, 1, '#ff8a3d'); R(b, 390, 45, 1, 1, '#ff5d6c');
      BOX(b, 398, 48, 20, 10, '#c9cee6'); R(b, 400, 50, 11, 6, '#102438'); R(b, 413, 50, 3, 1, '#5be37d'); R(b, 413, 53, 3, 1, '#8a93b3');
      for (const [x, y] of ellPts(430, 55, 6, 3)) if (y >= 55) R(b, x, y, 1, 1, '#7a4a2a');
      R(b, 425, 52, 3, 3, '#ff5d6c'); R(b, 428, 51, 3, 3, '#ffd23f'); R(b, 431, 52, 3, 3, '#62d36a'); R(b, 434, 53, 2, 2, '#ff8a3d');
      BOX(b, 452, 34, 24, 41, '#eef1fb'); R(b, 452, 50, 24, 1, '#b4bddb'); R(b, 471, 40, 1, 7, '#8a93b3'); R(b, 471, 54, 1, 10, '#8a93b3');
      R(b, 456, 38, 4, 4, '#ffd23f'); R(b, 462, 41, 3, 3, '#62d36a'); R(b, 457, 55, 6, 7, '#ffffff'); R(b, 458, 57, 4, 1, '#b4bddb');

      // floor zones
      for (let y = WALL + 1; y < H; y += 12) for (let x = 0; x < 176; x += 16) {
        R(b, x, y, 16, 12, ((x / 16 + Math.floor(y / 12)) % 2) ? '#25214f' : '#221e4a'); R(b, x + 7, y + 5, 1, 1, '#2c2759');
      }
      for (let y = WALL + 1; y < H; y += 6) { R(b, 176, y, 168, 6, '#2b2552'); R(b, 176, y + 5, 168, 1, '#272149'); const off = (y * 7) % 40; for (let x = 176 + off; x < 344; x += 40) R(b, x, y, 1, 5, '#272149'); }
      for (let y = WALL + 1; y < 124; y += 10) for (let x = 344; x < W; x += 10) R(b, x, y, 10, 10, ((x / 10 + Math.floor(y / 10)) % 2) ? '#332d63' : '#2a2556');
      R(b, 344, 124, 136, H - 124, '#271f4e'); for (let y = 126; y < H; y += 4) R(b, 344, y, 136, 1, '#2c2357');
      R(b, 176, WALL + 1, 1, H, '#16122e'); R(b, 344, WALL + 1, 1, H, '#16122e'); R(b, 344, 124, 136, 1, '#16122e');
      // desk chair mats
      for (const d of DESKS) R(b, d.x - 18, d.y - 8, 20, 10, 'rgba(58,52,112,0.55)');
      // wellness mats
      BOX(b, 196, 104, 40, 12, '#2f9e8a'); R(b, 196, 104, 40, 2, '#45c0a8'); BOX(b, 246, 104, 40, 12, '#e0609a'); R(b, 246, 104, 40, 2, '#ff8fbf');
      // dance rug
      for (const [x, y] of ellPts(262, 160, 56, 15)) { const e = ((x - 262) / 56) ** 2 + ((y - 160) / 15) ** 2; R(b, x, y, 1, 1, e > 0.82 ? '#5a4bb0' : (((Math.floor((x - 206) / 8) + Math.floor((y - 145) / 5)) % 2) ? '#3a2f74' : '#43378a')); }
      // lounge rug
      BOX(b, 196, 200, 128, 36, '#3b2f6e'); R(b, 199, 203, 122, 30, '#45387f'); for (let x = 202; x < 320; x += 8) R(b, x, 204, 4, 1, '#ffd23f');
      // nap pods: mats + dividers
      for (const p of PODS) { BOX(b, p.x - 21, p.y - 13, 44, 13, '#3a3470'); R(b, p.x - 21, p.y - 13, 44, 2, '#4b4f8f'); }
      R(b, 410, 128, 3, H - 128, '#3a3470'); R(b, 410, 128, 1, H - 128, '#4b4f8f');
      // floor labels
      b.font = '8px "Pixelify Sans", monospace'; b.fillStyle = '#433b80';
      b.fillText('DESKS', 138, 94); b.fillText('WELLNESS', 180, 98); b.fillText('PANTRY', 440, 120); b.fillText('NAP PODS', 348, 134); b.fillText('LOUNGE', 198, 197);
    });

    // sortable furniture
    const P = {
      divider: mk(170, 16, c => { R(c, 0, 8, 170, 6, 'rgba(143,227,255,0.13)'); R(c, 0, 7, 170, 1, '#9aa3c7'); R(c, 0, 6, 170, 1, INK); for (const x of [0, 56, 112, 168]) { R(c, x - 1, 6, 4, 10, INK); R(c, x, 7, 2, 8, '#7d84ad'); } R(c, 0, 14, 170, 1, '#5b5f86'); }),
      bistro: mk(40, 26, c => { for (const sx of [2, 30]) { shape(c, ellPts(sx + 4, 14, 4, 1.6), '#ff8a3d'); R(c, sx + 3, 16, 2, 8, '#5b5f86'); R(c, sx + 1, 24, 6, 1, '#3d3f63'); } shape(c, ellPts(20, 8, 10, 2.6), '#eef1fb'); R(c, 13, 7, 6, 1, '#ffffff'); R(c, 19, 11, 2, 12, '#7d84ad'); R(c, 15, 23, 10, 2, '#5b5f86'); BOX(c, 23, 4, 3, 3, '#ffffff'); R(c, 23, 5, 3, 1, '#3fd0c9'); R(c, 15, 6, 3, 1, '#ffd23f'); }),
      plant: mk(18, 30, c => { const pts = []; for (const [x, y, h] of [[3, 6, 14], [6, 1, 19], [9, 4, 16], [12, 8, 12]]) for (let j = 0; j < h; j++) pts.push([x, y + j], [x + 1, y + j]); shape(c, pts, '#5be37d'); for (const [x, y] of pts) if (x % 3 === 0) R(c, x, y, 1, 1, '#35b25a'); shape(c, [...Array(13 * 8)].map((_, k) => [2 + k % 13, 21 + Math.floor(k / 13)]), '#ff8a3d'); R(c, 2, 21, 13, 2, '#ffb07a'); }),
      bean: col => mk(26, 18, c => { const pts = ellPts(13, 10, 11, 6.5); shape(c, pts, col); for (const [x, y] of pts) if (y > 13) R(c, x, y, 1, 1, 'rgba(27,20,50,0.25)'); R(c, 7, 6, 4, 1, 'rgba(255,255,255,0.35)'); }),
      table: mk(30, 16, c => { BOX(c, 2, 4, 26, 4, '#8a5a3a'); R(c, 2, 4, 26, 1, '#b07a4a'); R(c, 4, 8, 2, 6, INK); R(c, 24, 8, 2, 6, INK); BOX(c, 6, 1, 4, 3, '#ffffff'); R(c, 6, 2, 4, 1, '#ff8a3d'); BOX(c, 15, 2, 8, 2, '#7fd8ff'); }),
      rack: mk(26, 22, c => { BOX(c, 2, 6, 22, 2, '#7d84ad'); BOX(c, 2, 13, 22, 2, '#7d84ad'); R(c, 2, 6, 2, 15, '#5b5f86'); R(c, 22, 6, 2, 15, '#5b5f86'); for (const [x, y, col] of [[5, 2, '#ff5d6c'], [12, 2, '#ffd23f'], [18, 3, '#3fd0c9'], [6, 10, '#a575ff'], [14, 10, '#62d36a']]) { BOX(c, x, y, 2, 4, col); BOX(c, x + 3, y, 2, 4, col); R(c, x + 2, y + 1, 1, 1, '#c9cee6'); } }),
      ball: mk(18, 18, c => { const pts = ellPts(9, 9, 7, 7); shape(c, pts, '#a575ff'); for (const [x, y] of pts) if (x + y > 21) R(c, x, y, 1, 1, '#7a4fd6'); R(c, 5, 5, 2, 1, '#e2c6ff'); }),
    };
    const PROPS = [
      { c: P.divider, x: 4, y: 128, by: 140 }, { c: P.divider, x: 4, y: 178, by: 190 },
      { c: P.plant, x: 156, y: 98, by: 127 }, { c: P.plant, x: 156, y: 205, by: 234 }, { c: P.plant, x: 324, y: 92, by: 121 },
      { c: P.bean('#ff7ab8'), x: 194, y: 210, by: 226 }, { c: P.bean('#3fd0c9'), x: 300, y: 212, by: 228 }, { c: P.table, x: 246, y: 206, by: 220 },
      { c: P.rack, x: 290, y: 94, by: 114 }, { c: P.bistro, x: 420, y: 90, by: 115 }, { c: P.ball, x: 180, y: 100, by: 116 },
    ];

    // ---------------- actors ----------------
    const actors = [], byId = {};
    let now = 0, selectedId = null, hoverId = null;
    const PETS = [['moonpup', 250, 150], ['blorb', 280, 182], ['glim', 330, 200], ['orbit', 200, 140]];
    function makeActor(id, kind, x, y) {
      return { id, kind, sprite: id, x, y, dir: 'front', action: 'idle', t: 0, tx: null, ty: null, then: null, timer: rand(0.5, 3), desk: null, pod: null, state: 'idle', detail: '', hold: 0, look: null, flash: null, napping: false };
    }
    for (const [id, x, y] of PETS) { const a = makeActor(id, 'pet', x, y); actors.push(a); byId[id] = a; }

    function release(a) {
      if (a.desk) { a.desk.by = null; a.desk = null; }
      if (a.pod) { a.pod.by = null; a.pod = null; }
    }
    function setAction(a, action, dir) {
      const A = SC.actions(a.sprite)[action]; if (!A) return;
      if (!dir || !A.dirs.includes(dir)) dir = A.dirs.includes(a.dir) ? a.dir : A.dirs[0];
      if (a.action !== action) a.t = 0;
      a.action = action; a.dir = dir;
    }
    function goTo(a, x, y, then) { a.tx = Math.max(16, Math.min(W - 16, x)); a.ty = Math.max(88, Math.min(H - 4, y)); a.then = then || null; }
    function stopHere(a, action, dir) { a.tx = null; a.then = null; setAction(a, action, dir); }
    const nearestFree = (list, a) => list.filter(s => !s.by || s.by === a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];

    function goWork(a) {
      a.napping = false;
      if (a.pod) { a.pod.by = null; a.pod = null; }
      if (a.desk && Math.round(a.x) === a.desk.x && Math.round(a.y) === a.desk.y) return stopHere(a, 'work', 'right');
      if (a.desk && a.tx !== null) return;
      const d = nearestFree(DESKS, a);
      if (!d) return stopHere(a, 'work', a.x < W / 2 ? 'right' : 'left');
      d.by = a; a.desk = d;
      goTo(a, d.x, d.y, () => setAction(a, 'work', 'right'));
    }
    function goSleep(a, nap) {
      if (a.desk) { a.desk.by = null; a.desk = null; }
      const p = nearestFree(PODS, a);
      const lay = () => { setAction(a, 'sleep', 'front'); a.napping = !!nap; a.timer = nap ? rand(10, 16) : 1e9; };
      if (!p) return lay();
      p.by = a; a.pod = p; goTo(a, p.x, p.y, lay);
    }
    function wake(a) { a.napping = false; setAction(a, 'wakeup', 'front'); const A = SC.anim(a.sprite, 'wakeup'); a.hold = A.frames / A.fps + 0.6; a.afterHold = () => { release(a); setAction(a, 'idle', 'front'); a.timer = rand(1, 3); }; }

    // review huddles happen at the lounge table: the author on the left, the reviewer on the right
    const HUDDLE = { left: { x: 238, y: 223, dir: 'right' }, right: { x: 286, y: 223, dir: 'left' } };
    function applyLive(a, live) {
      const st = (live && live.state) || 'idle';
      a.detail = (live && live.detail) || '';
      if (live && live.huddle && ['idle', 'thinking', 'working', 'waiting', 'browsing'].includes(st)) {
        const h = HUDDLE[live.huddle.side] || HUDDLE.left;
        if (a.state !== 'huddle') {
          a.napping = false; release(a); a.hold = 0; a.afterHold = null;
          if (a.action === 'sleep') wake(a);
          goTo(a, h.x, h.y, () => setAction(a, 'idle', h.dir));
        }
        a.state = 'huddle'; a.huddleDetail = st === 'idle' ? '' : a.detail;
        return;
      }
      if (st === a.state) { if ((st === 'working' || st === 'browsing' || (st === 'thinking' && live.missionId)) && a.action !== 'work' && a.tx === null) goWork(a); return; }
      const prev = a.state; a.state = st; a.hold = 0; a.afterHold = null;
      switch (st) {
        case 'working': case 'browsing': goWork(a); break;
        case 'thinking':
          if (live.missionId) { goWork(a); break; } // mission work happens at a desk
          if (!(a.desk && (a.action === 'work' || a.tx !== null))) { if (a.action === 'sleep') wake(a); else stopHere(a, 'idle', 'front'); } break;
        case 'waiting': if (live.missionId && !a.desk) goWork(a); else if (!(a.desk && a.action === 'work')) stopHere(a, 'idle', 'front'); break;
        case 'done': release(a); stopHere(a, 'dance', 'front'); a.hold = reduced ? 1.5 : 4; a.afterHold = () => { a.state = 'idle'; setAction(a, 'idle', 'front'); a.timer = rand(1, 3); }; break;
        case 'error': release(a); stopHere(a, 'idle', 'front'); a.hold = 6; a.afterHold = () => { a.state = 'idle'; a.timer = rand(1, 3); }; break;
        case 'training': release(a); { const p = spot('gym'); goTo(a, p.x, p.y, () => setAction(a, 'exercise', 'front')); } break;
        case 'learning': release(a); { const p = spot('lounge'); goTo(a, p.x, p.y, () => setAction(a, 'rest', 'front')); } break;
        case 'sleeping': goSleep(a, false); break;
        default: // idle
          if (prev === 'sleeping' || a.action === 'sleep') wake(a);
          else if (a.action === 'work' || a.action === 'rest') { release(a); stopHere(a, 'idle', 'front'); a.timer = rand(1, 3); }
      }
    }

    function think(a) {
      if (a.kind === 'pet') {
        const plan = pick(['wander', 'wander', 'play', 'follow', 'follow', 'dance', 'sleep', 'idle']);
        if (plan === 'wander') { const p = spot('any'); goTo(a, p.x, p.y, () => { setAction(a, 'idle', 'front'); a.timer = rand(2, 5); }); }
        else if (plan === 'follow') { const c = actors.find(x => x.kind === 'crew' && x.id === 'cortex') || actors.find(x => x.kind === 'crew'); if (c) goTo(a, c.x + pick([-24, 24]), c.y + rand(4, 12), () => { setAction(a, pick(['idle', 'play']), 'front'); a.timer = rand(3, 6); }); }
        else if (plan === 'sleep') { const p = spot('lounge'); goTo(a, p.x, p.y, () => { setAction(a, 'sleep', 'front'); a.timer = rand(8, 14); }); }
        else if (plan === 'dance') { const p = spot('rug'); goTo(a, p.x, p.y, () => { setAction(a, 'dance', 'front'); a.timer = rand(3, 6); }); }
        else { setAction(a, plan, 'front'); a.timer = rand(2, 5); }
        return;
      }
      if (a.napping) { wake(a); return; }
      if ((a.energy || 100) < 30 && Math.random() < 0.6) return goSleep(a, true);
      const plan = pick(opt.music ? ['wander', 'coffee', 'rest', 'idle', 'chat', 'dance', 'dance'] : ['wander', 'wander', 'coffee', 'rest', 'idle', 'idle', 'chat']);
      if (plan === 'dance') { const p = spot('rug'); goTo(a, p.x, p.y, () => { setAction(a, 'dance', 'front'); a.timer = rand(4, 8); }); return; }
      if (plan === 'wander') { const p = spot('any'); goTo(a, p.x, p.y, () => { setAction(a, 'idle', 'front'); a.timer = rand(3, 7); }); }
      else if (plan === 'coffee') { const p = spot('pantry'); goTo(a, p.x, p.y, () => { setAction(a, 'idle', 'back'); a.timer = rand(3, 5); }); }
      else if (plan === 'rest') { const p = spot('lounge'); goTo(a, p.x, p.y, () => { setAction(a, 'rest', 'front'); a.timer = rand(5, 9); }); }
      else if (plan === 'chat') { const o = pick(actors.filter(x => x.kind === 'crew' && x !== a)); if (o) goTo(a, o.x + (o.x > W / 2 ? -22 : 22), Math.max(92, o.y), () => { setAction(a, 'idle', o.x > a.x ? 'right' : 'left'); a.timer = rand(3, 5); }); }
      else { setAction(a, 'idle', 'front'); a.timer = rand(2, 5); }
    }

    function update(dt) {
      for (const a of actors) {
        a.t += dt;
        if (a.flash && a.flash.until < now) a.flash = null;
        if (a.tx !== null) {
          const dx = a.tx - a.x, dy = a.ty - a.y, dist = Math.hypot(dx, dy);
          if (dist < 1) { a.x = a.tx; a.y = a.ty; a.tx = null; const f = a.then; a.then = null; if (f) f(); else { setAction(a, 'idle', 'front'); a.timer = rand(2, 4); } }
          else {
            const sp = Math.min(dist, (a.kind === 'crew' ? 30 : 24) * dt);
            a.x += dx / dist * sp; a.y += dy / dist * sp;
            setAction(a, 'walk', Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'front' : 'back'));
          }
          continue;
        }
        if (a.action === 'walk') setAction(a, 'idle', 'front');
        if (a.hold > 0) { a.hold -= dt; if (a.hold <= 0 && a.afterHold) { const f = a.afterHold; a.afterHold = null; f(); } continue; }
        const free = a.kind === 'pet' || a.state === 'idle';
        if (!free) continue;
        a.timer -= dt;
        if (a.timer <= 0) think(a);
      }
    }

    // ---------------- overlay tags (name + speech bubble) ----------------
    function tagFor(a) {
      if (a.el) return a.el;
      const el = document.createElement('div'); el.className = 'tag';
      const b = document.createElement('div'); b.className = 'bubble';
      const n = document.createElement('div'); n.className = 'nametag';
      el.append(b, n); overlay.appendChild(el); a.el = el; a.bEl = b; a.nEl = n; a.cache = '';
      return el;
    }
    // what each crew member says when you click them
    const LINES = {
      cortex: ['Captain here. Orders?', 'My brain is all yours.', 'Got a mission for me?'],
      ribbit: ['Ribbit? I mean… yes?', 'First Officer reporting!', 'Need a second look at something?'],
      nova: ['Yeah?', 'Ready for take-off!', 'Where are we flying today?'],
      zorp: ['Zorp listening!', 'Need something built?', 'Wrench ready.'],
      pip: ['Fascinating. Yes?', 'I have data for that.', 'Hypothesis: you need me?'],
      koda: ['Need a check-up?', 'Everything okay?', 'I can test that!'],
      gizmo: ['Beep. Ready.', 'Systems online.', 'Bzzt. What can I do?'],
      mochi: ['Mrrp? Yes?', 'Purr-fect timing.', 'Want me to write something?'],
      inky: ['All eight arms ready!', 'Shall I sketch it?', 'Inky at your service.'],
      sprig: ['Rooted and ready.', 'Fresh as a radish!', 'Need data sorted?'],
      rex: ['Rawr. What\'s up?', 'Security check?', 'All clear here.'],
    };
    const PET_LINES = {
      moonpup: ['Woof!', 'Arf arf!', '*wags all six legs*'], blorb: ['Blorp!', '*wobbles happily*', 'Glub?'],
      glim: ['*glows brighter*', 'Bloop~', '✦'], orbit: ['*spins*', 'Whirr!', '*the moon waves*'],
    };
    function poke(a) {
      const name = a.name || (SC.characters[a.sprite] || {}).name || a.id;
      let line;
      const generic = ['Yeah?', 'Yes?', 'What\'s up?', 'Hm?', 'Hey!'];
      if (a.kind === 'pet') line = pick(PET_LINES[a.id] || ['!']);
      else if (a.state === 'sleeping') line = pick(['Zzz… I\'m off duty.', 'Five more minutes…', '*snore*']);
      else if (a.action === 'sleep') { line = pick(['Huh? I\'m up, I\'m up!', '*yawn* Yeah?']); wake(a); }
      else if (a.state === 'waiting') line = 'I need your OK first!';
      else if (['working', 'browsing', 'thinking'].includes(a.state)) line = pick(['On it, boss!', 'Busy, almost there!', 'Working on it…']);
      else if (a.state === 'learning') line = 'Just noting what I learned.';
      else line = pick([...(LINES[a.sprite] || []), ...generic]);
      a.flash = { text: `${name}: ${line}`, until: now + 3.2, cls: 'say' };
      a.hopAt = now;
      const free = a.kind === 'pet' || a.state === 'idle';
      if (free && !['sleep', 'rest', 'work', 'wakeup'].includes(a.action)) {
        a.tx = null; a.then = null; setAction(a, 'idle', 'front'); a.timer = 3.5;
      }
    }
    const STATE_TEXT = { training: 'Training the crew', huddle: 'Huddle', thinking: 'Thinking', working: 'Working', browsing: 'Browsing', waiting: 'Needs your OK', done: 'Done!', error: 'Problem', learning: 'Learning' };
    function updateTags() {
      for (const a of actors) {
        if (a.kind !== 'crew' && !a.flash && !a.el) continue;
        const el = tagFor(a);
        let text = '', cls = '';
        if (a.flash) { text = a.flash.text; cls = a.flash.cls || 'flash'; }
        else if (a.state === 'huddle') { text = a.huddleDetail || ''; cls = text ? 'thinking' : ''; }
        else if (a.state !== 'idle' && a.state !== 'sleeping') { text = a.detail || STATE_TEXT[a.state] || ''; cls = a.state; if (a.state === 'waiting') text = a.detail && /question/i.test(a.detail) ? 'Has a question' : 'Needs your OK'; }
        const showName = a.kind === 'crew' && (a.id === selectedId || a.id === hoverId || (text && cls !== 'say'));
        const key = text + '|' + cls + '|' + (showName ? 1 : 0) + '|' + a.name;
        if (key !== a.cache) {
          a.cache = key;
          a.bEl.textContent = text; a.bEl.className = 'bubble ' + cls; a.bEl.hidden = !text;
          a.nEl.textContent = a.name || a.id; a.nEl.hidden = !showName;
          el.classList.toggle('selected', a.id === selectedId);
        }
        const lift = a.kind === 'pet' ? 24 : a.action === 'sleep' ? 26 : a.action === 'work' ? 40 : a.action === 'rest' ? 36 : 44;
        el.style.left = (a.x / W * 100).toFixed(2) + '%';
        el.style.top = ((a.y - lift) / H * 100).toFixed(2) + '%';
        el.style.zIndex = String(Math.round(a.y) + (a.id === selectedId ? 1000 : 0) + (text ? 500 : 0));
      }
    }

    // ---------------- drawing ----------------
    const JUKE = ['#ff5d6c', '#ffd23f', '#5be37d', '#3fd0c9', '#a575ff'];
    function drawLive() {
      for (const s of stars) {
        const on = Math.sin(now * 2 + s.p) > -0.3;
        g.fillStyle = s.b ? (on ? '#ffffff' : '#7a74b0') : (on ? '#bdb7e8' : '#3b3570');
        g.fillRect(s.x, s.y, 1, 1);
      }
      // wall clock shows the viewer's real time
      const d = new Date(), m = d.getMinutes() + d.getSeconds() / 60, hr = (d.getHours() % 12) + m / 60, TAU = Math.PI * 2;
      line(g, 140, 24, 140 + Math.sin(hr / 12 * TAU) * 4, 24 - Math.cos(hr / 12 * TAU) * 4, INK);
      line(g, 140, 24, 140 + Math.sin(m / 60 * TAU) * 6, 24 - Math.cos(m / 60 * TAU) * 6, '#3d3f63');
      line(g, 140, 24, 140 + Math.sin(d.getSeconds() / 60 * TAU) * 6, 24 - Math.cos(d.getSeconds() / 60 * TAU) * 6, '#ff5d6c');
      R(g, 140, 24, 1, 1, INK);
      // mission board
      R(g, 163, 11, 134, 5, '#16264a'); R(g, 166, 13, 3, 1, '#62d36a'); R(g, 171, 13, 26, 1, '#9aa3c7'); R(g, 201, 13, 14, 1, '#4b5a8a');
      R(g, 291, 13, 3, 1, Math.floor(now * 2) % 2 ? '#ff5d6c' : '#16264a');
      for (let i = 0; i < 8; i++) {
        const h = Math.round(8 + 16 * (0.5 + 0.5 * Math.sin(now * 0.9 + i * 0.8)));
        R(g, 167 + i * 7, 46 - h, 5, h, i % 2 ? '#3fd0c9' : '#62d36a'); R(g, 167 + i * 7, 46 - h, 5, 1, '#c8fff0');
      }
      R(g, 166, 46, 56, 1, '#2e3b66'); R(g, 225, 19, 1, 28, '#16264a');
      R(g, 228, 22, 66, 1, '#132449'); R(g, 228, 30, 66, 1, '#132449');
      for (let i = 0; i < 66; i++) {
        const y = 26 + Math.round(Math.sin((i + now * 10) * 0.22) * 3 + Math.sin((i + now * 10) * 0.05) * 3);
        R(g, 228 + i, y + 1, 1, 35 - y, 'rgba(255,138,61,0.14)'); R(g, 228 + i, y, 1, 1, '#ff8a3d');
      }
      for (let k = 0; k < 3; k++) { R(g, 228 + k * 23, 38, 21, 9, '#16264a'); R(g, 230 + k * 23, 40, 8, 1, '#9aa3c7'); R(g, 230 + k * 23, 43, 6 + ((Math.floor(now * 0.6) + k * 5) % 12), 2, ['#ffd23f', '#5be37d', '#a575ff'][k]); }
      // printer, coffee, vending, jukebox
      R(g, 95, 53, 1, 1, Math.floor(now * 1.5) % 2 ? '#5be37d' : '#2a5a30');
      for (let k = 0; k < 4; k++) { const t = (now * 6 + k * 3) % 12; R(g, 386 + Math.round(Math.sin(now * 3 + k) * 1.2), Math.round(51 - t), 1, 1, 'rgba(255,255,255,' + (0.6 - t * 0.045).toFixed(2) + ')'); }
      R(g, 333, 38, 15, 1, 'rgba(127,176,255,' + (0.55 + 0.4 * Math.sin(now * 2)).toFixed(2) + ')');
      const dancing = actors.some(a => a.action === 'dance') || opt.music;
      for (let k = 0; k < 9; k++) R(g, 308 + k * 2, 46, 1, 2, JUKE[(k + Math.floor(now * (dancing ? 8 : 2))) % 5]);
      R(g, 309, 52, 14, 8, '#0b1530');
      for (let k = 0; k < 6; k++) { const hh = dancing ? 1 + Math.floor(Math.abs(Math.sin(now * 6 + k * 1.3)) * 6) : 1; R(g, 310 + k * 2, 60 - hh, 1, hh, '#5be3d1'); }
      // the jukebox glows when the radio is on
      if (opt.music) { const p = Math.max(0, 1 - (now - beatAt) * 3); g.fillStyle = `rgba(255,140,220,${(0.12 + 0.2 * p).toFixed(3)})`; for (const [x, y] of ellPts(316, 58, 14 + p * 3, 22 + p * 3)) if (y > 40 && y < 76) g.fillRect(x, y, 1, 1);
        for (let k = 0; k < 3; k++) { const t = (now * 0.8 + k / 3) % 1; g.fillStyle = `rgba(255,210,63,${(0.9 * (1 - t)).toFixed(2)})`; const nx = Math.round(322 + k * 4 + Math.sin(now * 3 + k) * 3), ny = Math.round(40 - t * 22); g.fillRect(nx, ny, 2, 2); g.fillRect(nx + 2, ny - 3, 1, 4); } }
      if (actors.some(a => a.action === 'dance')) for (let k = 0; k < 5; k++) {
        const cx = 262 + Math.sin(now * 1.3 + k * 1.7) * 40, cy = 160 + Math.cos(now * 1.1 + k * 2.1) * 8;
        g.fillStyle = ['rgba(255,93,108,0.22)', 'rgba(255,210,63,0.22)', 'rgba(91,227,125,0.22)', 'rgba(63,208,201,0.22)', 'rgba(165,117,255,0.22)'][k];
        for (const [x, y] of ellPts(cx, cy, 7, 2.6)) g.fillRect(x, y, 1, 1);
      }
    }
    // station lighting follows the viewer's clock: bright by day, dim blue at night with desk lamps glowing
    const opt = { dayNight: true, music: false };
    let beatAt = -1;
    function nightLevel() {
      const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
      if (h >= 7 && h < 18) return 0;
      if (h >= 18 && h < 20) return (h - 18) / 2;
      if (h >= 5 && h < 7) return (7 - h) / 2;
      return 1;
    }
    function drawLighting() {
      const n = nightLevel(); if (n <= 0) return;
      const dusk = n < 1 ? Math.sin(n * Math.PI) : 0;
      if (dusk > 0.05) { g.fillStyle = `rgba(255,120,60,${(0.08 * dusk).toFixed(3)})`; g.fillRect(0, 0, W, H); }
      g.fillStyle = `rgba(8,6,40,${(0.38 * n).toFixed(3)})`; g.fillRect(0, WALL - 18, W, H);
      g.fillStyle = `rgba(8,6,40,${(0.22 * n).toFixed(3)})`; g.fillRect(0, 0, W, WALL - 18);
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const dk of DESKS) {
        const busy = dk.by && dk.by.action === 'work';
        const a = (busy ? 0.13 : 0.035) * n;
        g.fillStyle = `rgba(255,220,140,${a.toFixed(3)})`;
        for (const [x, y] of ellPts(dk.x + 10, dk.y - 20, busy ? 22 : 12, busy ? 14 : 8)) g.fillRect(x, y, 1, 1);
      }
      g.fillStyle = `rgba(127,216,255,${(0.05 * n).toFixed(3)})`; g.fillRect(163, 11, 134, 38);
      g.restore();
    }
    function draw() {
      g.drawImage(bgc, 0, 0);
      drawLive();
      const items = [];
      for (const p of PROPS) items.push({ y: p.by, f: () => g.drawImage(p.c, p.x, p.y) });
      const desk = SC.prop('desk', 'right');
      for (const dk of DESKS) {
        const a = dk.by, seated = a && a.action === 'work' && a.tx === null && Math.round(a.x) === dk.x && Math.round(a.y) === dk.y;
        if (!seated) items.push({ y: dk.y, f: () => g.drawImage(desk, dk.x - 24, dk.y - 44) });
      }
      for (const a of actors) {
        const hp = a.hopAt != null && now - a.hopAt < 0.35 ? -Math.round(Math.sin((now - a.hopAt) / 0.35 * Math.PI) * 3) : 0;
        items.push({ y: a.y + 0.5, f: () => SC.draw(g, a.sprite, a.action, a.dir, frameAt(a.sprite, a.action, a.t), Math.round(a.x) - 24, Math.round(a.y) - 44 + hp, 1, a.look) });
      }
      items.sort((p, q) => p.y - q.y).forEach(it => it.f());
      if (opt.dayNight) drawLighting();
      const s = byId[selectedId];
      if (s) {
        const bob = Math.round(Math.sin(now * 6)), low = s.action === 'sleep' ? 18 : s.action === 'work' ? 4 : 0;
        const top = Math.round(s.y) - 52 + low + bob, mx = Math.round(s.x);
        g.fillStyle = INK; g.fillRect(mx - 4, top - 1, 9, 5);
        g.fillStyle = '#ffd23f'; g.fillRect(mx - 3, top, 7, 1); g.fillRect(mx - 2, top + 1, 5, 1); g.fillRect(mx - 1, top + 2, 3, 1); g.fillRect(mx, top + 3, 1, 1);
      }
    }

    // ---------------- input ----------------
    const onJukebox = ev => { const r = canvas.getBoundingClientRect(); const x = (ev.clientX - r.left) * W / r.width, y = (ev.clientY - r.top) * H / r.height; return x >= 305 && x <= 327 && y >= 36 && y <= 76; };
    function hit(ev) {
      const r = canvas.getBoundingClientRect();
      const x = (ev.clientX - r.left) * W / r.width, y = (ev.clientY - r.top) * H / r.height;
      return [...actors].sort((p, q) => q.y - p.y).find(a => {
        if (a.kind === 'pet') return x > a.x - 10 && x < a.x + 10 && y > a.y - 22 && y < a.y + 2;
        const top = a.action === 'sleep' ? a.y - 24 : a.y - 40;
        const half = a.action === 'sleep' || a.action === 'work' ? 20 : 12;
        return x > a.x - half && x < a.x + half && y > top && y < a.y + 2;
      });
    }
    canvas.addEventListener('pointerdown', ev => { const a = hit(ev); if (!a) { if (onJukebox(ev) && opts.onJukebox) opts.onJukebox(); return; } poke(a); if (opts.onPoke) opts.onPoke(a.id, a.kind); if (a.kind === 'crew' && opts.onSelect) opts.onSelect(a.id); });
    canvas.addEventListener('pointermove', ev => { const a = hit(ev); hoverId = a ? a.id : null; canvas.style.cursor = a || onJukebox(ev) ? 'pointer' : 'default'; canvas.title = !a && onJukebox(ev) ? 'Jukebox: click to play or pause music' : ''; });
    canvas.addEventListener('pointerleave', () => { hoverId = null; });
    canvas.addEventListener('dblclick', ev => { const a = hit(ev); if (a && opts.onDance) opts.onDance(a.id); });

    let last = performance.now(), raf = 0;
    function loop(ms) {
      const dt = Math.min(0.1, (ms - last) / 1000); last = ms; now += dt;
      update(dt); draw(); updateTags();
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return {
      sync(agents) {
        const seen = new Set();
        agents.forEach((ag, i) => {
          seen.add(ag.id);
          let a = byId[ag.id];
          if (!a) {
            const p = ag.live && ag.live.state === 'sleeping' ? { x: 380, y: 200 } : spot(pick(['any', 'any', 'pantry', 'lounge', 'rug']));
            a = makeActor(ag.id, 'crew', p.x, p.y); actors.push(a); byId[ag.id] = a;
          }
          a.sprite = SC.characters[ag.sprite] && SC.characters[ag.sprite].kind === 'crew' ? ag.sprite : 'nova';
          a.look = ag.look || null; a.name = ag.name; a.energy = ag.energy;
          applyLive(a, ag.enabled ? (ag.live || { state: 'idle' }) : { state: 'sleeping' });
        });
        for (let k = actors.length - 1; k >= 0; k--) { const a = actors[k]; if (a.kind === 'crew' && !seen.has(a.id)) { release(a); if (a.el) a.el.remove(); actors.splice(k, 1); delete byId[a.id]; } }
      },
      select(id) { selectedId = id; },
      poke(id) { const a = byId[id]; if (a) poke(a); },
      levelUp(id, text) {
        const a = byId[id]; if (!a) return;
        a.flash = { text: text || 'LEVEL UP!', until: now + 5 };
        if (a.state === 'idle' && a.tx === null && a.action !== 'sleep') { const p = spot('gym'); goTo(a, p.x, p.y, () => { setAction(a, 'exercise', 'front'); a.timer = 5; }); }
      },
      say(id, text, secs = 4) { const a = byId[id]; if (a) a.flash = { text, until: now + secs }; },
      // a short back-and-forth at the huddle table: [[agentId, line], …]
      huddle(lines) {
        (lines || []).forEach(([id, text], i) => setTimeout(() => { const a = byId[id]; if (a) { a.flash = { text: `${a.name}: ${text}`, until: now + 3.4, cls: 'say' }; a.hopAt = now; } }, i * 2600));
      },
      setOptions(o) { Object.assign(opt, o || {}); },
      beat() { beatAt = now; },
      // dance on request: free crew go to the dance floor, busy crew promise to dance later
      dance(id, secs = 8) {
        const list = id === 'all' ? actors.filter(a => a.kind === 'crew' || a.kind === 'pet') : [byId[id]].filter(Boolean);
        let n = 0;
        for (const a of list) {
          const free = a.kind === 'pet' || a.state === 'idle' || a.state === 'done';
          if (!free) { if (id !== 'all') { a.flash = { text: `${a.name}: After this task, I promise!`, until: now + 3, cls: 'say' }; a.hopAt = now; } continue; }
          if (a.action === 'sleep') { a.napping = false; release(a); }
          n++;
          // a party spreads everyone across the dance floor in two rows; a solo dancer picks any spot
          const p = id === 'all' ? { x: Math.round(212 + ((n * 37) % 104)), y: n % 2 ? 150 : 170 } : spot('rug'); a.hold = 0; a.afterHold = null;
          goTo(a, p.x, p.y, () => { setAction(a, 'dance', 'front'); a.hold = secs; a.afterHold = () => { setAction(a, 'idle', 'front'); a.timer = rand(1, 3); }; });
          if (a.kind === 'crew') a.flash = { text: `${a.name}: ${pick(['Let\'s dance!', 'Watch this!', 'Groove time!', 'Ooh, I love this one!'])}`, until: now + 2.5, cls: 'say' };
        }
        return n;
      },
      // the trainer jogs over, gives a tip, and the trainee answers
      coach(trainerId, agentId, tip, reply) {
        const t = byId[trainerId], a = byId[agentId]; if (!a) return;
        if (t) { t.flash = { text: tip, until: now + 3.2, cls: 'say' }; t.hopAt = now; }
        setTimeout(() => { if (reply) { a.flash = { text: reply, until: now + 3, cls: 'say' }; a.hopAt = now; } }, 1400);
      },
      // a new crew member walks in through the pantry door and the captain says hello
      arrive(id, captainId) {
        const a = byId[id]; if (!a) return;
        release(a); a.x = W - 14; a.y = 104; a.state = 'idle'; a.hold = 0;
        goTo(a, 300, 150, () => { setAction(a, 'dance', 'front'); a.hold = 2.5; a.afterHold = () => { setAction(a, 'idle', 'front'); a.timer = 2; }; a.flash = { text: `${a.name}: Reporting for duty!`, until: now + 3.5, cls: 'say' }; });
        const c = byId[captainId]; if (c) setTimeout(() => { c.flash = { text: `${c.name}: Welcome aboard, ${a.name}!`, until: now + 3.5, cls: 'say' }; c.hopAt = now; }, 2600);
      },
      destroy() { cancelAnimationFrame(raf); },
    };
  }
  global.StarOffice = { create: createOffice };
})(window);
