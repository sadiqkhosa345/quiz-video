/* Quiz video renderer for the phone: draws every frame on a <canvas> (the browser shapes Urdu itself),
 * mixes voice / countdown sounds / music with Web Audio, and encodes an MP4 with WebCodecs + mp4-muxer.
 * Layout uses 1080x1920 coordinates (9:16, full screen on TikTok); output can be 720p / 1080p / 4K. */
(function () {
  "use strict";
  const W = 1080, H = 1920, FPS = 30;
  const Q_BOX = [60, 250, 1020, 650], STAGE = [60, 700, 1020, 1440], ANS_BOX = [60, 1500, 1020, 1700];
  const BADGE = ["#E5484D", "#3B82F6", "#F5A524", "#22C55E"];
  const NEON = ["#FF4D6D", "#4DA3FF", "#FFD23F", "#3DFF8B"];
  const GREEN = "#16A34A", GREEN_HI = "#22C55E", GREEN_DEEP = "#15803D", DARK = "#111827", WHITE = "#FFFFFF";
  const LETTERS = "ABCD";
  const URDU = /[؀-ۿ]/;
  const URDU_FONT = '"Noto Nastaliq Urdu"', LATIN_FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const OPT_FIRST = 0.8, OPT_STAGGER = 0.45, FADE = 0.5, REVEAL_FADE = 0.3, MIN_TIMER = 3;

  const THEMES = {
    Purple: ["#5B21B6", "#DB2777"], Ocean: ["#0369A1", "#1E1B4B"], Sunset: ["#F97316", "#BE123C"],
    Forest: ["#047857", "#0F172A"], Dark: ["#1F2937", "#030712"], Royal: ["#1E3A8A", "#7C3AED"],
    Candy: ["#EC4899", "#8B5CF6"], Fire: ["#DC2626", "#F59E0B"], Mint: ["#14B8A6", "#065F46"],
    Gold: ["#92400E", "#F59E0B"], Night: ["#0F172A", "#312E81"], Sky: ["#0EA5E9", "#6366F1"],
  };
  const BACKGROUNDS = ["Auto", "Plain", "Dots", "Bokeh", "Grid", "Waves", "Stripes", "Sunburst", "Confetti"];
  const COUNTDOWNS = ["Number + bar", "Circle ring", "Color bar"];
  const TICKS = ["Tick", "Clock", "Beep", "Drum", "Koi nahi"];

  // ---------- colour + shape helpers ----------
  function rgb(c) {
    if (Array.isArray(c)) return c;
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    return "#" + x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, "0")).join("");
  }
  function rgba(c, a) { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; }
  function vivid(a, b) {
    const sat = (c) => { const v = rgb(c); return Math.max(...v) - Math.min(...v); };
    const c = rgb(sat(a) >= sat(b) ? a : b), top = Math.max(...c) || 1;
    return mix("#" + c.map((v) => Math.min(255, Math.round(v * 255 / top)).toString(16).padStart(2, "0")).join(""), WHITE, 0.15);
  }
  function rrPath(ctx, x0, y0, x1, y1, r) {
    r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x1, y0, x1, y1, r); ctx.arcTo(x1, y1, x0, y1, r);
    ctx.arcTo(x0, y1, x0, y0, r); ctx.arcTo(x0, y0, x1, y0, r);
    ctx.closePath();
  }
  function fillRR(ctx, box, r, fill, shadow) {
    ctx.save();
    if (shadow) { ctx.shadowColor = shadow.color || "rgba(0,0,0,0.28)"; ctx.shadowBlur = shadow.blur ?? 30; ctx.shadowOffsetY = shadow.dy ?? 10; }
    rrPath(ctx, ...box, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }
  function strokeRR(ctx, box, r, colour, width, glow) {
    ctx.save();
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 28; }
    rrPath(ctx, ...box, r);
    ctx.strokeStyle = colour; ctx.lineWidth = width;
    ctx.stroke();
    if (glow) ctx.stroke();
    ctx.restore();
  }
  const inset = (b, n) => [b[0] + n, b[1] + n, b[2] - n, b[3] - n];
  function grad(ctx, box, c1, c2, horizontal) {
    const g = horizontal ? ctx.createLinearGradient(box[0], 0, box[2], 0) : ctx.createLinearGradient(0, box[1], 0, box[3]);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    return g;
  }
  function circle(ctx, cx, cy, r, fill, stroke, width) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }
  function letter(ctx, cx, cy, ch, size, colour) {
    ctx.save();
    ctx.font = `800 ${size}px ${LATIN_FONT}`;
    ctx.fillStyle = colour; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ch, cx, cy + size * 0.04);
    ctx.restore();
  }
  function tick(ctx, cx, cy, r = 40, colour = GREEN, ring = WHITE, mark = WHITE) {
    circle(ctx, cx, cy, r, colour, ring, ring ? 6 : 0);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy + r * 0.02); ctx.lineTo(cx - r * 0.12, cy + r * 0.35); ctx.lineTo(cx + r * 0.48, cy - r * 0.32);
    ctx.strokeStyle = mark; ctx.lineWidth = r * 0.22; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  }
  function drawCover(ctx, img, box, r) {
    const [x0, y0, x1, y1] = box, bw = x1 - x0, bh = y1 - y0;
    const iw = img.width, ih = img.height, s = Math.max(bw / iw, bh / ih);
    const sw = bw / s, sh = bh / s, sx = (iw - sw) / 2, sy = (ih - sh) * 0.3;   // faces sit in the upper part
    ctx.save();
    rrPath(ctx, x0, y0, x1, y1, r); ctx.clip();
    ctx.fillStyle = WHITE; ctx.fillRect(x0, y0, bw, bh);
    ctx.drawImage(img, sx, sy, sw, sh, x0, y0, bw, bh);
    ctx.restore();
  }

  // ---------- text ----------
  const fontOf = (text, size, weight = 700) => `${weight} ${size}px ${URDU.test(text) ? URDU_FONT : LATIN_FONT}`;
  const lineH = (text, size) => size * (URDU.test(text) ? 1.75 : 1.2);
  function wrap(ctx, text, maxW) {
    const lines = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? line + " " + word : word;
        if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = word; } else line = test;
      }
      if (line) lines.push(line);
    }
    return lines.length ? lines : [""];
  }
  /** Biggest size from `big` down to `small` at which the text fits the box. */
  function fit(ctx, text, maxW, maxH, big, small) {
    for (let size = big; size >= small; size -= 2) {
      ctx.font = fontOf(text, size);
      const lines = wrap(ctx, text, maxW);
      if (lines.length * lineH(text, size) <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size, lines };
    }
    ctx.font = fontOf(text, small);
    return { size: small, lines: wrap(ctx, text, maxW) };
  }
  function text(ctx, str, cx, cy, maxW, maxH, big, small, colour, shadow) {
    if (!str) return;
    ctx.save();
    const { size, lines } = fit(ctx, str, maxW, maxH, big, small);
    ctx.font = fontOf(str, size);
    ctx.fillStyle = colour; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.direction = URDU.test(str) ? "rtl" : "ltr";
    if (shadow) { ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; }
    const lh = lineH(str, size), y0 = cy - (lines.length - 1) * lh / 2 + (URDU.test(str) ? size * 0.12 : 0);
    lines.forEach((l, i) => ctx.fillText(l, cx, y0 + i * lh));
    ctx.restore();
  }

  // ---------- backgrounds ----------
  function seeded(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
  function drawBackground(ctx, kind, c1, c2) {
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rnd = seeded(7);
    ctx.save();
    if (kind === "Dots") {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      for (let y = 30; y < H; y += 56) for (let x = (y / 56) % 2 ? 58 : 30; x < W; x += 56) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); }
    } else if (kind === "Bokeh") {
      ctx.filter = "blur(6px)";
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.09})`;
        ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, 60 + rnd() * 160, 0, 7); ctx.fill();
      }
    } else if (kind === "Grid") {
      ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 2;
      for (let x = 0; x <= W; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    } else if (kind === "Waves") {
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = `rgba(255,255,255,${0.06 + k * 0.03})`;
        ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H - 260 + k * 90 + Math.sin(x / 170 + k * 1.7) * 40);
        ctx.lineTo(W, H); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, 0);
        for (let x = 0; x <= W; x += 20) ctx.lineTo(x, 120 - k * 40 + Math.sin(x / 150 + k) * 30);
        ctx.lineTo(W, 0); ctx.fill();
      }
    } else if (kind === "Stripes") {
      ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 34;
      for (let x = -H; x < W; x += 110) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke(); }
    } else if (kind === "Sunburst") {
      ctx.translate(W / 2, H * 0.42); ctx.fillStyle = "rgba(255,255,255,0.07)";
      for (let i = 0; i < 24; i++) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, 2400, (i * 2 * Math.PI) / 24, ((i + 0.5) * 2 * Math.PI) / 24); ctx.fill();
      }
    } else if (kind === "Confetti") {
      const cols = ["#FDE047", "#F472B6", "#60A5FA", "#4ADE80", "#FFFFFF"];
      for (let i = 0; i < 140; i++) {
        ctx.save(); ctx.translate(rnd() * W, rnd() * H); ctx.rotate(rnd() * 6);
        ctx.fillStyle = rgba(cols[i % cols.length], 0.55); ctx.fillRect(-6, -12, 12, 24); ctx.restore();
      }
    }
    ctx.restore();
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);   // soft vignette
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  // ---------- designs ----------
  function gridBoxes() { return [0, 1, 2, 3].map((i) => [60 + (i % 2) * 494, 700 + Math.floor(i / 2) * 398, 526 + (i % 2) * 494, 1070 + Math.floor(i / 2) * 398]); }
  function listBoxes() { return [0, 1, 2, 3].map((i) => [60, 690 + i * 192, 1020, 690 + i * 192 + 170]); }

  const base = {
    layout: "list", background: "Plain", dim: 0.42,
    colors: { head: WHITE, q: DARK, opt: DARK, optRight: DARK, label: WHITE, cd: WHITE, ans: WHITE },
    bgColors(c1, c2) { return [c1, c2]; },
    boxes() { return this.layout === "grid" ? gridBoxes() : listBoxes(); },
    optText(i) {
      const [x0, y0, x1, y1] = this.boxes()[i];
      if (this.layout === "list") { const xa = x0 + 165, xb = x1 - 120; return [(xa + xb) / 2, (y0 + y1) / 2, xb - xa, y1 - y0 - 30, 62, 26]; }
      return [x0 + (x1 - x0) / 2, y0 + (y1 - y0) / 2 + 22, x1 - x0 - 70, y1 - y0 - 140, 66, 28];
    },
    badgePos(i) { const [x0, y0, , y1] = this.boxes()[i]; return this.layout === "list" ? [x0 + 85, (y0 + y1) / 2] : [x0 + 58, y0 + 58]; },
    tickPos(i) { const [x0, y0, x1, y1] = this.boxes()[i]; return this.layout === "list" ? [x1 - 70, (y0 + y1) / 2] : [x1 - 56, y0 + 56]; },
    pill(ctx, box) { fillRR(ctx, box, 44, "rgba(255,255,255,0.18)"); },
    question(ctx) { fillRR(ctx, Q_BOX, 44, WHITE, {}); },
    answer(ctx, revealed) {
      if (revealed) fillRR(ctx, ANS_BOX, 40, GREEN, {});
      else { fillRR(ctx, ANS_BOX, 40, "rgba(255,255,255,0.16)"); strokeRR(ctx, ANS_BOX, 40, "rgba(255,255,255,0.55)", 4); }
    },
    stage(ctx, right) {
      fillRR(ctx, STAGE, 40, WHITE, {});
      if (right) strokeRR(ctx, inset(STAGE, 8), 32, GREEN, 14);
    },
    stagePicBox() { return [inset(STAGE, 24), 24]; },
  };

  const DESIGNS = {
    Classic: Object.assign({}, base, {
      layout: "grid",
      option(ctx, i, right) {
        const b = this.boxes()[i];
        fillRR(ctx, b, 36, WHITE, {});
        const [cx, cy] = this.badgePos(i);
        circle(ctx, cx, cy, 36, BADGE[i], WHITE, 6);
        letter(ctx, cx, cy, LETTERS[i], 40, WHITE);
        if (right) { strokeRR(ctx, inset(b, 7), 29, GREEN, 14); tick(ctx, ...this.tickPos(i)); }
      },
    }),
    Pills: Object.assign({}, base, {
      background: "Bokeh", colors: Object.assign({}, base.colors, { optRight: WHITE }),
      question(ctx) { fillRR(ctx, Q_BOX, 50, WHITE, {}); },
      option(ctx, i, right) {
        const b = this.boxes()[i], r = (b[3] - b[1]) / 2;
        fillRR(ctx, b, r, right ? grad(ctx, b, GREEN_HI, GREEN_DEEP) : WHITE, { dy: 8, blur: 20 });
        const [cx, cy] = this.badgePos(i);
        circle(ctx, cx, cy, 50, right ? WHITE : BADGE[i]);
        letter(ctx, cx, cy, LETTERS[i], 52, right ? GREEN : WHITE);
        if (right) tick(ctx, b[2] - 70, cy, 36, WHITE, null, GREEN);
      },
      answer(ctx, revealed) {
        if (revealed) fillRR(ctx, ANS_BOX, 100, grad(ctx, ANS_BOX, GREEN_HI, GREEN_DEEP), {});
        else { fillRR(ctx, ANS_BOX, 100, "rgba(255,255,255,0.16)"); strokeRR(ctx, ANS_BOX, 100, "rgba(255,255,255,0.55)", 4); }
      },
      stage(ctx, right) {
        fillRR(ctx, STAGE, 50, WHITE, {});
        if (right) strokeRR(ctx, inset(STAGE, 8), 42, GREEN, 14);
      },
    }),
    Rangeen: Object.assign({}, base, {
      background: "Waves", colors: Object.assign({}, base.colors, { opt: WHITE, optRight: WHITE }), optShadow: true,
      question(ctx, t) {
        fillRR(ctx, Q_BOX, 44, WHITE, {});
        const bar = [Q_BOX[0] + 40, Q_BOX[3] - 22, Q_BOX[2] - 40, Q_BOX[3] - 12];
        fillRR(ctx, bar, 5, grad(ctx, bar, t[0], t[1], true));
      },
      option(ctx, i, right) {
        const b = this.boxes()[i];
        fillRR(ctx, b, 30, right ? grad(ctx, b, GREEN_HI, GREEN_DEEP, true) : grad(ctx, b, mix(BADGE[i], WHITE, 0.12), mix(BADGE[i], "#000000", 0.3), true), { dy: 8, blur: 20 });
        const hl = [b[0] + 6, b[1] + 6, b[2] - 6, (b[1] + b[3]) / 2];
        fillRR(ctx, hl, 26, grad(ctx, hl, "rgba(255,255,255,0.24)", "rgba(255,255,255,0)"));
        const [cx, cy] = this.badgePos(i);
        circle(ctx, cx, cy, 46, WHITE);
        letter(ctx, cx, cy, LETTERS[i], 50, right ? GREEN : BADGE[i]);
        if (right) { strokeRR(ctx, b, 30, WHITE, 6); tick(ctx, b[2] - 70, cy, 36, WHITE, null, GREEN); }
      },
      answer(ctx, revealed) {
        if (revealed) { fillRR(ctx, ANS_BOX, 40, grad(ctx, ANS_BOX, GREEN_HI, GREEN_DEEP, true), {}); strokeRR(ctx, ANS_BOX, 40, WHITE, 5); }
        else { fillRR(ctx, ANS_BOX, 40, grad(ctx, ANS_BOX, "rgba(255,255,255,0.27)", "rgba(255,255,255,0.1)", true)); strokeRR(ctx, ANS_BOX, 40, WHITE, 3); }
      },
      stage(ctx, right, t) {
        if (right) { fillRR(ctx, STAGE, 44, grad(ctx, STAGE, GREEN_HI, GREEN_DEEP), {}); return; }
        fillRR(ctx, STAGE, 44, WHITE, {});
        const bar = [STAGE[0] + 40, STAGE[3] - 22, STAGE[2] - 40, STAGE[3] - 12];
        fillRR(ctx, bar, 5, grad(ctx, bar, t[0], t[1], true));
      },
    }),
    "Dark Cards": Object.assign({}, base, {
      background: "Dots",
      colors: { head: WHITE, q: WHITE, opt: WHITE, optRight: WHITE, label: "#9CA3AF", cd: WHITE, ans: WHITE },
      card: "rgba(17,20,32,0.93)",
      question(ctx, t) {
        fillRR(ctx, Q_BOX, 32, this.card, { blur: 40, dy: 12, color: "rgba(0,0,0,0.4)" });
        const top = [Q_BOX[0], Q_BOX[1], Q_BOX[2], Q_BOX[1] + 12];
        fillRR(ctx, top, 6, grad(ctx, top, t[0], t[1], true));
        strokeRR(ctx, Q_BOX, 32, "rgba(255,255,255,0.12)", 2);
      },
      option(ctx, i, right) {
        const b = this.boxes()[i], colour = right ? GREEN_HI : BADGE[i], cy = (b[1] + b[3]) / 2;
        fillRR(ctx, b, 26, right ? "rgba(20,83,45,0.94)" : this.card, { blur: 30, dy: 8, color: "rgba(0,0,0,0.35)" });
        strokeRR(ctx, b, 26, right ? colour : "rgba(255,255,255,0.12)", right ? 5 : 2);
        fillRR(ctx, [b[0] + 10, b[1] + 22, b[0] + 20, b[3] - 22], 5, colour);
        fillRR(ctx, [b[0] + 40, cy - 46, b[0] + 132, cy + 46], 22, colour);
        letter(ctx, b[0] + 86, cy, LETTERS[i], 46, WHITE);
        if (right) tick(ctx, ...this.tickPos(i), 40, GREEN_HI, null);
      },
      answer(ctx, revealed) {
        fillRR(ctx, ANS_BOX, 30, revealed ? "rgba(21,128,61,0.96)" : this.card, { blur: 30, dy: 10, color: "rgba(0,0,0,0.35)" });
        strokeRR(ctx, ANS_BOX, 30, revealed ? GREEN_HI : "rgba(255,255,255,0.16)", revealed ? 4 : 2);
      },
      stage(ctx, right, t) {
        fillRR(ctx, STAGE, 32, right ? "rgba(20,83,45,0.94)" : this.card, { blur: 40, dy: 12, color: "rgba(0,0,0,0.4)" });
        strokeRR(ctx, STAGE, 32, right ? GREEN_HI : vivid(t[0], t[1]), right ? 5 : 3);
      },
    }),
    Neon: Object.assign({}, base, {
      background: "Grid",
      colors: { head: WHITE, q: WHITE, opt: WHITE, optRight: WHITE, label: WHITE, cd: WHITE, ans: WHITE },
      fillDark: "rgba(6,8,24,0.8)",
      bgColors(c1, c2) { return [mix(c1, "#000000", 0.72), mix(c2, "#000000", 0.82)]; },
      pill(ctx, box, t) { fillRR(ctx, box, 44, this.fillDark); strokeRR(ctx, box, 44, vivid(t[0], t[1]), 3, vivid(t[0], t[1])); },
      question(ctx, t) { fillRR(ctx, Q_BOX, 30, this.fillDark); strokeRR(ctx, Q_BOX, 30, vivid(t[0], t[1]), 5, vivid(t[0], t[1])); },
      option(ctx, i, right) {
        const b = this.boxes()[i], colour = right ? "#39FF88" : NEON[i];
        fillRR(ctx, b, 34, right ? "rgba(57,255,136,0.18)" : this.fillDark);
        strokeRR(ctx, b, 34, colour, right ? 6 : 4, colour);
        const [cx, cy] = this.badgePos(i);
        ctx.save(); ctx.shadowColor = colour; ctx.shadowBlur = 20; circle(ctx, cx, cy, 46, null, colour, 3); ctx.restore();
        letter(ctx, cx, cy, LETTERS[i], 50, colour);
        if (right) tick(ctx, b[2] - 70, cy, 34, GREEN_HI, null);
      },
      answer(ctx, revealed) {
        fillRR(ctx, ANS_BOX, 34, revealed ? "rgba(22,163,74,0.43)" : this.fillDark);
        strokeRR(ctx, ANS_BOX, 34, revealed ? "#39FF88" : "#E0E7FF", revealed ? 5 : 3, revealed ? "#39FF88" : "#A5B4FC");
      },
      stage(ctx, right, t) {
        fillRR(ctx, STAGE, 34, this.fillDark);
        strokeRR(ctx, STAGE, 34, right ? "#39FF88" : vivid(t[0], t[1]), right ? 6 : 5, right ? "#39FF88" : vivid(t[0], t[1]));
      },
    }),
    Spotlight: Object.assign({}, base, {
      background: "Plain",
      colors: { head: "#FDE68A", q: WHITE, opt: WHITE, optRight: WHITE, label: "#FDE68A", cd: "#FDE68A", ans: WHITE },
      gold: "#FBBF24",
      bgColors(c1, c2) { return [mix(c1, "#000000", 0.7), mix(c2, "#000000", 0.88)]; },
      lit(ctx, box, r, light, baseFill) {
        fillRR(ctx, box, r, baseFill, { blur: 40, dy: 14, color: "rgba(0,0,0,0.5)" });
        ctx.save(); rrPath(ctx, ...box, r); ctx.clip();
        const cx = (box[0] + box[2]) / 2, w = box[2] - box[0], h = box[3] - box[1];
        const g = ctx.createRadialGradient(cx, box[1] - h * 0.1, 10, cx, box[1] - h * 0.1, Math.max(w * 0.45, h * 0.7));
        g.addColorStop(0, rgba(light, 0.45)); g.addColorStop(1, rgba(light, 0));
        ctx.fillStyle = g; ctx.fillRect(box[0], box[1], w, h);
        ctx.restore();
      },
      pill(ctx, box) { fillRR(ctx, box, 44, "rgba(12,12,20,0.9)"); strokeRR(ctx, box, 44, this.gold, 3); },
      question(ctx) { this.lit(ctx, Q_BOX, 36, "#FDE68A", "rgba(12,12,20,0.94)"); strokeRR(ctx, Q_BOX, 36, this.gold, 3); },
      option(ctx, i, right) {
        const b = this.boxes()[i];
        this.lit(ctx, b, 32, right ? "#4ADE80" : BADGE[i], right ? "rgba(10,40,24,0.96)" : "rgba(12,12,20,0.94)");
        strokeRR(ctx, b, 32, right ? GREEN_HI : "rgba(251,191,36,0.47)", right ? 5 : 2);
        const [cx, cy] = this.badgePos(i);
        circle(ctx, cx, cy, 36, BADGE[i], this.gold, 5);
        letter(ctx, cx, cy, LETTERS[i], 40, WHITE);
        if (right) tick(ctx, ...this.tickPos(i), 40, GREEN_HI, "#FDE68A");
      },
      answer(ctx, revealed) {
        this.lit(ctx, ANS_BOX, 36, revealed ? "#4ADE80" : "#FDE68A", revealed ? "rgba(10,40,24,0.96)" : "rgba(12,12,20,0.94)");
        strokeRR(ctx, ANS_BOX, 36, revealed ? GREEN_HI : this.gold, revealed ? 4 : 3);
      },
      stage(ctx, right) {
        const [x0, y0, x1, y1] = STAGE, cx = (x0 + x1) / 2;
        ctx.save(); ctx.filter = "blur(30px)"; ctx.fillStyle = "rgba(254,243,199,0.13)";
        ctx.beginPath(); ctx.moveTo(cx - 60, y0 - 60); ctx.lineTo(cx + 60, y0 - 60); ctx.lineTo(x1 - 40, y1); ctx.lineTo(x0 + 40, y1); ctx.fill(); ctx.restore();
        this.lit(ctx, STAGE, 40, right ? "#4ADE80" : "#FEF3C7", right ? "rgba(10,40,24,0.96)" : "rgba(14,14,24,0.92)");
        strokeRR(ctx, STAGE, 40, right ? GREEN_HI : this.gold, right ? 6 : 3);
      },
    }),
  };
  DESIGNS.Classic.background = "Plain";

  // ---------- timing ----------
  function timeline(dq, da, timer, answerSecs) {
    const appear = [0, 1, 2, 3].map((i) => OPT_FIRST + OPT_STAGGER * i);
    const tq = 0.4, tc = Math.max(tq + dq + 0.4, appear[3] + FADE + 0.3), tr = tc + timer;
    return { appear, tq, tc, tr, ta: tr + 0.5, timer, end: tr + Math.max(answerSecs, 0.5 + da + 0.6) };
  }
  /** One timeline per question; with a target length, longer/shorter answers and countdowns to hit it. */
  function planTimings(voices, timer, answerSecs, target) {
    const build = (t, a) => voices.map(([dq, da]) => timeline(dq, da, t, a));
    const length = (ts) => ts.reduce((s, T) => s + T.end, 0);
    let t = timer, a = answerSecs;
    if (!target) return build(t, a);
    if (length(build(t, a)) > target) {
      a = 0;
      while (t > MIN_TIMER && length(build(t, a)) > target) t--;
    }
    let ts = build(t, a);
    const spare = target - length(ts);
    if (spare > 0) ts = voices.map(([dq, da], k) => timeline(dq, da, t, ts[k].end - ts[k].tr + spare / voices.length));
    return ts;
  }

  // ---------- one question: pre-drawn layers ----------
  function canvas(w = W, h = H) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  /** iPhone Safari has a small total canvas memory budget: give the pixels back as soon as we're done. */
  function free(...cs) { for (const c of cs.flat()) if (c && c.width) { c.width = 0; c.height = 0; } }
  function freeLayers(L) { free(L.base, L.reveal, L.opts || [], L.gallery || []); }

  function buildLayers(q, number, s, design, theme) {
    const L = {};
    const c = design.colors;
    const head = s.showHead ? `${s.title || "QUIZ"} #${number}` : "";
    const common = canvas(), cx = common.getContext("2d");
    if (head) {
      cx.font = `800 46px ${LATIN_FONT}`;
      const w = cx.measureText(head).width + 90;
      design.pill(cx, [(W - w) / 2, 120, (W + w) / 2, 208], theme);
      text(cx, head, W / 2, 164, 900, 80, 46, 30, c.head);
    }
    design.question(cx, theme);
    text(cx, q.question, (Q_BOX[0] + Q_BOX[2]) / 2, (Q_BOX[1] + Q_BOX[3]) / 2, Q_BOX[2] - Q_BOX[0] - 90, Q_BOX[3] - Q_BOX[1] - 60, 78, 34, c.q, design.qShadow);

    L.base = canvas(); const bx = L.base.getContext("2d");
    bx.drawImage(common, 0, 0);
    design.answer(bx, false);

    const single = q.type === "single";
    L.opts = [];
    if (single) {
      const card = canvas(); design.stage(card.getContext("2d"), false, theme); L.opts.push(card);
      if (q.qImage) { const p = canvas(); drawCover(p.getContext("2d"), q.qImage, ...design.stagePicBox()); L.opts.push(p); }
      L.gallery = (q.gallery || []).map((img) => { const p = canvas(); drawCover(p.getContext("2d"), img, ...design.stagePicBox()); return p; });
    } else {
      for (let i = 0; i < 4; i++) {
        const o = canvas(), ox = o.getContext("2d");
        design.option(ox, i, false, theme);
        text(ox, q.options[i], ...design.optText(i), c.opt, design.optShadow);
        L.opts.push(o);
      }
    }

    L.reveal = canvas(); const rx = L.reveal.getContext("2d");
    rx.drawImage(common, 0, 0);
    design.answer(rx, true);
    let answer;
    if (single) {
      design.stage(rx, true, theme);
      const pic = q.aImage || q.qImage;
      if (pic) drawCover(rx, pic, ...design.stagePicBox());
      else text(rx, q.answer, (STAGE[0] + STAGE[2]) / 2, (STAGE[1] + STAGE[3]) / 2, 820, 560, 120, 40, c.q, design.qShadow);
      if (pic) tick(rx, STAGE[2] - 70, STAGE[1] + 70, 48);
      answer = q.answer || "✓";
    } else {
      for (let i = 0; i < 4; i++) {
        const right = i === q.correct;
        rx.save(); if (!right) rx.globalAlpha = design.dim;
        design.option(rx, i, right, theme);
        text(rx, q.options[i], ...design.optText(i), right ? c.optRight : c.opt, design.optShadow);
        rx.restore();
      }
      const opt = q.options[q.correct];
      answer = opt ? `${LETTERS[q.correct]}  ·  ${opt}` : `Option ${LETTERS[q.correct]}`;
    }
    rx.save(); rx.globalAlpha = 0.85;
    text(rx, "SAHI JAWAB", W / 2, 1540, 600, 50, 32, 32, c.ans); rx.restore();
    text(rx, answer, W / 2, 1625, 860, 110, 64, 30, c.ans);
    free(common);
    return L;
  }

  // ---------- countdown (drawn live every frame) ----------
  function countdown(ctx, style, t, T, colour, label) {
    const { tc, tr, timer } = T;
    ctx.save();
    ctx.globalAlpha = 0.8;
    text(ctx, "JAWAB", W / 2, 1543, 600, 50, 30, 30, label);
    ctx.restore();
    if (t < tc) { text(ctx, "?", W / 2, 1612, 600, 120, 96, 96, colour); return; }
    const left = Math.max(0, tr - t), j = Math.min(timer - 1, Math.floor(t - tc));
    const num = String(timer - j), pop = 1 + 0.3 * Math.max(0, 1 - (t - tc - j) / 0.15);
    const frac = left / timer;
    if (style === "Circle ring") {
      const cx = W / 2, cy = 1600;
      ctx.save(); ctx.lineWidth = 14; ctx.lineCap = "round";
      ctx.strokeStyle = rgba(colour, 0.25); ctx.beginPath(); ctx.arc(cx, cy, 75, 0, 7); ctx.stroke();
      ctx.strokeStyle = colour; ctx.beginPath(); ctx.arc(cx, cy, 75, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      ctx.restore();
      text(ctx, num, cx, cy + 2, 300, 120, Math.round(70 * pop), 40, colour);
    } else if (style === "Color bar") {
      const col = frac > 0.5 ? mix("#F5A524", "#22C55E", (frac - 0.5) * 2) : mix("#E5484D", "#F5A524", frac * 2);
      fillRR(ctx, [110, 1614, 970, 1642], 14, rgba(colour, 0.2));
      if (frac > 0) fillRR(ctx, [110, 1614, 110 + 860 * frac, 1642], 14, col);
      text(ctx, num, W / 2, 1566, 300, 90, Math.round(66 * pop), 40, colour);
    } else {
      fillRR(ctx, [110, 1671, 970, 1681], 5, rgba(colour, 0.2));
      if (frac > 0) fillRR(ctx, [110, 1671, 110 + 860 * frac, 1681], 5, colour);
      text(ctx, num, W / 2, 1610, 300, 130, Math.round(92 * pop), 50, colour);
    }
  }

  const fadeIn = (t, start, d) => Math.max(0, Math.min(1, (t - start) / d));

  function drawFrame(ctx, bg, L, q, T, t, s, design) {
    ctx.drawImage(bg, 0, 0);
    const { tr } = T, revealA = fadeIn(t, tr, REVEAL_FADE);
    if (revealA < 1) {
      ctx.drawImage(L.base, 0, 0);
      L.opts.forEach((o, i) => {
        const a = fadeIn(t, T.appear[i], FADE);
        if (a > 0) { ctx.globalAlpha = a; ctx.drawImage(o, 0, 0); ctx.globalAlpha = 1; }
      });
      if (q.type === "single" && t < tr) {
        if (L.gallery && L.gallery.length) {
          const start = T.appear[1], n = L.gallery.length;
          const slot = Math.min(1.2, Math.max(0.5, (tr - start) / n));
          if (t >= start) ctx.drawImage(L.gallery[Math.floor((t - start) / slot) % n], 0, 0);
        } else if (!q.qImage && t >= T.appear[0]) {
          ctx.globalAlpha = fadeIn(t, T.appear[0], FADE);
          text(ctx, "?", (STAGE[0] + STAGE[2]) / 2, (STAGE[1] + STAGE[3]) / 2, 600, 420, 320, 320, design.colors.q);
          ctx.globalAlpha = 1;
        }
      }
      if (t < tr) countdown(ctx, s.countdown, t, T, design.colors.cd, design.colors.label);
    }
    if (revealA > 0) { ctx.globalAlpha = revealA; ctx.drawImage(L.reveal, 0, 0); ctx.globalAlpha = 1; }
  }

  function prepare(s) {
    const design = DESIGNS[s.design] || DESIGNS.Classic;
    const theme = THEMES[s.theme] || THEMES.Purple;
    const bg = canvas();
    const kind = s.background === "Auto" || !s.background ? design.background : s.background;
    drawBackground(bg.getContext("2d"), kind, ...design.bgColors(...theme));
    return { design, theme, bg };
  }

  /** A still of question q at time `when` ("count" = countdown running, "reveal" = answer shown). */
  function renderStill(target, q, s, when = "count", number = 1) {
    const { design, theme, bg } = prepare(s);
    const T = timeline(2.5, 2.0, s.timer, s.answerSecs);
    const L = buildLayers(q, number, s, design, theme);
    const full = canvas(), fx = full.getContext("2d");
    const t = when === "reveal" ? T.tr + 0.7 : T.tc + Math.min(1.4, s.timer - 0.5);
    drawFrame(fx, bg, L, q, T, t, s, design);
    const tx = target.getContext("2d");
    tx.drawImage(full, 0, 0, target.width, target.height);
    freeLayers(L); free(full, bg);
  }

  // ---------- audio ----------
  function b64ToBytes(b64) { const bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

  /** Spoken text via Google's TTS (same voice the desktop app falls back to). Needs internet; in the APK the
   *  request goes through the native HTTP plugin (a normal web page can't read it). Returns AudioBuffer|null. */
  async function speak(textStr, actx) {
    textStr = String(textStr || "").trim();
    if (!textStr) return null;
    const lang = URDU.test(textStr) ? "ur" : "en";
    const parts = [];
    let rest = textStr;
    while (rest.length) {
      let cut = rest.length <= 180 ? rest.length : Math.max(rest.lastIndexOf(" ", 180), 60);
      parts.push(rest.slice(0, cut)); rest = rest.slice(cut).trim();
    }
    const buffers = [];
    for (const part of parts) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(part)}`;
      let bytes;
      const http = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
        && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
      if (http) {
        const res = await http.get({ url, responseType: "arraybuffer", headers: { "User-Agent": "Mozilla/5.0" } });
        if (res.status !== 200) throw new Error("TTS " + res.status);
        bytes = typeof res.data === "string" ? b64ToBytes(res.data) : new Uint8Array(res.data);
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error("TTS " + res.status);
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      buffers.push(await actx.decodeAudioData(bytes.buffer.slice(0)));
    }
    if (buffers.length === 1) return buffers[0];
    const total = buffers.reduce((n, b) => n + b.length, 0), sr = buffers[0].sampleRate;
    const out = actx.createBuffer(1, total, sr);
    let off = 0;
    for (const b of buffers) { out.getChannelData(0).set(b.getChannelData(0), off); off += b.length; }
    return out;
  }

  function scheduleTick(ctx, name, when, second) {
    if (name === "Koi nahi") return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    let f = 1500, amp = 0.35, dur = 0.09;
    if (name === "Clock") { f = second % 2 ? 1150 : 1900; amp = 0.3; dur = 0.07; }
    if (name === "Beep") { f = 880; amp = 0.22; dur = 0.14; }
    if (name === "Drum") { f = 70; amp = 0.6; dur = 0.3; o.frequency.setValueAtTime(140, when); o.frequency.exponentialRampToValueAtTime(55, when + 0.12); }
    else o.frequency.setValueAtTime(f, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(amp, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(ctx.destination);
    o.start(when); o.stop(when + dur + 0.02);
  }
  function scheduleDing(ctx, when) {
    for (const [f, a] of [[880, 0.4], [1320, 0.25]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(a, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 1.2);
      o.connect(g).connect(ctx.destination); o.start(when); o.stop(when + 1.25);
    }
  }
  function play(ctx, buffer, when, gain = 1) {
    if (!buffer) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buffer; g.gain.value = gain;
    src.connect(g).connect(ctx.destination); src.start(when);
  }

  // ---------- the whole video ----------
  const SIZES = { 720: [720, 1280], 1080: [1080, 1920], 2160: [2160, 3840] };

  async function pickVideoConfig(width, height) {
    const bitrate = Math.round(10e6 * (width * height) / (1080 * 1920));
    for (const codec of ["avc1.640034", "avc1.640033", "avc1.640028", "avc1.4d0034", "avc1.4d0028", "avc1.42e034", "avc1.42e028"]) {
      const cfg = { codec, width, height, bitrate, framerate: FPS, avc: { format: "avc" } };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) { /* try next */ }
    }
    return null;
  }
  async function pickAudioConfig() {
    if (typeof AudioEncoder === "undefined") return null;
    for (const [codec, kind] of [["mp4a.40.2", "aac"], ["opus", "opus"]]) {
      const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
      try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return [cfg, kind]; } catch (e) { /* next */ }
    }
    return null;
  }

  /**
   * questions: [{type:"mcq"|"single", question, options[4], correct, answer, qImage, aImage, gallery[]}] (images: ImageBitmap)
   * s: {design, theme, background, countdown, timer, answerSecs, length, voice, tick, music (AudioBuffer|null), showHead, title, res}
   * onProgress(fraction, message). Returns {blob, seconds, warnings}.
   */
  async function makeVideo(questions, s, onProgress) {
    if (typeof VideoEncoder === "undefined") throw new Error("Ye phone video encoder (WebCodecs) support nahi karta. Chrome / Android System WebView update karein.");
    const warnings = [];
    const [width, height] = SIZES[s.res] || SIZES[1080];
    let vcfg = await pickVideoConfig(width, height);
    if (!vcfg && s.res === 2160) { warnings.push("4K is phone par nahi bana, 1080p bani."); return makeVideo(questions, Object.assign({}, s, { res: 1080 }), onProgress).then((r) => (r.warnings.unshift(...warnings), r)); }
    if (!vcfg) throw new Error("Is phone par H.264 video encoder nahi mila.");

    // 1. Voices
    const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    const voices = [];
    let voiceFailed = false;
    for (let k = 0; k < questions.length; k++) {
      const q = questions[k];
      onProgress(0.02 + 0.08 * k / questions.length, `Awaz ${k + 1}/${questions.length}...`);
      let vq = null, va = null;
      if (s.voice && !voiceFailed) {
        try {
          vq = await speak(q.question, actx);
          const ans = q.type === "single" ? q.answer : q.options[q.correct];
          va = await speak((URDU.test(ans || q.question) ? "صحیح جواب: " : "Correct answer: ") + (ans || ""), actx);
        } catch (e) { voiceFailed = true; warnings.push("Awaz nahi bani (internet?): video bina awaz ke bani."); vq = va = null; }
      }
      voices.push({ vq, va, dur: [vq ? vq.duration : 1.2, va ? va.duration : 0.8] });
    }
    actx.close();

    // 2. Timing
    const Ts = planTimings(voices.map((v) => v.dur), s.timer, s.answerSecs, s.length || 0);
    const offsets = []; let total = 0;
    for (const T of Ts) { offsets.push(total); total += T.end; }

    // 3. Audio mix
    onProgress(0.11, "Awaz mix ho rahi hai...");
    const off = new OfflineAudioContext(2, Math.ceil(total * 48000), 48000);
    Ts.forEach((T, k) => {
      const o = offsets[k];
      play(off, voices[k].vq, o + T.tq); play(off, voices[k].va, o + T.ta);
      for (let j = 0; j < T.timer; j++) scheduleTick(off, s.tick, o + T.tc + j, j);
      scheduleDing(off, o + T.tr);
    });
    if (s.music) {
      const src = off.createBufferSource(), g = off.createGain();
      src.buffer = s.music; src.loop = true;
      g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.12, 1.5);
      g.gain.setValueAtTime(0.12, Math.max(1.6, total - 2.5)); g.gain.linearRampToValueAtTime(0.0001, total);
      src.connect(g).connect(off.destination); src.start(0);
    }
    const mixed = await off.startRendering();

    // 4. Encoders + muxer
    const acfg = await pickAudioConfig();
    if (!acfg) warnings.push("Is phone par audio encoder nahi: video bina awaz ke bani.");
    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width, height, frameRate: FPS },
      audio: acfg ? { codec: acfg[1], sampleRate: 48000, numberOfChannels: 2 } : undefined,
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
    let encError = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encError = e) });
    venc.configure(vcfg);
    if (acfg) {
      const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (encError = e) });
      aenc.configure(acfg[0]);
      const L = mixed.getChannelData(0), R = mixed.getChannelData(1), step = 4800;
      for (let i = 0; i < mixed.length; i += step) {
        const n = Math.min(step, mixed.length - i), data = new Float32Array(n * 2);
        data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
    }

    // 5. Frames
    const frame = canvas(width, height), fctx = frame.getContext("2d");
    const work = canvas(), wctx = work.getContext("2d");
    const { design, theme, bg } = prepare(s);
    const nFrames = Math.round(total * FPS);
    let f = 0;
    for (let k = 0; k < questions.length; k++) {
      const q = questions[k], T = Ts[k], o = offsets[k];
      onProgress(0.15, `Sawal ${k + 1}/${questions.length}: tasveer...`);
      const L = buildLayers(q, k + 1, s, design, theme);
      const last = k === questions.length - 1 ? nFrames : Math.round((o + T.end) * FPS);
      for (; f < last; f++) {
        if (encError) throw encError;
        const t = f / FPS - o;
        drawFrame(wctx, bg, L, q, T, t, s, design);
        fctx.drawImage(work, 0, 0, width, height);
        const vf = new VideoFrame(frame, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 });
        vf.close();
        while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
        if (f % 10 === 0) {
          onProgress(0.15 + 0.83 * f / nFrames, `Sawal ${k + 1}/${questions.length}: video ${Math.round(100 * f / nFrames)}%`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      freeLayers(L);
    }
    await venc.flush(); venc.close();
    free(frame, work, bg);
    if (encError) throw encError;
    muxer.finalize();
    onProgress(1, "Tayyar!");
    return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), seconds: total, warnings, size: [width, height] };
  }

  window.QuizRender = { DESIGNS, THEMES, BACKGROUNDS, COUNTDOWNS, TICKS, renderStill, makeVideo, W, H };
})();
