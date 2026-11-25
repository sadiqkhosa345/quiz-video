/* Quiz screen: questions, style choices, preview and "Video banao". Text is kept in localStorage;
 * pictures live only while the app is open. */
(function () {
  "use strict";
  const R = window.QuizRender;
  const $ = (id) => document.getElementById(id);
  const DRAFT = "quizDraft.v1", PREFS = "quizPrefs.v1";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const newQ = () => ({ type: "mcq", question: "", options: ["", "", "", ""], correct: 0, answer: "", qImage: null, aImage: null, gallery: [] });

  let quiz = (store.get(DRAFT, null) || []).map((q) => Object.assign(newQ(), q, { qImage: null, aImage: null, gallery: [] }));
  if (!quiz.length) quiz = [newQ()];
  let qi = 0;
  const prefs = Object.assign({ design: "Classic", theme: "Purple", background: "Auto", countdown: "Number + bar", timer: 10,
    answerSecs: 3, length: 25, res: "1080", tick: "Clock", voice: true, showHead: false, title: "QUIZ" }, store.get(PREFS, {}));
  let music = null, musicName = "", lastVideo = null;

  function toast(msg, ms = 3500) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), ms);
  }

  // ---------- question editor ----------
  const optIns = [...document.querySelectorAll(".optIn")];
  function storeQ() {
    const q = quiz[qi];
    q.question = $("qText").value.trim();
    q.options = optIns.map((e) => e.value.trim());
    const c = document.querySelector('input[name="correct"]:checked');
    q.correct = c ? +c.value : 0;
    q.answer = $("answer").value.trim();
    store.set(DRAFT, quiz.map(({ qImage, aImage, gallery, ...rest }) => rest));
  }
  function loadQ() {
    const q = quiz[qi];
    $("qText").value = q.question;
    optIns.forEach((e, i) => (e.value = q.options[i] || ""));
    document.querySelectorAll('input[name="correct"]').forEach((r) => (r.checked = +r.value === q.correct));
    $("answer").value = q.answer;
    setType(q.type, false);
    $("qCount").textContent = `${qi + 1} / ${quiz.length}`;
    picLabels();
  }
  function setType(type, save = true) {
    quiz[qi].type = type;
    document.querySelectorAll("#qType button").forEach((b) => b.classList.toggle("on", b.dataset.v === type));
    $("mcqBox").hidden = type !== "mcq";
    $("singleBox").hidden = type !== "single";
    if (save) { storeQ(); drawThumbs(); }
  }
  function picLabels() {
    const q = quiz[qi];
    $("aImgBtn").firstChild.textContent = q.aImage ? "✓ Jawab ki image" : "Jawab ki image";
    $("qImgBtn").firstChild.textContent = q.qImage ? "✓ Sawal ki image" : "Sawal ki image";
    $("galBtn").firstChild.textContent = q.gallery.length ? `✓ ${q.gallery.length} bari bari images` : "Bari bari images";
    $("aImgBtn").classList.toggle("on", !!q.aImage);
    $("qImgBtn").classList.toggle("on", !!q.qImage);
    $("galBtn").classList.toggle("on", q.gallery.length > 0);
    const strip = $("galStrip"); strip.innerHTML = "";
    for (const img of q.gallery) {
      const c = document.createElement("canvas");
      c.height = 128; c.width = Math.round(128 * img.width / img.height);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.style.height = "64px"; c.style.borderRadius = "8px";
      strip.appendChild(c);
    }
  }
  async function loadImage(file) {
    const bmp = await createImageBitmap(file);
    const max = 1600, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (s === 1) return bmp;
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    let small;
    try { small = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" }); }
    catch (e) {                        // older Safari: no resize options
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(bmp, 0, 0, w, h);
      small = await createImageBitmap(c);
      c.width = c.height = 0;
    }
    bmp.close();
    return small;
  }

  document.querySelectorAll("#qType button").forEach((b) => b.addEventListener("click", () => setType(b.dataset.v)));
  $("prevQ").onclick = () => { storeQ(); qi = Math.max(0, qi - 1); loadQ(); };
  $("nextQ").onclick = () => { storeQ(); qi = Math.min(quiz.length - 1, qi + 1); loadQ(); };
  $("addQ").onclick = () => { storeQ(); quiz.splice(qi + 1, 0, Object.assign(newQ(), { type: quiz[qi].type })); qi++; loadQ(); };
  $("delQ").onclick = () => {
    if (quiz.length === 1) { quiz[0] = newQ(); } else { quiz.splice(qi, 1); qi = Math.max(0, qi - 1); }
    loadQ(); storeQ();
  };
  ["qText", "answer"].forEach((id) => $(id).addEventListener("change", storeQ));
  optIns.forEach((e) => e.addEventListener("change", storeQ));
  document.querySelectorAll('input[name="correct"]').forEach((r) => r.addEventListener("change", storeQ));
  $("aImg").onchange = async (e) => { if (e.target.files[0]) { quiz[qi].aImage = await loadImage(e.target.files[0]); picLabels(); } e.target.value = ""; };
  $("qImg").onchange = async (e) => { if (e.target.files[0]) { quiz[qi].qImage = await loadImage(e.target.files[0]); picLabels(); } e.target.value = ""; };
  $("gal").onchange = async (e) => {
    const files = [...e.target.files].slice(0, 12);
    if (files.length) {
      toast("Images load ho rahi hain...");
      quiz[qi].gallery = await Promise.all(files.map(loadImage));
      picLabels();
      toast(quiz[qi].aImage ? `${files.length} images lag gayin.` : `${files.length} images lag gayin. Ab "Jawab ki image" chunein aur naam likhein.`, 5000);
    }
    e.target.value = "";
  };
  $("clearPics").onclick = () => { Object.assign(quiz[qi], { qImage: null, aImage: null, gallery: [] }); picLabels(); };

  // ---------- style ----------
  function sample() {
    const q = quiz[qi];
    if (q.type === "single") return { type: "single", question: q.question || "دنیا کا سب سے اونچا پہاڑ کون سا ہے؟", answer: q.answer || "ماؤنٹ ایورسٹ", qImage: q.qImage, aImage: q.aImage, gallery: q.gallery, options: [] };
    return q.question ? Object.assign({}, q) : { type: "mcq", question: "پاکستان کا دارالحکومت کون سا ہے؟", options: ["لاہور", "کراچی", "اسلام آباد", "پشاور"], correct: 2 };
  }
  function settings() {
    return {
      design: prefs.design, theme: prefs.theme, background: prefs.background, countdown: prefs.countdown,
      timer: Math.max(3, Math.min(30, +$("timer").value || 10)), answerSecs: Math.max(1, Math.min(30, +$("answerSecs").value || 3)),
      length: Math.max(0, +$("length").value || 0), res: +$("res").value, tick: $("tick").value, voice: $("voice").checked,
      showHead: $("showHead").checked, title: $("title").value.trim() || "QUIZ", music,
    };
  }
  function savePrefs() {
    const s = settings();
    Object.assign(prefs, { timer: s.timer, answerSecs: s.answerSecs, length: s.length, res: String(s.res), tick: s.tick, voice: s.voice, showHead: s.showHead, title: s.title });
    store.set(PREFS, prefs);
  }
  function chips(el, values, key, onPick) {
    el.innerHTML = "";
    for (const v of values) {
      const b = document.createElement("button");
      b.className = "chip" + (prefs[key] === v ? " on" : ""); b.textContent = v;
      b.onclick = () => { prefs[key] = v; savePrefs(); chips(el, values, key, onPick); onPick && onPick(); };
      el.appendChild(b);
    }
  }
  let thumbJob = 0;
  async function drawThumbs() {
    const job = ++thumbJob, el = $("designs");
    el.innerHTML = "";
    for (const name of Object.keys(R.DESIGNS)) {
      const b = document.createElement("button");
      b.className = "thumb" + (prefs.design === name ? " on" : "");
      const c = document.createElement("canvas"); c.width = 144; c.height = 256;
      b.appendChild(c); b.appendChild(document.createTextNode(name));
      b.onclick = () => { prefs.design = name; savePrefs(); el.querySelectorAll(".thumb").forEach((t) => t.classList.toggle("on", t === b)); };
      el.appendChild(b);
    }
    const s = settings();
    for (const [k, name] of Object.keys(R.DESIGNS).entries()) {
      if (job !== thumbJob) return;
      await new Promise((r) => setTimeout(r, 0));
      R.renderStill(el.children[k].querySelector("canvas"), sample(), Object.assign({}, s, { design: name }), "count");
    }
  }
  function swatches() {
    const el = $("themes"); el.innerHTML = "";
    for (const [name, [a, b]] of Object.entries(R.THEMES)) {
      const s = document.createElement("button");
      s.className = "sw" + (prefs.theme === name ? " on" : ""); s.title = name;
      s.style.background = `linear-gradient(135deg, ${a}, ${b})`;
      s.onclick = () => { prefs.theme = name; savePrefs(); swatches(); drawThumbs(); };
      el.appendChild(s);
    }
  }

  // ---------- preview ----------
  $("previewBtn").onclick = () => {
    storeQ();
    const s = settings(), q = sample();
    R.renderStill($("pv1"), q, s, "count", qi + 1);
    R.renderStill($("pv2"), q, s, "reveal", qi + 1);
    $("previewModal").hidden = false;
  };
  $("closePreview").onclick = () => ($("previewModal").hidden = true);

  // ---------- music ----------
  $("music").onchange = async (e) => {
    const f = e.target.files[0];
    if (f) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        music = await ctx.decodeAudioData(await f.arrayBuffer()); ctx.close();
        musicName = f.name; $("musicBtn").firstChild.textContent = "✓ " + f.name.slice(0, 24); $("musicBtn").classList.add("on");
      } catch (err) { toast("Ye music file nahi chali."); }
    }
    e.target.value = "";
  };
  $("clearMusic").onclick = () => { music = null; musicName = ""; $("musicBtn").firstChild.textContent = "Music chuno"; $("musicBtn").classList.remove("on"); };

  // ---------- make video ----------
  function check() {
    const qs = quiz.filter((q) => q.question.trim());
    if (!qs.length) return toast("Pehle sawal likhein."), null;
    for (const [n, q] of qs.entries()) {
      if (q.type === "single" && !(q.answer || q.aImage)) return toast(`Sawal ${n + 1}: jawab likhein ya "Jawab ki image" chunein.`), null;
      if (q.type === "mcq" && q.options.filter(Boolean).length < 2) return toast(`Sawal ${n + 1}: kam az kam 2 options likhein.`), null;
      if (q.type === "mcq" && !q.options[q.correct]) return toast(`Sawal ${n + 1}: sahi jawab wala option khali hai.`), null;
    }
    return qs;
  }
  $("makeBtn").onclick = async () => {
    storeQ(); savePrefs();
    const qs = check();
    if (!qs) return;
    const btn = $("makeBtn");
    // iPhone only lets sound start from a tap: open the audio now, before anything else waits.
    let liveAudio = null;
    try { liveAudio = new (window.AudioContext || window.webkitAudioContext)(); liveAudio.resume(); } catch (e) { /* none */ }
    btn.disabled = true; $("progressBox").hidden = false; $("result").hidden = true;
    const keepAwake = navigator.wakeLock ? await navigator.wakeLock.request("screen").catch(() => null) : null;
    const started = performance.now();
    try {
      const out = await R.makeVideo(qs, Object.assign(settings(), { liveAudio, forceRealtime: /[?&]realtime/.test(location.search) }), (f, msg) => { $("bar").style.width = Math.round(f * 100) + "%"; $("status").textContent = msg; });
      lastVideo = out;
      const url = URL.createObjectURL(out.blob);
      $("player").src = url;
      $("result").hidden = false;
      $("resultInfo").textContent = `${Math.round(out.seconds)}s video · ${out.size[0]}×${out.size[1]} · ${(out.blob.size / 1e6).toFixed(1)} MB · ${Math.round((performance.now() - started) / 1000)}s mein bani`
        + (out.warnings.length ? " · " + out.warnings.join(" ") : "");
      $("status").textContent = "Tayyar!";
    } catch (err) {
      console.error(err);
      $("status").textContent = "Video nahi bani: " + (err && err.message ? err.message : err);
    } finally {
      btn.disabled = false;
      if (liveAudio) liveAudio.close().catch(() => {});
      if (keepAwake) keepAwake.release().catch(() => {});
    }
  };

  // ---------- save / share ----------
  const native = () => window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  function bytesToB64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }
  async function writeNative(dir) {
    const { Filesystem } = window.Capacitor.Plugins;
    const name = `quiz_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.mp4`;
    const path = `QuizVideos/${name}`;
    const bytes = new Uint8Array(await lastVideo.blob.arrayBuffer());
    const CH = 3 * 1024 * 1024;           // multiple of 3: each piece is complete base64
    for (let i = 0; i < bytes.length; i += CH) {
      const data = bytesToB64(bytes.subarray(i, i + CH));
      if (i === 0) await Filesystem.writeFile({ path, data, directory: dir, recursive: true });
      else await Filesystem.appendFile({ path, data, directory: dir });
    }
    return (await Filesystem.getUri({ path, directory: dir })).uri;
  }
  $("saveBtn").onclick = async () => {
    if (!lastVideo) return;
    if (native()) {
      try { await writeNative("DOCUMENTS"); toast("Save ho gayi: Documents/QuizVideos", 5000); }
      catch (err) { toast("Save nahi hui: " + err.message, 6000); }
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(lastVideo.blob); a.download = "quiz_video.mp4"; a.click();
    }
  };
  $("shareBtn").onclick = async () => {
    if (!lastVideo) return;
    try {
      if (native()) {
        const uri = await writeNative("CACHE");
        await window.Capacitor.Plugins.Share.share({ title: "Quiz video", files: [uri] });
      } else {
        const file = new File([lastVideo.blob], "quiz_video.mp4", { type: "video/mp4" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: "Quiz video" });
        else $("saveBtn").click();
      }
    } catch (err) { if (!/cancel/i.test(err.message || "")) toast("Share nahi hua: " + err.message, 6000); }
  };

  // ---------- start ----------
  async function start() {
    $("timer").value = prefs.timer; $("answerSecs").value = prefs.answerSecs; $("length").value = prefs.length;
    $("res").value = prefs.res; $("voice").checked = prefs.voice; $("showHead").checked = prefs.showHead; $("title").value = prefs.title;
    $("tick").innerHTML = R.TICKS.map((t) => `<option>${t}</option>`).join(""); $("tick").value = prefs.tick;
    ["timer", "answerSecs", "length", "res", "tick", "voice", "showHead", "title"].forEach((id) => $(id).addEventListener("change", savePrefs));
    $("showHead").addEventListener("change", drawThumbs);
    if (!native()) {                   // a web page can't fetch the TTS voice (browser blocks it): Android app only
      $("voice").checked = false; $("voice").disabled = true;
      $("voice").nextElementSibling.textContent = "Awaz (sawal + jawab bolna) sirf Android app mein. Ticks aur music yahan bhi.";
    }
    swatches();
    chips($("backgrounds"), R.BACKGROUNDS, "background", drawThumbs);
    chips($("countdowns"), R.COUNTDOWNS, "countdown", drawThumbs);
    loadQ();
    try { await Promise.all([document.fonts.load('700 40px "Noto Nastaliq Urdu"', "پاکستان"), document.fonts.load('400 40px "Noto Nastaliq Urdu"', "پاکستان")]); } catch (e) { /* fall back */ }
    drawThumbs();
    if (typeof VideoEncoder === "undefined") toast("Ye browser video nahi bana sakta (WebCodecs nahi). Chrome update karein.", 8000);
  }
  start();
})();
