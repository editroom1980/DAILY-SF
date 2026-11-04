// DAILY-SF：非公開の本棚（editroom1980/DAILY-SF-data）を、この iPhone に貼った鍵で GitHub の API から読む。
// 本棚の中身は Mac の アプリ/データを作る.py が毎朝送る。shelf.json（棚）、books/<id>.json（本文と読みと各文の秒）、audio/<id>.mp3（朗読）。
// 「長編にする」は requests/<id>.json を書き込むだけ。次の朝6時の予約タスクが読んで長編を書く。
(function () {
  "use strict";
  var REPO = "editroom1980/DAILY-SF-data";
  // 通知（Web Push）の公開鍵。秘密の側は Mac の ~/Library/Application Support/DAILY-SF/通知の鍵.json だけにある
  var VAPID = "BKUtPvNeI-3B8ox4e2vvhxH9gU0kz34FnIa01Kfi8EO-LjYTlixwSqaacShqB1dV-OJWmJ0GdDAfgvvlis2--oU";
  var $ = function (id) { return document.getElementById(id); };
  var rates = [0.8, 1, 1.2, 1.4];
  var saved = load();
  saved.pos = saved.pos || {};
  var state = { id: null, book: null, n: 0, playing: false, rate: rates.indexOf(saved.rate) >= 0 ? saved.rate : 1 };
  var shelf = null;
  var snd = $("snd");
  var lock = null;

  function load() { try { return JSON.parse(localStorage.getItem("dsf") || "{}"); } catch (e) { return {}; } }
  function save() { try { localStorage.setItem("dsf", JSON.stringify(saved)); } catch (e) {} }
  function token() { return saved.token || ""; }

  // ── GitHub の API ──
  function url(p) { return "https://api.github.com/repos/" + REPO + "/contents/" + p.split("/").map(encodeURIComponent).join("/"); }
  function head(raw) {
    return { Authorization: "Bearer " + token(), Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  }
  function gh(p, kind) {
    return fetch(url(p) + "?t=" + Date.now(), { headers: head(true), cache: "no-store" }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("鍵");
      if (r.status === 404) throw new Error("無い");
      if (!r.ok) throw new Error("GitHub " + r.status);
      return kind === "blob" ? r.blob() : r.json();
    });
  }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }

  // ── 画面の切り替え ──
  function show(name) {
    ["setup", "list", "reader"].forEach(function (k) { $(k).hidden = k !== name; });
    window.scrollTo(0, 0);
  }
  function note(id, text) { $(id).textContent = text || ""; $(id).hidden = !text; }

  // ── 本棚 ──
  function readShelf() {
    note("list-note", "");
    return gh("shelf.json").then(function (s) {
      shelf = s;
      saved.shelf = s; save();
      drawShelf();
      if (saved.rpend && Object.keys(saved.rpend).length) sendRatings();
    }).catch(function (e) {
      if (e.message === "鍵") { show("setup"); note("setup-note", "鍵が使えませんでした。期限が切れたか、DAILY-SF-data を選んでいない鍵です。作り直して貼ってください。"); return; }
      if (saved.shelf) { shelf = saved.shelf; drawShelf(); }
      note("list-note", e.message === "無い" ? "本棚はまだ空です。Mac の最初の送りを待っています。" : "読めませんでした（" + e.message + "）。前に読んだ本棚を出しています。");
    });
  }

  function bookRow(b, extra) {
    var p = saved.pos[b.id] || 0;
    return '<li><button type="button" class="book" data-open="' + b.id + '">' +
      '<span class="book-t">' + esc(b.title) + "</span>" +
      (b.intro ? '<span class="book-d">' + esc(b.intro) + "</span>" : "") +
      '<span class="book-m">' + (b.chars || 0).toLocaleString() + "字" + (b.audio ? "・朗読つき" : "") + (b.figs ? "・図解つき" : "") + (extra || "") +
      (stars(b.id) ? '<span class="book-r" aria-label="評価 星' + stars(b.id) + 'つ">' + "★★★★★".slice(0, stars(b.id)) + '<i>' + "★★★★★".slice(stars(b.id)) + "</i></span>" : "") +
      '<span class="book-p">' + (p > 0 && b.sentences ? "続きから " + Math.round(p / b.sentences * 100) + "%" : "") + "</span></span>" +
      "</button></li>";
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

  function allIds() {
    var ids = [];
    (shelf.days || []).forEach(function (d) { d.books.forEach(function (b) { ids.push(b.id); }); });
    (shelf.long || []).forEach(function (b) { ids.push(b.id); });
    return ids;
  }
  // はじめて本棚を読んだときは、今ある本をすべて読んだことにする（入れた日に15本が新着にならないように）
  function seenInit() {
    if (saved.seen) return;
    saved.seen = {}; allIds().forEach(function (id) { saved.seen[id] = 1; }); save();
  }
  function isNew(id) { return saved.seen && !saved.seen[id]; }
  function badge() {
    var n = allIds().filter(isNew).length;
    if (navigator.setAppBadge && "Notification" in window && Notification.permission === "granted") {
      (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(function () {});
    }
    return n;
  }

  function drawShelf() {
    seenInit();
    var h = [];
    var req = (shelf && shelf.requests) || {};
    if (shelf.long && shelf.long.length) {
      h.push('<h2 class="day">長編</h2><ol class="shelf">');
      shelf.long.forEach(function (b) { h.push(bookRow(b, ' <span class="tag">長編</span>' + (isNew(b.id) ? ' <span class="tag new">新着</span>' : ""))); });
      h.push("</ol>");
    }
    (shelf.days || []).forEach(function (d) {
      h.push('<h2 class="day">' + esc(d.label) + '</h2><ol class="shelf">');
      d.books.forEach(function (b) {
        var r = req[b.id];
        h.push(bookRow(b, (isNew(b.id) ? ' <span class="tag new">新着</span>' : "") + (r ? ' <span class="tag">' + (r.state === "完成" ? "長編あり" : "長編を作成待ち") + "</span>" : "")));
      });
      h.push("</ol>");
    });
    $("shelves").innerHTML = h.join("");
    var n = badge();
    $("updated").textContent = (shelf.updated ? "最終更新 " + shelf.updated + "。毎朝6時に新しい3本が届きます。" : "") + (n ? "新着 " + n + "本。" : "");
    if (!$("reader").hidden) return;
    show("list");
  }

  // ── 本を開く ──
  function open(id) {
    stop();
    state.id = id;
    note("note", "");
    gh("books/" + id + ".json").then(function (b) {
      state.book = b;
      saved.seen = saved.seen || {}; saved.seen[id] = 1; save(); if (shelf) badge();
      $("article").innerHTML = '<h1 class="st">' + esc(b.heading || b.title) + "</h1>" + b.html + drawFigs(b);
      loadFigs(id);
      figsGo.y = null; figsGoState();
      $("figs-go").hidden = !(b.figs || []).length;
      $("terms-btn").hidden = !(b.terms || []).length;
      drawStars();
      $("vv").textContent = b.audio ? "VOICEVOX:" + (b.voice || "") : "朗読なし";
      ["play", "prev", "next", "rate"].forEach(function (k) { $(k).disabled = !b.audio; });
      state.n = Math.min(saved.pos[id] || 0, b.yomi.length - 1);
      show("reader");
      mark(false);
      if (state.n > 0) mark(true);
      longBox();
      if (snd.dataset.id !== id) { snd.removeAttribute("src"); snd.dataset.id = ""; }
    }).catch(function (e) {
      note("list-note", "本を開けませんでした（" + e.message + "）。電波のある所で、もう一度押してください。");
    });
  }

  function close() { stop(); hideFig(); hideSheet(); show("list"); drawShelf(); }

  // ── 用語（2026-11-04 依頼者「文中の専門用語やガジェットの語句をタップすると解説が表示されるようにしてくれ」）──
  // 本文の語の最初の1か所に印（.term）が付いている。押すと下から板が出る。上の帯の「用語」で一覧を開ける
  var sheetFrom = null;
  function terms() { return (state.book && state.book.terms) || []; }
  function openSheet(title, html) {
    sheetFrom = document.activeElement;
    $("sheet-t").textContent = title;
    $("sheet-body").innerHTML = html;
    $("sheet").hidden = false;
    $("sheet-body").scrollTop = 0;
    $("sheet").querySelector(".sheet-top [data-sheet-close]").focus({ preventScroll: true });
  }
  function hideSheet() {
    if ($("sheet").hidden) return;
    $("sheet").hidden = true;
    if (sheetFrom && sheetFrom.focus) sheetFrom.focus({ preventScroll: true });
  }
  function showTerm(i) {
    var t = terms()[i];
    if (!t) return;
    openSheet(t.name, '<p class="term-text">' + esc(t.text) + "</p>" +
      '<button type="button" class="sheet-link" data-terms-list>用語の一覧（' + terms().length + "語）</button>");
  }
  function showTerms() {
    // 題の上に「用語」の札が出るので、題は「一覧　12語」（札と合わせて「用語の一覧」と読む）
    openSheet("一覧　" + terms().length + "語", '<ol class="term-list">' + terms().map(function (t, i) {
      return '<li><button type="button" class="term-row" data-term-go="' + i + '"><b>' + esc(t.name) + "</b><span>" + esc(t.text) + "</span></button></li>";
    }).join("") + "</ol>");
  }
  // 一覧から選んだ語を、本文の中で光らせる
  function goTerm(i) {
    hideSheet();
    var el = document.querySelector('#article .term[data-term="' + i + '"]');
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
    el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit");
  }
  function calm() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  // ── 評価（星1〜5）──
  // この iPhone に覚え、本棚の ratings/<id>.json にも書く（ほかの端末と、毎朝の Mac が読める）。送れなかった分は次に本棚を読んだときに送り直す
  var words = ["", "いまひとつ", "もう少し", "ふつう", "良かった", "とても良かった"];
  function stars(id) { return (saved.ratings && saved.ratings[id]) || (shelf && shelf.ratings && shelf.ratings[id]) || 0; }
  function drawStars() {
    var n = stars(state.id), h = [];
    for (var i = 1; i <= 5; i++) {
      h.push('<button type="button" class="star-btn" role="radio" aria-checked="' + (i === n) + '" aria-label="星' + i + "つ・" + words[i] + '" data-star="' + i + '"' + (i === (n || 1) ? "" : ' tabindex="-1"') + ">" +
        '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 2.8l2.75 5.6 6.17.9-4.46 4.35 1.05 6.14L12 16.9l-5.51 2.9 1.05-6.14L3.08 9.3l6.17-.9z"/></svg></button>');
    }
    $("stars").innerHTML = h.join("");
    [].forEach.call($("stars").children, function (b, i) { b.classList.toggle("on", i < n); });
    $("rate-note").textContent = n ? words[n] + "（あとから変えられます）" : "星を押して、この話を評価してください。";
  }
  function rateBook(n) {
    var b = state.book;
    saved.ratings = saved.ratings || {}; saved.ratings[b.id] = n;
    saved.rpend = saved.rpend || {}; saved.rpend[b.id] = { title: b.title, stars: n };
    save(); drawStars();
    $("stars").querySelector('[data-star="' + n + '"]').focus({ preventScroll: true });
    sendRatings();
  }
  // 同じ本を送っている間は次を待たせる（続けて押すと、同じファイルへの書き込みがぶつかるため）
  var sending = {};
  function sendRatings() {
    var p = saved.rpend || {};
    Object.keys(p).forEach(function (id) {
      if (sending[id]) return;
      var r = p[id];
      sending[id] = true;
      var body = JSON.stringify({ id: id, title: r.title, stars: r.stars, at: new Date().toISOString(), from: "iPhone" }, null, 2) + "\n";
      putFile("ratings/" + id + ".json", body, "評価：" + r.title + " 星" + r.stars).then(function () {
        sending[id] = false;
        if (saved.rpend[id] && saved.rpend[id].stars === r.stars) { delete saved.rpend[id]; save(); }
        else return sendRatings();
        if (state.id === id) $("rate-note").textContent = words[r.stars] + "（本棚に送りました。あとから変えられます）";
      }).catch(function () {
        sending[id] = false;
        if (state.id === id) $("rate-note").textContent = words[r.stars] + "（この iPhone に覚えました。電波のある所で本棚へ送ります）";
      });
    });
  }

  // ── 画面下の「図解」：図解へ跳び、図解を見ているあいだは「本文へ」に変わって、読んでいた所へ戻る ──
  var figsGo = { y: null };
  // 図解の節が画面の真ん中あたりにあるあいだだけ「本文へ」。通り過ぎたら（評価や長編の所）「図解」に戻す
  function inFigs() { var f = $("figs"); if (!f) return false; var r = f.getBoundingClientRect(); return r.top < window.innerHeight * 0.6 && r.bottom > window.innerHeight * 0.4; }
  function figsGoState() {
    var on = inFigs();
    $("figs-go-t").textContent = on ? "本文へ" : "図解";
    $("figs-go").setAttribute("aria-label", on ? "読んでいた所へ戻る" : "科学の図解へ跳ぶ");
    $("figs-go").classList.toggle("back", on);
  }
  function figsJump() {
    var behavior = calm() ? "auto" : "smooth";
    if (inFigs()) {
      if (figsGo.y != null) window.scrollTo({ top: figsGo.y, behavior: behavior });
      else { var cur = document.querySelector("#article .s.now"); if (cur) cur.scrollIntoView({ block: "center", behavior: behavior }); }
      return;
    }
    figsGo.y = window.scrollY;
    $("figs").scrollIntoView({ behavior: behavior });
  }
  var figsTick = false;
  window.addEventListener("scroll", function () {
    if (figsTick || $("reader").hidden) return;
    figsTick = true;
    requestAnimationFrame(function () { figsTick = false; if (state.book) figsGoState(); });
  }, { passive: true });

  // ── 長編にする ──
  function longBox() {
    var b = state.book;
    var isLong = /^L/.test(b.id);
    $("long-box").hidden = isLong;
    if (isLong) return;
    var r = (shelf && shelf.requests && shelf.requests[b.id]) || null;
    var btn = $("long-btn");
    if (r && r.state === "完成") {
      $("long-q").textContent = "この作品の長編ができています。";
      btn.textContent = "長編を開く"; btn.disabled = false; btn.dataset.go = r.long; return;
    }
    btn.dataset.go = "";
    if (r || saved.asked && saved.asked[b.id]) {
      $("long-q").textContent = "長編の依頼を受け付けました。次の朝6時の更新で届きます。";
      btn.textContent = "依頼済み"; btn.disabled = true; return;
    }
    $("long-q").textContent = "気に入ったら、長編にできます。次の朝6時の更新で、章立ての長編（朗読つき）になって届きます。";
    btn.textContent = "長編にする"; btn.disabled = false;
    // ほかの端末から依頼してあれば、本棚に requests/<id>.json がある
    var id = b.id;
    gh("requests/" + id + ".json").then(function () {
      saved.asked = saved.asked || {}; saved.asked[id] = true; save();
      if (state.book && state.book.id === id) longBox();
    }).catch(function () {});
  }

  function askLong() {
    var b = state.book, btn = $("long-btn");
    if (btn.dataset.go) return open(btn.dataset.go);
    btn.disabled = true; btn.textContent = "送っています…";
    var body = JSON.stringify({ id: b.id, title: b.title, at: new Date().toISOString(), from: "iPhone" }, null, 2) + "\n";
    fetch(url("requests/" + b.id + ".json"), {
      method: "PUT", headers: head(false),
      body: JSON.stringify({ message: "長編の依頼：" + b.title, content: b64(body) })
    }).then(function (r) {
      // 422 はもう依頼が置いてある（二度押し）。どちらも受け付け済みとして扱う
      if (!r.ok && r.status !== 422) throw new Error("GitHub " + r.status);
      saved.asked = saved.asked || {}; saved.asked[b.id] = true; save();
      longBox();
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = "長編にする";
      $("long-q").textContent = "送れませんでした（" + e.message + "）。電波のある所で、もう一度押してください。";
    });
  }

  // ── 朗読 ──
  function total() { return state.book ? state.book.yomi.length : 1; }
  function at(n) { return (state.book.t && state.book.t[n]) || 0; }
  function indexAt(sec) {
    var t = state.book.t, i = 0;
    while (i + 1 < t.length && t[i + 1] <= sec + 0.05) i++;
    return i;
  }
  function spans() { return document.querySelectorAll("#article .s"); }

  function mark(scroll) {
    document.querySelectorAll(".s.now").forEach(function (el) { el.classList.remove("now"); });
    var cur = document.querySelector("#article .s[data-n='" + state.n + "']");
    if (cur) cur.classList.add("now");
    if (scroll && cur && saved.follow !== false) {
      var r = cur.getBoundingClientRect(), limit = window.innerHeight - 110;
      if (r.top < 70 || r.bottom > limit) {
        var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollBy({ top: r.top - window.innerHeight * 0.3, behavior: calm ? "auto" : "smooth" });
      }
    }
    $("count").textContent = (state.n + 1) + " / " + total() + "文";
    $("meter").style.width = ((state.n + 1) / total() * 100) + "%";
    saved.pos[state.id] = state.n; save();
  }

  function setPlaying(on) {
    state.playing = on;
    $("i-play").toggleAttribute("hidden", on);
    $("i-stop").toggleAttribute("hidden", !on);
    $("play").setAttribute("aria-label", on ? "朗読を止める" : "朗読を始める");
    if (on && navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { lock = l; }).catch(function () {});
    if (!on && lock) { lock.release().catch(function () {}); lock = null; }
  }

  // 取ってきた物を Cache Storage に覚えておく（2回目からは電波なしで使える）。keep 件を超えたら古いものから消す
  function cachedUrl(path, KEY, keep, type) {
    var req = "https://daily-sf.local/" + path;
    if (!window.caches) return gh(path, "blob").then(URL.createObjectURL);
    return caches.open(KEY).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit.blob();
        return gh(path, "blob").then(function (blob) {
          return c.put(req, new Response(blob, { headers: { "Content-Type": type } })).then(function () {
            return c.keys().then(function (ks) { return Promise.all(ks.slice(0, Math.max(0, ks.length - keep)).map(function (k) { return c.delete(k); })); });
          }).then(function () { return blob; }, function () { return blob; });
        });
      });
    }).then(function (blob) { return URL.createObjectURL(blob); });
  }
  // 朗読は1本10MB前後なので直近の6本だけ。図解は1枚200KBほどなので40枚（10本ぶん）
  function audioUrl(path) { return cachedUrl(path, "dsf-audio", 6, "audio/mpeg"); }
  function figUrl(path) { return cachedUrl(path, "dsf-figs", 40, "image/png"); }

  // ── 科学の図解 ──
  // 本文の後ろに並べる。押すと全画面で開き、指で広げて読める。題の下の「科学の図解へ」で跳べる
  var figs = { urls: [], n: 0 };
  function drawFigs(b) {
    figs.urls.forEach(function (u) { if (u) URL.revokeObjectURL(u); });
    figs.urls = [];
    var list = b.figs || [];
    if (!list.length) return "";
    return '<section class="figs" id="figs"><h2 class="ch">科学の図解</h2>' +
      '<p class="figs-n">押すと大きく開き、指で広げられます。</p>' +
      list.map(function (f, i) {
        return '<figure class="fig"><button type="button" class="fig-btn" data-fig="' + i + '" aria-label="' + esc(f.title) + 'を大きく開く">' +
          '<img alt="' + esc(f.title) + '" data-src="' + esc(f.src) + '"></button>' +
          "<figcaption>" + (i + 1) + "／" + list.length + "　" + esc(f.title) + "</figcaption></figure>";
      }).join("") + "</section>";
  }
  function loadFigs(id) {
    document.querySelectorAll("#article img[data-src]").forEach(function (img, i) {
      figUrl(img.dataset.src).then(function (u) {
        if (state.id !== id) return URL.revokeObjectURL(u);
        figs.urls[i] = u; img.src = u;
        if (!$("figview").hidden && figs.n === i) $("figview-img").src = u;
      }).catch(function () { img.alt = "図を読めませんでした（電波のある所で開き直してください）"; });
    });
  }
  function showFig(i) {
    var list = (state.book && state.book.figs) || [];
    if (!list.length) return;
    figs.n = (i + list.length) % list.length;
    $("figview-t").textContent = (figs.n + 1) + "／" + list.length + "　" + list[figs.n].title;
    $("figview-img").src = figs.urls[figs.n] || "";
    $("figview-img").alt = list[figs.n].title;
    $("figview").hidden = false;
    $("figview").scrollTop = 0;
  }
  function hideFig() { $("figview").hidden = true; }
  $("figview-close").addEventListener("click", hideFig);
  $("figview-prev").addEventListener("click", function () { showFig(figs.n - 1); });
  $("figview-next").addEventListener("click", function () { showFig(figs.n + 1); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (!$("figview").hidden) hideFig(); else hideSheet(); return; }
    var t = e.target.closest && e.target.closest("#article .term");
    if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showTerm(+t.dataset.term); return; }
    // 星は左右の矢印で1つずつ動かせる（ラジオボタンの決まり）
    var s = e.target.closest && e.target.closest(".star-btn");
    if (s && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); rateBook(Math.max(1, Math.min(5, +s.dataset.star + (e.key === "ArrowRight" ? 1 : -1)))); }
  });

  function play() {
    var b = state.book;
    if (!b || !b.audio) return;
    if (state.n + 1 >= total()) state.n = 0;
    setPlaying(true);
    note("note", "");
    var go = function () {
      snd.playbackRate = state.rate;
      var p = snd.play();
      var seek = function () { snd.currentTime = at(state.n); };
      if (snd.readyState >= 1) seek(); else snd.addEventListener("loadedmetadata", seek, { once: true });
      if (p && p.catch) p.catch(function () { setPlaying(false); note("note", "再生できませんでした。もう一度 ▶ を押してください。"); });
      mark(true);
    };
    if (snd.dataset.id === b.id && snd.src) return go();
    note("note", "朗読を取ってきています…（初回は10MBほど）");
    // iPhone は「押した直後」でないと鳴らさない。取ってくるあいだに許可が切れないよう、押した瞬間に無音を一度鳴らしておく
    snd.src = silence(); snd.dataset.id = "";
    snd.play().catch(function () {});
    audioUrl(b.audio).then(function (u) {
      if (state.id !== b.id || !state.playing) return;
      snd.src = u; snd.dataset.id = b.id;
      note("note", "");
      go();
    }).catch(function (e) {
      setPlaying(false);
      note("note", "朗読を取ってこられませんでした（" + e.message + "）。");
    });
  }

  // 0.2秒の無音の WAV（8kHz・8bit）
  function silence() {
    var n = 1600, buf = new ArrayBuffer(44 + n), v = new DataView(buf), w = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
    for (var i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }

  function stop() { setPlaying(false); snd.pause(); }

  function jump(n) {
    state.n = Math.max(0, Math.min(total() - 1, n));
    if (state.playing && snd.src) snd.currentTime = at(state.n);
    mark(true);
  }

  snd.addEventListener("timeupdate", function () {
    if (!state.playing || !state.book || !state.book.t || snd.dataset.id !== state.id || snd.seeking) return;
    var i = indexAt(snd.currentTime);
    if (i !== state.n) { state.n = i; mark(true); }
  });
  snd.addEventListener("ended", function () { setPlaying(false); note("note", "最後まで読みました。"); });

  // ── 通知（新しい短編が届いたら知らせる）──
  function b64uBytes(s) {
    var b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function pushState() {
    var el = $("push-state"), btn = $("push");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      el.textContent = "この画面では通知を受け取れません。iPhone ではホーム画面に追加した DAILY-SF から開いてください。"; btn.hidden = true; return;
    }
    btn.hidden = false;
    if (Notification.permission === "granted" && saved.push) { el.textContent = "新しい短編が届くと、この iPhone に通知とバッジが出ます。"; btn.textContent = "通知をつなぎ直す"; }
    else if (Notification.permission === "denied") { el.textContent = "通知が許可されていません。設定アプリ › 通知 › DAILY-SF で許可してください。"; btn.textContent = "新しい短編を知らせる"; }
    else { el.textContent = "毎朝の新しい短編が届いたら、通知とアイコンのバッジで知らせます。"; btn.textContent = "新しい短編を知らせる"; }
  }
  function putFile(p, text, msg) {
    // 置いてあれば sha を付けて上書きする
    return fetch(url(p) + "?t=" + Date.now(), { headers: head(false), cache: "no-store" }).then(function (r) {
      return r.ok ? r.json().then(function (j) { return j.sha; }) : null;
    }).then(function (sha) {
      var body = { message: msg, content: b64(text) };
      if (sha) body.sha = sha;
      return fetch(url(p), { method: "PUT", headers: head(false), body: JSON.stringify(body) });
    }).then(function (r) { if (!r.ok) throw new Error("GitHub " + r.status); });
  }
  function subscribe() {
    var el = $("push-state");
    el.textContent = "つないでいます…";
    Notification.requestPermission().then(function (ok) {
      if (ok !== "granted") throw new Error("通知が許可されませんでした。設定アプリ › 通知 › DAILY-SF で許可してください");
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(VAPID) }); });
    }).then(function (sub) {
      if (!saved.device) { saved.device = "iphone-" + Math.random().toString(36).slice(2, 10); save(); }
      var j = sub.toJSON(); j.at = new Date().toISOString();
      return putFile("subs/" + saved.device + ".json", JSON.stringify(j, null, 2) + "\n", "iPhone：新しい短編の通知を受け取る");
    }).then(function () {
      saved.push = 1; save(); pushState(); if (shelf) badge();
    }).catch(function (e) { el.textContent = "つなげませんでした：" + e.message; });
  }
  $("push").addEventListener("click", subscribe);

  // ── つなぎ方 ──
  $("save-token").addEventListener("click", function () {
    var t = $("token").value.trim();
    if (!/^(github_pat_|ghp_)/.test(t)) { note("setup-note", "github_pat_ で始まる鍵を貼ってください。"); return; }
    saved.token = t; save(); $("token").value = "";
    note("setup-note", "読んでいます…");
    show("list"); readShelf();
  });
  $("gear").addEventListener("click", function () { pushState(); $("gear-panel").hidden = false; });
  $("gear-close").addEventListener("click", function () { $("gear-panel").hidden = true; });
  $("reload").addEventListener("click", function () { $("gear-panel").hidden = true; readShelf(); });
  $("forget").addEventListener("click", function () {
    if (!confirm("この iPhone の鍵を消します。GitHub の鍵のページでも消してください。")) return;
    delete saved.token; delete saved.shelf; save();
    $("gear-panel").hidden = true; show("setup"); note("setup-note", "");
  });

  // ── 操作 ──
  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) return open(o.getAttribute("data-open"));
    if (e.target.closest("[data-back]")) return close();
    var f = e.target.closest("[data-fig]");
    if (f) return showFig(+f.dataset.fig);
    if (e.target.closest("[data-sheet-close]")) return hideSheet();
    if (e.target.closest("[data-terms-list]")) return showTerms();
    var g = e.target.closest("[data-term-go]");
    if (g) return goTerm(+g.dataset.termGo);
    var t = e.target.closest("#article .term");
    if (t) return showTerm(+t.dataset.term);
    var st = e.target.closest("[data-star]");
    if (st) return rateBook(+st.dataset.star);
    var s = e.target.closest("#article .s");
    if (s) jump(+s.dataset.n);
  });
  $("play").addEventListener("click", function () { if (state.playing) stop(); else play(); });
  $("prev").addEventListener("click", function () { jump(state.n - 1); });
  $("next").addEventListener("click", function () { jump(state.n + 1); });
  $("rate").addEventListener("click", function () {
    state.rate = rates[(rates.indexOf(state.rate) + 1) % rates.length];
    saved.rate = state.rate; save(); showRate();
    snd.playbackRate = state.rate;
  });
  function showRate() { $("rate").textContent = state.rate.toFixed(1) + "倍"; }
  showRate();
  $("long-btn").addEventListener("click", askLong);
  $("figs-go").addEventListener("click", figsJump);
  $("terms-btn").addEventListener("click", showTerms);

  // 表示の明るさ（⚙ で選ぶ。既定は明るい。iPhone 本体の暗い表示には合わせない）
  function showTheme() {
    var dark = saved.theme === "dark";
    if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]').content = dark ? "#191a1c" : "#f3efe6";
    [].forEach.call(document.querySelectorAll("[data-theme-set]"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.themeSet === (dark ? "dark" : "light")));
    });
  }
  [].forEach.call(document.querySelectorAll("[data-theme-set]"), function (b) {
    b.addEventListener("click", function () { saved.theme = b.dataset.themeSet; save(); showTheme(); });
  });
  showTheme();

  // 読んでいる文を画面で追うか（切ると、光るだけで画面は動かない。朗読を聞きながら資料を読める）
  function showFollow() {
    var on = saved.follow !== false, b = $("follow");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = on ? "追う" : "追わない";
  }
  $("follow").addEventListener("click", function () {
    saved.follow = saved.follow === false; save(); showFollow();
    if (saved.follow) mark(true);
  });
  showFollow();


  function setSize(px) {
    px = Math.min(26, Math.max(15, px));
    saved.size = px; save();
    document.documentElement.style.setProperty("--size", px + "px");
  }
  if (saved.size) setSize(saved.size);
  $("smaller").addEventListener("click", function () { setSize((saved.size || 18) - 1); });
  $("larger").addEventListener("click", function () { setSize((saved.size || 18) + 1); });

  // 画面に戻ってきたら、新しい朝の3本が来ていないか読み直す
  document.addEventListener("visibilitychange", function () { if (!document.hidden && token() && !$("list").hidden) readShelf(); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  if (!token()) show("setup"); else { if (saved.shelf) { shelf = saved.shelf; drawShelf(); } readShelf(); }
})();
