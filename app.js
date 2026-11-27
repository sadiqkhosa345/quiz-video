/* Quiz screen: questions, style choices, preview and "Video banao". Text is kept in localStorage;
 * pictures live only while the app is open. */
(function () {
  "use strict";
  const R = window.QuizRender;
  const $ = (id) => document.getElementById(id);
  // iPhone mutes web sound when the side (silent) switch is on, unless the page asks for "playback" audio.
  function playbackAudio() {
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* older iOS */ }
  }
  playbackAudio();
  const DRAFT = "quizDraft.v1", PREFS = "quizPrefs.v1";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const newQ = () => ({ type: "mcq", question: "", options: ["", "", "", ""], correct: 0, answer: "", qImage: null, aImage: null, gallery: [], optImages: [null, null, null, null] });

  let quiz = (store.get(DRAFT, null) || []).map((q) => Object.assign(newQ(), q, { qImage: null, aImage: null, gallery: [], optImages: [null, null, null, null] }));
  if (!quiz.length) quiz = [newQ()];
  let qi = 0;
  const prefs = Object.assign({ design: "Classic", theme: "Purple", background: "Auto", countdown: "Number + bar", timer: 10,
    answerSecs: 3, length: 25, res: "1080", tick: "Clock", qSound: "Whoosh", aSound: "Ding", endSound: "3-2-1 beep", voice: true, showHead: false, title: "QUIZ" }, store.get(PREFS, {}));
  let music = null, musicName = "", lastVideo = null, bgVideo = null;

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
    store.set(DRAFT, quiz.map(({ qImage, aImage, gallery, optImages, ...rest }) => rest));
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
    document.querySelectorAll(".optPic").forEach((b) => {
      const img = q.optImages[+b.dataset.i];
      b.classList.toggle("on", !!img);
      b.style.backgroundImage = img ? `url(${thumbUrl(img)})` : "";
      document.querySelector(`.optClear[data-i="${b.dataset.i}"]`).hidden = !img;
    });
    const strip = $("galStrip"); strip.innerHTML = "";
    for (const img of q.gallery) {
      const c = document.createElement("canvas");
      c.height = 128; c.width = Math.round(128 * img.width / img.height);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.style.height = "64px"; c.style.borderRadius = "8px";
      strip.appendChild(c);
    }
  }
  const thumbs = new WeakMap();
  function thumbUrl(img) {
    if (!thumbs.has(img)) {
      const c = document.createElement("canvas"), s = 96 / Math.min(img.width, img.height);
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      thumbs.set(img, c.toDataURL("image/jpeg", 0.8)); c.width = c.height = 0;
    }
    return thumbs.get(img);
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
  document.querySelectorAll(".optImg").forEach((inp) => (inp.onchange = async (e) => {
    const f = e.target.files[0], i = +inp.dataset.i;
    if (f) {
      try { quiz[qi].optImages[i] = await loadImage(f); picLabels(); drawThumbs(); }
      catch (err) { toast("Ye image nahi khuli."); }
    }
    e.target.value = "";
  }));
  document.querySelectorAll(".optClear").forEach((b) => (b.onclick = () => { quiz[qi].optImages[+b.dataset.i] = null; picLabels(); drawThumbs(); }));
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
      length: Math.max(0, +$("length").value || 0), res: +$("res").value, tick: $("tick").value, qSound: $("qSound").value, aSound: $("aSound").value, endSound: $("endSound").value, voice: $("voice").checked,
      showHead: $("showHead").checked, title: $("title").value.trim() || "QUIZ", music, bgVideo,
    };
  }
  function savePrefs() {
    const s = settings();
    Object.assign(prefs, { timer: s.timer, answerSecs: s.answerSecs, length: s.length, res: String(s.res), tick: s.tick, qSound: s.qSound, aSound: s.aSound, endSound: s.endSound, voice: s.voice, showHead: s.showHead, title: s.title });
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

  // ---------- background video ----------
  function clearBgVideo() {
    if (bgVideo) { URL.revokeObjectURL(bgVideo.src); bgVideo.removeAttribute("src"); bgVideo.load(); }
    bgVideo = null;
    $("bgVidBtn").firstChild.textContent = "🎬 Background video chuno"; $("bgVidBtn").classList.remove("on");
    $("clearBgVid").hidden = true;
    drawThumbs();
  }
  $("bgVid").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    toast("Video load ho rahi hai...");
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto"; v.loop = true;
    v.src = URL.createObjectURL(f);
    try {
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("bad")); setTimeout(() => rej(new Error("slow")), 20000); v.load(); });
      await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(1, (v.duration || 2) / 2); setTimeout(res, 3000); });
    } catch (err) { URL.revokeObjectURL(v.src); return toast("Ye video nahi chali. Koi aur (MP4) chunein."); }
    if (bgVideo) clearBgVideo();
    bgVideo = v;
    $("bgVidBtn").firstChild.textContent = "✓ " + f.name.slice(0, 22); $("bgVidBtn").classList.add("on");
    $("clearBgVid").hidden = false;
    toast("Background video lag gayi. Video awaz ke bina chalegi.", 4000);
    drawThumbs();
  };
  $("clearBgVid").onclick = clearBgVideo;

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
      const has = (i) => !!(q.options[i] || q.optImages[i]);
      if (q.type === "mcq" && [0, 1, 2, 3].filter(has).length < 2) return toast(`Sawal ${n + 1}: kam az kam 2 options likhein (ya image lagayein).`), null;
      if (q.type === "mcq" && !has(q.correct)) return toast(`Sawal ${n + 1}: sahi jawab wala option khali hai.`), null;
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
    playbackAudio();
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
      $("resultInfo").textContent = `${Math.round(out.seconds)}s video · ${out.size[0]}×${out.size[1]} · ${(out.blob.size / 1e6).toFixed(1)} MB · ${Math.round((performance.now() - started) / 1000)}s mein bani · awaz: ${out.audio === "none" ? "NAHI" : out.audio}`
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
    for (const [id, list] of [["tick", R.TICKS], ["qSound", R.Q_SOUNDS], ["aSound", R.A_SOUNDS], ["endSound", R.END_SOUNDS]]) {
      $(id).innerHTML = list.map((t) => `<option>${t}</option>`).join(""); $(id).value = prefs[id];
    }
    let fx = null;
    document.querySelectorAll("button.play").forEach((b) => (b.onclick = () => {
      try {
        playbackAudio();
        fx = fx || new (window.AudioContext || window.webkitAudioContext)();
        fx.resume(); R.previewSound(fx, b.dataset.k, $(b.dataset.sel).value);
      } catch (e) { toast("Awaz nahi chali."); }
    }));
    ["timer", "answerSecs", "length", "res", "tick", "qSound", "aSound", "endSound", "voice", "showHead", "title"].forEach((id) => $(id).addEventListener("change", savePrefs));
    $("showHead").addEventListener("change", drawThumbs);
    if (!native()) {                   // a web page can't fetch the TTS voice (browser blocks it): Android app only
      $("voice").checked = false; $("voice").disabled = true;
      $("voiceLbl").textContent = "Bolne wali awaz sirf app (Android / iPhone) mein chalti hai, browser mein nahi. Neeche wali awazein yahan bhi chalti hain.";
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
