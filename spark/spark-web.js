/* PRISM - SPARK web edition: the browser app (start, quick screen, stages, results, report, email form).
 *
 * Everything runs in the visitor's browser. Answers are kept in this browser's storage and never leave it,
 * except when the visitor asks for the report by email: then their name, email, consent and their CHOICE
 * answers (no free-text notes) go to the Google Apps Script set in spark-config.js, which rebuilds the
 * report itself and sends it.
 * Needs (loaded first): bank.js (SPARK_BANK, SPARK_APP, SPARK_REPORT_CSS), spark-config.js, spark-core.js.
 */
(function () {
  "use strict";
  var C = window.SparkCore, bank = C.makeBank(window.SPARK_BANK), APP = window.SPARK_APP || { name: "PRISM - SPARK", version: "" };
  var CFG = window.SPARK_CONFIG || {};
  var e = C.escapeHtml, root = document.getElementById("app"), ICONS = C.STATUS_ICONS;
  var ZONE_ICON = { red: "✕", yellow: "◐", green: "✓" };
  var BUTTON_MAX = bank.thresholds.buttonMaxOptions;
  var KEY = "prism-spark:v1";

  // ------------------------------------------------------------ storage (this browser only)
  var memory = { assessments: {}, next: 1 };
  function loadStore() {
    try { var raw = window.localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (err) { /* private mode */ }
    return memory;
  }
  function saveStore(s) {
    memory = s;
    try { window.localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (err) { return false; }
  }
  var store = loadStore();
  function now() { return new Date().toISOString(); }
  function getA(id) {
    var a = store.assessments[id];
    if (!a) return null;
    if (a.bank_version !== bank.version) {  // the question bank changed: drop retired answers and flag them
      var rc = C.reconcile(bank, a.answers);
      a.answers = rc.answers; a.review = (a.review || []).concat(rc.flagged); a.bank_version = bank.version;
      saveStore(store);
    }
    return a;
  }
  function persist(a) {
    a.updated_at = now(); store.assessments[a.id] = a;
    var ok = saveStore(store);
    flash(ok ? "Saved on this device ✓" : "Not saved: this browser blocks storage", !ok);
  }
  function result(a) { return C.score(bank, a.answers, a.idea_name); }

  var flashTimer, pendingFlash = null;
  function flash(text, bad) {
    pendingFlash = { text: text, bad: bad };  // re-shown after the next redraw (see page())
    var el = document.getElementById("saved");
    if (!el) return;
    el.textContent = text; el.classList.toggle("is-bad", !!bad); el.classList.add("is-on");
    clearTimeout(flashTimer);
    if (!bad) flashTimer = setTimeout(function () { el.classList.remove("is-on"); }, 2200);
  }

  // ------------------------------------------------------------ routing
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function parse() {
    var h = location.hash.replace(/^#\/?/, ""), anchor = "";
    var cut = h.indexOf("#");
    if (cut >= 0) { anchor = h.slice(cut + 1); h = h.slice(0, cut); }
    var parts = h.split("?"), path = parts[0].split("/"), q = { _anchor: anchor };
    (parts[1] || "").split("&").forEach(function (kv) { var p = kv.split("="); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ""); });
    return { path: path, query: q };
  }
  window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); });

  function render() {
    var r = parse(), p = r.path;
    if (p[0] === "r") return renderShared(r.query);
    if (p[0] === "a" && p[1]) {
      var a = getA(p[1]);
      if (!a) return renderNotFound();
      if (p[2] === "quick") return renderQuick(a, parseInt(r.query.q, 10));
      if (p[2] === "stage") return renderStage(a, parseInt(p[3], 10), r.query);
      if (p[2] === "report") return renderReport(a);
      if (p[2] === "results") {
        renderResults(a);
        if (r.query._anchor) { var t = document.getElementById(r.query._anchor); if (t) setTimeout(function () { t.scrollIntoView({ block: "start" }); }, 0); }
        return;
      }
      return go(C.quickRemaining(bank, a.answers).length ? "#/a/" + a.id + "/quick" : "#/a/" + a.id + "/results");
    }
    renderHome();
  }

  // ------------------------------------------------------------ shared pieces
  function tracker(a, res) {
    var p = res.progress, s2 = p.quick_done ? "done" : "current", s3 = p.quick_done ? "done" : "todo";
    var s4 = p.full ? "done" : (p.quick_done ? "current" : "todo"), s5 = p.full ? "done" : "todo";
    function step(n, state, name, sub, href) {
      var inner = '<span class="step-name">' + name + '</span><span class="step-sub">' + sub + "</span>";
      return '<li class="step is-' + state + '"><span class="step-dot" aria-hidden="true">' + (state === "done" ? "✓" : n) + "</span>" +
        (href ? '<a class="step-text" href="' + href + '">' + inner + "</a>" : '<span class="step-text">' + inner + "</span>") + "</li>";
    }
    var base = "#/a/" + a.id;
    return '<nav class="tracker no-print" aria-label="Your progress"><ol class="steps">' +
      step(1, "done", "Name your idea", "Done") +
      step(2, s2, "Quick screen", p.quick_answered + " of " + p.quick_total + " answered", base + "/quick") +
      step(3, s3, "First verdict", p.quick_done ? "Ready" : "After the quick screen", base + "/results") +
      step(4, s4, "Go deeper", p.stages_done + " of " + p.stages_total + " stages complete", base + "/results#deeper") +
      step(5, s5, "Full report", p.full ? "Complete" : "Available any time", base + "/report") + "</ol>" +
      '<div class="tracker-bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p.pct + '">' +
      '<div class="tracker-fill" style="width:' + p.pct + '%"></div></div><p class="tracker-text" aria-live="polite"><strong>' + p.pct +
      "% complete</strong> · " + p.answered + " of " + p.total + " questions answered · " +
      (p.left ? p.left + " left, about " + p.minutes_left + " min" : "nothing left to answer") + "</p></nav>";
  }

  function questionForm(q, answers, mode) {
    var entry = answers[q.id], chosen = entry ? entry.o : null, h = [];
    h.push('<div class="q-form" data-qid="' + q.id + '"><fieldset class="q-fieldset"><legend class="q-short" id="q' + q.id + '-label">' +
           '<span class="q-num">Q' + q.id + "</span> " + e(q.short) + "</legend>");
    h.push('<details class="more-detail"><summary>More detail</summary><p>' + e(q.text) + "</p>" + (q.why ? '<p class="muted">' + e(q.why) + "</p>" : "") +
           (q.basis ? '<p class="muted small basis">Answer scale based on: ' + e(q.basis) + "</p>" : "") + "</details>");
    if (q.options.length <= BUTTON_MAX) {
      h.push('<div class="opts" role="group" aria-labelledby="q' + q.id + '-label">');
      q.options.forEach(function (o, i) {
        var on = chosen === o.id;
        h.push('<button type="button" class="opt' + (o.tag === "U" ? " opt-untested" : "") + (on ? " is-selected" : "") + '" aria-pressed="' + on +
               '" data-qid="' + q.id + '" data-value="' + o.id + '" data-key="' + (i + 1) + '"><span class="opt-key" aria-hidden="true">' + (i + 1) + "</span>" +
               (o.tag === "U" ? '<span class="opt-icon" aria-hidden="true">?</span>' : "") + '<span class="opt-text">' + e(o.text) + "</span></button>");
      });
      h.push("</div>");
    } else {
      h.push('<div class="select-wrap"><label class="sr-only" for="sel' + q.id + '">' + e(q.short) + '</label><select id="sel' + q.id +
             '" class="opt-select" data-qid="' + q.id + '"><option value=""' + (chosen ? "" : " selected") + " disabled>Choose an answer…</option>");
      q.options.forEach(function (o) {
        h.push('<option value="' + o.id + '"' + (chosen === o.id ? " selected" : "") + ">" + (o.tag === "U" ? "? " : "") + e(o.text) + "</option>");
      });
      h.push("</select></div>");
    }
    if (mode === "stage") h.push('<button type="button" class="clear-btn no-print" data-clear="' + q.id + '">Clear answer</button>');
    h.push("</fieldset></div>");
    return h.join("");
  }

  function header() {
    return '<header class="topbar no-print"><a class="brand" href="#/" aria-label="PRISM - SPARK home"><span class="brand-mark" aria-hidden="true">✦</span>' +
      '<span class="brand-name">PRISM <span class="brand-sep">-</span> SPARK</span></a><span class="version-badge">v' + e(APP.version) + "</span>" +
      (CFG.siteUrl ? '<a class="site-link" href="' + e(CFG.siteUrl) + '">← ' + e(CFG.siteName || "Back to site") + "</a>" : "") +
      '<span class="saved" id="saved" role="status" aria-live="polite"></span></header>';
  }
  function footer() {
    return '<footer class="footer no-print">' + e(APP.name) + " v" + e(APP.version) + " · Startup Potential Assessment &amp; Rating Kit · " +
      "your answers stay in this browser · no AI</footer>";
  }
  function page(inner, cls) {
    document.body.className = cls || "";
    root.innerHTML = header() + '<main id="main" class="page">' + inner + "</main>" + footer();
    if (pendingFlash) { var f = pendingFlash; pendingFlash = null; flash(f.text, f.bad); pendingFlash = null; }
  }

  // ------------------------------------------------------------ home
  function renderHome(error) {
    var list = Object.keys(store.assessments).map(function (k) { return store.assessments[k]; })
      .sort(function (x, y) { return x.updated_at < y.updated_at ? 1 : -1; });
    var h = ['<section class="hero"><h1>Is this idea worth pursuing?</h1><p class="lede">Answer 23 quick questions, mostly by tapping, and get a ' +
      "first verdict with the reasons behind it. Go deeper one stage at a time whenever you like.</p>" +
      '<form class="start-form" id="start-form"><label for="idea_name" class="field-label">Name your idea</label><div class="start-row">' +
      '<input id="idea_name" type="text" maxlength="200" required autocomplete="off" placeholder="e.g. Last-minute booking for dog groomers">' +
      '<button class="btn btn-primary" type="submit">Start</button></div>' + (error ? '<p class="error">' + e(error) + "</p>" : "") + "</form>" +
      '<p class="small muted local-note">Your answers are saved in this browser only. Nothing is sent anywhere unless you ask for your report by email.</p></section>'];
    if (list.length) {
      h.push('<section class="card"><h2>Your assessments</h2><ul class="assess-list">');
      list.forEach(function (a) {
        var res = result(a), quickDone = res.depth.quick_done;
        h.push('<li class="assess-item"><div class="assess-main"><a class="assess-name" href="#/a/' + a.id + '">' + e(a.idea_name) + "</a>" +
               '<span class="pill zone-' + res.zone + '"><span aria-hidden="true">' + ZONE_ICON[res.zone] + "</span> " + e(res.verdict.label) + " · " + res.rating + "</span>" +
               '<span class="muted small">' + e(res.depth.label) + "</span>" + ((a.review || []).length ? '<span class="pill pill-warn">! Needs review (' + a.review.length + ")</span>" : "") +
               '<a class="btn btn-small assess-go" href="#/a/' + a.id + (quickDone ? "/results" : "/quick") + '">' + (quickDone ? "Open results" : "Continue quick screen") + " →</a></div>" +
               '<details class="assess-actions"><summary>Manage</summary><span class="inline-form"><label class="sr-only" for="rn' + a.id + '">New name</label>' +
               '<input id="rn' + a.id + '" value="' + e(a.idea_name) + '" maxlength="200"><button class="btn btn-small" type="button" data-rename="' + a.id + '">Rename</button></span>' +
               '<button class="btn btn-small" type="button" data-duplicate="' + a.id + '">Duplicate</button>' +
               '<button class="btn btn-small" type="button" data-export="' + a.id + '">Export answers</button>' +
               '<button class="btn btn-small btn-danger" type="button" data-delete="' + a.id + '">Delete</button></details></li>');
      });
      h.push("</ul></section>");
    }
    page(h.join(""));
    var input = document.getElementById("idea_name");
    if (input && !list.length) input.focus();
  }

  // ------------------------------------------------------------ quick screen
  function renderQuick(a, startQ) {
    var res = result(a), hidden = C.hiddenIds(a.answers), remaining = C.quickRemaining(bank, a.answers);
    var order = bank.quickIds.filter(function (q) { return hidden.indexOf(q) < 0; });
    if (order.indexOf(startQ) < 0) startQ = order.filter(function (q) { return remaining.indexOf(q) >= 0; })[0] || order[0];
    var done = bank.quickIds.length - remaining.length;
    var h = [tracker(a, res), '<div class="quick-head"><p class="eyebrow">Quick screen · ' + e(a.idea_name) + "</p>" +
      '<div class="progress" aria-hidden="true"><div class="progress-bar" style="width:' + Math.round(done / bank.quickIds.length * 100) + '%"></div></div>' +
      '<p class="small muted" aria-live="polite">' + remaining.length + " question" + (remaining.length === 1 ? "" : "s") + " left</p></div>"];
    var q = bank.qById[startQ], st = bank.stageById[q.stage];
    h.push('<section class="qcard" id="q' + q.id + '" data-qid="' + q.id + '"><p class="stage-tag">Stage ' + st.id + " · " + e(st.short) + "</p>" +
           questionForm(q, a.answers, "quick") + "</section>");
    var i = order.indexOf(startQ);
    h.push('<nav class="quick-nav" aria-label="Quick screen navigation"><button type="button" class="btn" data-quick-go="' + (order[i - 1] || "") + '"' +
           (i <= 0 ? " disabled" : "") + '>← Back</button><button type="button" class="btn" data-quick-go="' + (order[i + 1] || "") + '"' +
           (i >= order.length - 1 ? " disabled" : "") + '>Next →</button><a class="btn btn-ghost" href="#/a/' + a.id + '/results">See verdict now</a></nav>' +
           '<p class="small muted center hint-keys">Tip: press 1–5 to answer, ← → to move.</p>');
    page(h.join(""), "quick-page");
    root.dataset.view = "quick"; root.dataset.aid = a.id; root.dataset.q = startQ;
    var legend = document.querySelector(".qcard legend");
    if (legend) { legend.setAttribute("tabindex", "-1"); legend.focus({ preventScroll: true }); }
  }

  // ------------------------------------------------------------ stage screen
  function renderStage(a, sid, query, focusAfter) {
    if (!bank.stageById[sid]) return renderNotFound();
    var res = result(a), stage = bank.stageById[sid], st = res.stages[sid - 1], hidden = C.hiddenIds(a.answers);
    var qs = bank.questionsByStage[sid], h = [];
    h.push('<p class="crumbs no-print"><a href="#/a/' + a.id + '/results">← Back to results</a> · ' + e(a.idea_name) + "</p>" + tracker(a, res));
    h.push('<div class="stage-layout">' + progressMap(a, res, sid) + '<div class="stage-main" id="stage">');
    h.push('<header class="stage-head"><p class="eyebrow">Stage ' + sid + " of 16" + (stage.core ? " · core stage" : "") + "</p><h1>" + e(stage.title) + "</h1>" +
           '<p class="muted">' + e(stage.purpose) + "</p>" + (stage.gate ? '<p class="gate-note"><strong>To pass:</strong> ' + e(stage.gate) + "</p>" : "") +
           '<p class="stage-status status-' + st.status + '"><span aria-hidden="true">' + ICONS[st.status] + "</span> " + e(st.status_label) +
           (st.score != null ? " · score " + st.score : "") + " · " + st.remaining + " left</p></header>");
    if (query && query.marked != null) {
      var m = parseInt(query.marked, 10);
      h.push('<p class="notice notice-ok" role="status">' + (m ? m + " question" + (m === 1 ? "" : "s") + " set to untested. Change any of them below as you gather evidence."
             : "Nothing to change: every scored question in this stage already has an answer.") + "</p>");
    }
    var rev = (a.review || []).filter(function (r) { return bank.qById[r] && bank.qById[r].stage === sid; });
    if (rev.length) h.push('<p class="notice">The question bank changed, so please answer again: ' + rev.map(function (r) { return "Q" + r; }).join(", ") + ".</p>");
    if (stage.scored !== false && stage.weight > 0) {
      h.push('<div class="untested-form"><button class="btn btn-untested" type="button" data-untested="' + sid + '"><span aria-hidden="true">?</span> None of this is tested yet</button>' +
             '<span class="small muted">Sets every unanswered scored question in this stage to “untested”.</span></div>');
    }
    h.push('<div class="stage-questions">');
    qs.filter(function (q) { return q.type !== "T"; }).forEach(function (q) {
      var entry = a.answers[q.id], isHidden = hidden.indexOf(q.id) >= 0;
      h.push('<section class="qblock' + (entry ? "" : " is-unanswered") + '" id="q' + q.id + '" data-qid="' + q.id + '"' + (isHidden ? " hidden" : "") + ">" +
             ("gateMin" in q ? '<p class="gate-tag"><span aria-hidden="true">⚑</span> Gate question</p>' : "") + questionForm(q, a.answers, "stage") +
             (entry && entry.auto === "stage" ? '<p class="small muted auto-note">Set to untested by “None of this is tested yet”.</p>' : "") + "</section>");
      q.options.forEach(function (o) {
        if (o.skips && entry && entry.o === o.id) h.push('<p class="skip-line small muted">' + o.skips.length + " follow-up question" +
          (o.skips.length === 1 ? "" : "s") + " skipped because of this answer.</p>");
      });
    });
    h.push("</div>");
    var texts = qs.filter(function (q) { return q.type === "T"; });
    if (texts.length) {
      h.push('<h2 class="sub">Notes <span class="muted small">(optional, kept in this browser)</span></h2><div class="text-questions">');
      texts.forEach(function (q) {
        var entry = a.answers[q.id];
        h.push('<div class="t-form" id="q' + q.id + '"><label for="t' + q.id + '" class="q-short"><span class="q-num">Q' + q.id + "</span> " + e(q.short) + "</label>" +
               '<details class="more-detail"><summary>More detail</summary><p>' + e(q.text) + "</p></details>" +
               '<textarea id="t' + q.id + '" data-text="' + q.id + '" rows="2" maxlength="2000" placeholder="' + e(q.placeholder || "") + '">' + e(entry ? entry.t : "") + "</textarea></div>");
      });
      h.push("</div>");
    }
    var nxt = nextSuggested(res, sid);
    if (!st.remaining && sid !== 1) {
      h.push('<div class="stage-done" role="status"><p class="stage-done-title"><span aria-hidden="true">✓</span> Stage complete</p>' +
             (nxt ? '<p class="stage-done-next small">Next suggested: <a href="#/a/' + a.id + "/stage/" + nxt.id + '">Stage ' + nxt.id + " · " + e(nxt.short) +
                    " (" + nxt.remaining + " left)</a></p>" : "") +
             '<a class="btn btn-primary btn-small" href="#/a/' + a.id + '/results">See updated results</a></div>');
    }
    h.push('<p class="small muted hint-keys">Tip: 1–5 answers the current question; ↑ ↓ move between questions.</p><nav class="stage-nav no-print">' +
           (sid > 1 ? '<a class="btn" href="#/a/' + a.id + "/stage/" + (sid - 1) + '">← Stage ' + (sid - 1) + "</a>" : "") +
           '<a class="btn btn-primary" href="#/a/' + a.id + '/results">See results</a>' +
           (sid < 16 ? '<a class="btn" href="#/a/' + a.id + "/stage/" + (sid + 1) + '">Stage ' + (sid + 1) + " →</a>" : "") + "</nav></div></div>");
    var scrollY = window.scrollY;
    page(h.join(""));
    root.dataset.view = "stage"; root.dataset.aid = a.id; root.dataset.stage = sid;
    var details = document.querySelector(".map-details");
    if (details && window.matchMedia("(max-width: 760px)").matches) details.open = false;
    if (focusAfter) {
      window.scrollTo(0, scrollY);
      focusNext(focusAfter);
    }
  }
  function progressMap(a, res, current) {
    var done = res.stages.filter(function (s) { return s.complete; }).length;
    return '<nav class="progress-map" aria-label="Stages"><details class="map-details" open><summary class="map-title">Stages <span class="map-count">· ' +
      done + " of 16 complete</span></summary><ol>" + res.stages.map(function (s) {
        return '<li><a href="#/a/' + a.id + "/stage/" + s.id + '" class="map-item status-' + s.status + (current === s.id ? " is-current" : "") + '"' +
          (current === s.id ? ' aria-current="page"' : "") + '><span class="map-icon" aria-hidden="true">' + ICONS[s.status] + '</span><span class="map-name">' +
          s.id + ". " + e(s.short) + '</span><span class="map-meta">' + e(s.status_label) + (s.remaining ? " · " + s.remaining + " left" : "") + "</span></a></li>";
      }).join("") + "</ol></details></nav>";
  }
  function nextSuggested(res, current) {
    var order = (res.report.focus_stage ? [res.report.focus_stage] : []).concat(res.report.go_deeper.map(function (g) { return g.stage; }));
    for (var i = 0; i < order.length; i++) {
      var s = res.stages[order[i] - 1];
      if (order[i] !== current && s.remaining) return { id: s.id, short: s.short, remaining: s.remaining };
    }
    return null;
  }
  function focusNext(qid) {
    var blocks = Array.prototype.slice.call(document.querySelectorAll(".qblock:not([hidden])"));
    var idx = blocks.findIndex(function (b) { return +b.dataset.qid === qid; });
    var next = blocks.slice(idx + 1).concat(blocks.slice(0, idx)).find(function (b) { return b.classList.contains("is-unanswered"); });
    var target = next ? next.querySelector("button.opt, select") : (blocks[idx] && blocks[idx].querySelector("button.opt, select"));
    if (next) next.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (target) target.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ results
  function dialSvg(res) {
    var cx = 160, cy = 160, r = 120, th = bank.thresholds;
    function pt(v) { var ang = Math.PI - (v / 100) * Math.PI; return (cx + r * Math.cos(ang)).toFixed(2) + " " + (cy - r * Math.sin(ang)).toFixed(2); }
    function arc(a1, a2) { return "M " + pt(a1) + " A " + r + " " + r + " 0 0 1 " + pt(a2); }
    var angle = (res.rating * 1.8).toFixed(2);
    return '<svg viewBox="0 0 320 180" class="dial-svg" aria-hidden="true" focusable="false"><path d="' + arc(0, th.ratingRedMax + 0.5) + '" class="arc arc-red"/>' +
      '<path d="' + arc(th.ratingRedMax + 0.5, th.ratingYellowMax + 0.5) + '" class="arc arc-yellow"/><path d="' + arc(th.ratingYellowMax + 0.5, 100) + '" class="arc arc-green"/>' +
      '<text x="22" y="176" class="dial-tick">0</text><text x="298" y="176" class="dial-tick" text-anchor="end">100</text>' +
      '<g class="needle" id="needle" data-angle="' + angle + '" style="transform: rotate(' + angle + "deg); transform-origin: " + cx + "px " + cy + 'px;">' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx - r + 18) + '" y2="' + cy + '" class="needle-line"/></g><circle cx="' + cx + '" cy="' + cy + '" r="9" class="needle-hub"/></svg>';
  }

  function emailCard(a) {
    if (!CFG.leadEndpoint) return "";
    return '<section class="insight-card email-card no-print" id="email-card" aria-labelledby="email-h"><h2 id="email-h">Email me this report</h2>' +
      '<p class="small muted">We\'ll send the full report, with charts and your action plan, to your inbox.</p>' +
      '<form id="email-form" novalidate><div class="ef-row"><label for="ef-name">Your name</label><input id="ef-name" autocomplete="name" maxlength="80" required></div>' +
      '<div class="ef-row"><label for="ef-email">Email</label><input id="ef-email" type="email" autocomplete="email" maxlength="254" required></div>' +
      '<div class="ef-hp" aria-hidden="true"><label for="ef-website">Leave this empty</label><input id="ef-website" tabindex="-1" autocomplete="off"></div>' +
      '<label class="ef-check" for="ef-consent"><input type="checkbox" id="ef-consent" required aria-labelledby="ef-consent-t"> <span id="ef-consent-t">' +
      e(CFG.consentReportText) + "</span></label>" +
      '<label class="ef-check" for="ef-marketing"><input type="checkbox" id="ef-marketing" aria-labelledby="ef-marketing-t"> <span id="ef-marketing-t">' +
      e(CFG.consentMarketingText) + "</span></label>" +
      '<p class="small muted ef-privacy">' + e(CFG.privacyNote || "") + (CFG.privacyUrl ? ' <a href="' + e(CFG.privacyUrl) + '">Privacy policy</a>' : "") + "</p>" +
      '<button class="btn btn-primary" type="submit" data-aid="' + a.id + '">Send my report</button><p class="ef-status" id="ef-status" role="status" aria-live="polite"></p></form></section>';
  }

  function renderResults(a) {
    var res = result(a), rep = res.report, v = res.verdict, th = bank.thresholds, base = "#/a/" + a.id, h = [];
    h.push('<div class="results-head no-print"><p class="crumbs"><a href="#/">← All assessments</a></p><div class="head-actions">' +
      (res.depth.quick_done ? "" : '<a class="btn" href="' + base + '/quick">Continue quick screen</a>') +
      '<a class="btn btn-primary" href="' + base + '/report">Open your full report</a>' +
      (CFG.leadEndpoint ? '<a class="btn" href="#email-card" data-scroll="email-card">Email me the report</a>' : "") +
      '<button class="btn" type="button" data-download="' + a.id + '">Download PDF</button></div></div>');
    h.push('<h1 class="idea-title">' + e(a.idea_name) + "</h1>");
    if ((a.review || []).length) h.push('<p class="notice no-print">The question bank changed, so ' + a.review.length + " answer(s) need answering again: " +
      a.review.map(function (r) { return '<a href="' + base + "/stage/" + bank.qById[r].stage + '">Q' + r + "</a>"; }).join(", ") + ".</p>");
    h.push(tracker(a, res));
    h.push('<section class="dashboard zone-' + res.zone + '" aria-labelledby="verdict-h"><div class="dial-card"><figure class="dial" role="img" aria-label="' +
      e(res.text_equivalent) + '">' + dialSvg(res) + '<figcaption class="zone-key small"><span class="zk zk-red"><span aria-hidden="true">■</span> Not a good idea 0–' +
      th.ratingRedMax + '</span><span class="zk zk-yellow"><span aria-hidden="true">■</span> Maybe ' + (th.ratingRedMax + 1) + "–" + th.ratingYellowMax +
      '</span><span class="zk zk-green"><span aria-hidden="true">■</span> Good idea ' + (th.ratingYellowMax + 1) + "–100</span></figcaption></figure>" +
      '<div class="verdict-block"><p class="rating"><span class="rating-num">' + res.rating + '</span><span class="rating-of">/100</span> <span class="rating-label">SPARK rating</span></p>' +
      '<h2 id="verdict-h" class="verdict-label"><span aria-hidden="true">' + ZONE_ICON[res.zone] + "</span> " + e(v.label) + (v.code === "test" ? ": " + e(C.lowerFirst(v.headline)) : "") +
      '</h2><p class="verdict-action">Action: <strong>' + e(v.action) + '</strong></p><p class="depth-label"><span class="pill pill-depth">' + e(res.depth.label) + "</span></p></div></div>");
    var t = res.tiles;
    h.push('<div class="tiles"><div class="tile"><span class="tile-num">' + t.core_passed + '<span class="tile-of">/' + t.core_total + '</span></span><span class="tile-label">Core stages passed</span></div>' +
      '<div class="tile"><span class="tile-num">' + t.passed + '<span class="tile-of">/' + t.scored_total + '</span></span><span class="tile-label">Stages passed</span></div>' +
      '<div class="tile' + (t.failed ? " tile-bad" : "") + '"><span class="tile-num">' + t.failed + '</span><span class="tile-label">Stages failed</span></div></div>');
    h.push('<div class="strip-wrap"><h3 class="small-h">Stage by stage</h3><ol class="strip">' + res.stages.filter(function (s) { return s.scored; }).map(function (s) {
      return '<li><a class="strip-item status-' + s.status + '" href="' + base + "/stage/" + s.id + '" title="' + s.id + ". " + e(s.short) + ": " + e(s.status_label) +
        '" aria-label="Stage ' + s.id + ", " + e(s.short) + ": " + e(s.status_label) + '"><span class="strip-icon" aria-hidden="true">' + ICONS[s.status] +
        '</span><span class="strip-num">' + s.id + "</span></a></li>";
    }).join("") + '</ol><p class="strip-legend small muted"><span>✓ Passed</span> <span>◐ Not yet proven</span> <span>✕ Failed</span></p></div>');
    var mini = function (title, icon, items, empty) {
      return '<div class="mini"><h3 class="small-h"><span aria-hidden="true">' + icon + "</span> " + title + "</h3>" +
        (items.length ? "<ul>" + items.slice(0, 3).map(function (f) { return "<li>" + e(f.text) + "</li>"; }).join("") + "</ul>" : '<p class="small muted">' + empty + "</p>") + "</div>";
    };
    h.push('<div class="mini-lists">' + mini("Supports the idea", "✓", rep.supports, "Nothing yet.") + mini("Counts against it", "✕", rep.against, "Nothing so far.") +
      mini("Still untested", "?", rep.untested, "Nothing marked untested.") + "</div>");
    h.push('<div class="would-change"><h3 class="small-h">What would change the verdict</h3>' +
      (rep.change.length ? "<ul>" + rep.change.slice(0, 4).map(function (c) { return "<li>" + e(c.text) + "</li>"; }).join("") + "</ul>"
        : v.code === "proceed" ? '<p class="small">Every condition for Good idea is met.</p>' : "") +
      (rep.focus_stage ? '<a class="btn btn-primary no-print" href="' + base + "/stage/" + rep.focus_stage + '">Open stage ' + rep.focus_stage + ": " +
        e(bank.stageById[rep.focus_stage].short) + "</a>" : "") + "</div></section>");
    h.push('<section class="insights"><div class="insight-card plan-card"><h2>Your next steps</h2><ol class="mini-plan">' +
      rep.recommendations.slice(0, 3).map(function (r) {
        return '<li class="mp mp-' + r.kind + '"><span class="mp-num" aria-hidden="true">' + r.priority + '</span><div><p class="mp-title">' + e(r.title) + "</p>" +
          '<p class="mp-how small">' + e(r.how) + '</p><p class="mp-meta small muted">' + (r.success ? "Done when: " + e(r.success) : "") + (r.time ? " · Effort: " + e(r.time) : "") + "</p></div></li>";
      }).join("") + '</ol><a class="btn btn-primary no-print" href="' + base + '/report">See the full action plan and report →</a></div>' +
      '<div class="insight-card"><h2>Where the idea stands</h2><figure class="fig">' + C.stageBars(res) + '</figure><p class="small muted chart-legend"><span class="lg lg-pass">■ Passed</span> ' +
      '<span class="lg lg-unp">■ Not yet proven</span> <span class="lg lg-fail">■ Failed</span> · ● core stage</p></div>' +
      '<div class="insight-card"><h2>How strong is the evidence?</h2><figure class="fig">' + C.evidenceBar(rep.evidence_mix) + "</figure></div>" + emailCard(a) + "</section>");
    var sec = function (id, title, body) { return '<section class="rsec" id="' + id + '"><h2>' + title + "</h2>" + body + "</section>"; };
    var flist = function (items, cls, empty, extra) {
      return items.length ? '<ul class="findings ' + cls + '">' + items.map(function (f) {
        return "<li>" + e(f.text) + (f.knockout ? ' <span class="pill pill-bad">Knockout</span>' : "") + ' <span class="muted small">· Stage ' + f.stage + "</span></li>";
      }).join("") + "</ul>" + (extra || "") : '<p class="muted">' + empty + "</p>";
    };
    h.push('<article class="report">' + sec("why", "Why this verdict", "<p>" + e(rep.why) + "</p>") +
      sec("supports", '<span aria-hidden="true">✓</span> What supports the idea', flist(rep.supports, "good", "No answers yet show strong support.")) +
      sec("against", '<span aria-hidden="true">✕</span> What counts against it', flist(rep.against, "bad", "No evidence against the idea so far.")) +
      sec("untested", '<span aria-hidden="true">?</span> What is still untested', flist(rep.untested, "", "Nothing is marked untested.",
        rep.untested_more ? '<p class="small muted">And ' + rep.untested_more + " more untested answer" + (rep.untested_more === 1 ? "" : "s") + ".</p>" : "")) +
      sec("change", "What would change the verdict", rep.change.length ? '<ul class="findings">' + rep.change.map(function (c) { return "<li>" + e(c.text) + "</li>"; }).join("") + "</ul>"
        : "<p>Every condition for Good idea is met.</p>") +
      sec("deeper", "Go deeper", rep.go_deeper.length ? '<ul class="deeper">' + rep.go_deeper.map(function (g) {
        return '<li><a class="deeper-item status-' + g.status + '" href="' + base + "/stage/" + g.stage + '"><span aria-hidden="true">' + ICONS[g.status] + '</span><span class="deeper-name">' +
          g.stage + ". " + e(g.short) + '</span><span class="small muted">' + e(g.status_label) + " · " + g.remaining + " question" + (g.remaining === 1 ? "" : "s") +
          ' left</span><span class="deeper-go no-print" aria-hidden="true">Open →</span></a></li>';
      }).join("") + "</ul>" : "<p>Every stage is complete.</p>") +
      sec("stages", "Stage by stage", '<div class="table-wrap"><table class="stage-table"><thead><tr><th scope="col">Stage</th><th scope="col">Status</th><th scope="col">Score</th>' +
        '<th scope="col">Reason</th></tr></thead><tbody>' + res.stages.map(function (s) {
          return '<tr><th scope="row">' + s.id + ". " + e(s.short) + (s.core ? ' <span class="pill pill-core">Core</span>' : "") + '</th><td class="status-' + s.status +
            ' nowrap"><span aria-hidden="true">' + ICONS[s.status] + "</span> " + e(s.status_label) + "</td><td>" + (s.score != null ? s.score : "–") + "</td><td>" + e(s.reason) + "</td></tr>";
        }).join("") + "</tbody></table></div>") +
      (rep.founder_view.length ? sec("founder", "Founder's view", '<dl class="founder">' + rep.founder_view.map(function (f) {
        return "<dt>" + e(f.label) + "</dt><dd>" + e(f.answer) + "</dd>";
      }).join("") + "</dl>") : "") + "</article>");
    page(h.join(""), "results-page");
    root.dataset.view = "results"; root.dataset.aid = a.id;
    animateNeedle(a.id + ":" + res.rating);
  }
  function animateNeedle(key) {
    var needle = document.getElementById("needle");
    if (!needle || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var seen = false;
    try { seen = sessionStorage.getItem("spark-dial:" + key) === "1"; sessionStorage.setItem("spark-dial:" + key, "1"); } catch (err) { /* ignore */ }
    if (seen) return;
    var angle = needle.dataset.angle;
    needle.style.transition = "none"; needle.style.transform = "rotate(0deg)"; needle.getBoundingClientRect();
    requestAnimationFrame(function () { needle.style.transition = "transform 850ms cubic-bezier(.2,.8,.2,1)"; needle.style.transform = "rotate(" + angle + "deg)"; });
  }

  // ------------------------------------------------------------ report
  function reportFor(a, toolbar) {
    var res = result(a);
    return C.reportHtml(bank, res, a.idea_name, { css: window.SPARK_REPORT_CSS || "", appName: APP.name, appVersion: APP.version,
      date: (a.updated_at || now()).slice(0, 10), toolbarHtml: toolbar || "" });
  }
  function renderReport(a) {
    page('<div class="report-bar no-print"><a href="#/a/' + a.id + '/results">← Back to results</a><span class="toolbar-actions">' +
      '<button class="btn" type="button" data-print-report>Print / save as PDF</button>' +
      '<button class="btn" type="button" data-download="' + a.id + '">Download PDF</button>' +
      (CFG.leadEndpoint ? '<a class="btn btn-primary" href="#/a/' + a.id + '/results" data-goto-email>Email me the report</a>' : "") +
      '</span></div><iframe class="report-frame" id="report-frame" title="SPARK report"></iframe>', "report-page");
    var frame = document.getElementById("report-frame");
    frame.srcdoc = reportFor(a);
    frame.addEventListener("load", function () {
      try { frame.style.height = (frame.contentDocument.documentElement.scrollHeight + 20) + "px"; } catch (err) { /* ignore */ }
    });
  }
  // ------------------------------------------------------------ download the report as a PDF
  // SparkCore.reportPdf draws the PDF right here in the browser (the same file the report email attaches), so it
  // works offline and nothing is sent anywhere. If it ever fails, the browser's own print window opens instead.
  function choiceOnly(answers) {  // free-text notes never leave the browser
    var out = {};
    Object.keys(answers).forEach(function (k) {
      var q = bank.qById[k], v = answers[k];
      if (q && q.type !== "T" && v.o) out[k] = v.auto ? { o: v.o, auto: v.auto, by: v.by } : { o: v.o };
    });
    return out;
  }
  function reportLink(a) {
    var base = (CFG.siteUrl || "https://www.optivusprof.ca/").replace(/\/?$/, "/") + "spark/";
    return base + "#/r?i=" + encodeURIComponent(a.idea_name.slice(0, 80)) + "&a=" + C.packAnswers(bank, a.answers);
  }
  function downloadPdf(a) {
    try {
      var pdf = C.reportPdf(bank, result(a), a.idea_name, { appName: APP.name, appVersion: APP.version,
                                                            date: (a.updated_at || now()).slice(0, 10), reportUrl: reportLink(a) });
      var bytes = new Uint8Array(pdf.length);
      for (var i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i);
      var link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      link.download = "SPARK_Report_" + (a.idea_name.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40) || "idea") + ".pdf";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 4000);
      flash("PDF downloaded ✓");
    } catch (err) {
      printReport(a, "We couldn't make the PDF just now. In the print window, choose \u201cSave as PDF\u201d.");
    }
  }  // Opens the browser's print window on the report, where "Save as PDF" is one of the printers.
  function printReport(a, message) {
    var frame = document.getElementById("report-frame");
    if (!frame) {
      history.pushState(null, "", "#/a/" + a.id + "/report");
      renderReport(a);
      frame = document.getElementById("report-frame");
    }
    if (message) flash(message, true);
    var doc = frame.contentDocument;
    if (doc && doc.readyState === "complete" && doc.querySelector(".report")) frame.contentWindow.print();
    else frame.addEventListener("load", function () { frame.contentWindow.print(); }, { once: true });
  }

  // ------------------------------------------------------------ report opened from the email link
  // The link holds only the idea name and the choice answers (see SparkCore.packAnswers), so the same
  // report is rebuilt here, in the visitor's browser. Nothing is saved unless they choose to keep working on it.
  var shared = null;
  function renderShared(query) {
    var answers = C.unpackAnswers(bank, query.a);
    root.dataset.view = "shared"; delete root.dataset.aid;
    if (!Object.keys(answers).length) {
      return page('<section class="hero"><p class="eyebrow">Report link</p><h1>That report link is incomplete</h1><p class="lede">The link may have been ' +
        "cut short when it was copied. Open it again from the button in your SPARK email, or start a new assessment.</p>" +
        '<a class="btn btn-primary" href="#/">Start an assessment</a></section>');
    }
    var idea = String(query.i || "").replace(/\s+/g, " ").trim().slice(0, 80) || "Your idea";
    shared = { id: "shared", idea_name: idea, answers: answers, updated_at: now() };
    page('<div class="report-bar no-print"><a href="#/">← SPARK home</a><span class="toolbar-actions">' +
      '<button class="btn" type="button" data-print-report>Print / save as PDF</button>' +
      '<button class="btn" type="button" data-download-shared>Download PDF</button>' +
      '<button class="btn btn-primary" type="button" data-import-shared>Keep working on this idea</button>' +
      '</span></div><iframe class="report-frame" id="report-frame" title="SPARK report"></iframe>', "report-page");
    var frame = document.getElementById("report-frame");
    frame.srcdoc = reportFor(shared);
    frame.addEventListener("load", function () {
      try { frame.style.height = (frame.contentDocument.documentElement.scrollHeight + 20) + "px"; } catch (err) { /* ignore */ }
    });
  }
  function importShared() {
    var id = newAssessment(shared.idea_name);
    store.assessments[id].answers = JSON.parse(JSON.stringify(shared.answers));
    saveStore(store);
    go("#/a/" + id + "/results");
  }

  function renderNotFound() {
    page('<section class="hero"><p class="eyebrow">Not found</p><h1>That assessment isn\'t here</h1><p class="lede">Assessments are saved in the browser ' +
      "they were made in. It may have been deleted, or made on another device or browser.</p>" +
      '<a class="btn btn-primary" href="#/">Go to your assessments</a></section>');
  }

  // ------------------------------------------------------------ actions
  function answer(a, qid, value) {
    var q = bank.qById[qid];
    if (C.hiddenIds(a.answers).indexOf(qid) >= 0) return;
    var out = C.applyAnswer(bank, a.answers, qid, value);
    a.answers = out.answers;
    a.review = (a.review || []).filter(function (r) { return r !== qid; });
    persist(a);
    return q;
  }
  function newAssessment(name) {
    var id = String(store.next++);
    store.assessments[id] = { id: id, idea_name: name.slice(0, 200), answers: {}, bank_version: bank.version, created_at: now(), updated_at: now(), review: [] };
    saveStore(store);
    return id;
  }

  document.addEventListener("submit", function (ev) {
    if (ev.target.id === "start-form") {
      ev.preventDefault();
      var name = document.getElementById("idea_name").value.trim();
      if (!name) return renderHome("Give the idea a name to start.");
      go("#/a/" + newAssessment(name) + "/quick");
    } else if (ev.target.id === "email-form") {
      ev.preventDefault();
      sendEmail(ev.target);
    }
  });

  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-value],[data-clear],[data-quick-go],[data-untested],[data-rename],[data-duplicate],[data-export],[data-delete],[data-download],[data-print-report],[data-scroll],[data-goto-email],[data-download-shared],[data-import-shared]");
    if (!el) return;
    var view = root.dataset.view, a = root.dataset.aid ? getA(root.dataset.aid) : null;
    if (el.dataset.value !== undefined && a) {
      el.classList.add("is-selected");
      onAnswer(a, +el.dataset.qid, el.dataset.value);
    } else if (el.dataset.clear && a) {
      var cq = +el.dataset.clear;
      answer(a, cq, null);
      renderStage(a, +root.dataset.stage, null);
      var first = document.querySelector("#q" + cq + " button.opt, #q" + cq + " select");
      if (first) first.focus();
    } else if (el.dataset.quickGo !== undefined && el.dataset.quickGo && a) {
      renderQuick(a, +el.dataset.quickGo);
    } else if (el.dataset.untested && a) {
      var sid = +el.dataset.untested, out = C.markStageUntested(bank, a.answers, sid);
      a.answers = out.answers; persist(a);
      renderStage(a, sid, { marked: String(out.filled.length) });
    } else if (el.dataset.rename) {
      var ra = getA(el.dataset.rename), val = document.getElementById("rn" + ra.id).value.trim();
      if (val) { ra.idea_name = val.slice(0, 200); persist(ra); renderHome(); }
    } else if (el.dataset.duplicate) {
      var da = getA(el.dataset.duplicate), nid = newAssessment(da.idea_name + " (copy)");
      store.assessments[nid].answers = JSON.parse(JSON.stringify(da.answers)); saveStore(store); renderHome();
    } else if (el.dataset.export) {
      var ea = getA(el.dataset.export);
      var blob = new Blob([JSON.stringify({ app: APP.name, app_version: APP.version, bank_version: bank.version, idea_name: ea.idea_name, answers: ea.answers }, null, 2)], { type: "application/json" });
      var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "SPARK_answers_" + ea.id + ".json";
      document.body.appendChild(link); link.click(); link.remove();
    } else if (el.dataset.delete) {
      if (window.confirm("Delete this assessment and all of its answers from this browser? This cannot be undone.")) {
        delete store.assessments[el.dataset.delete]; saveStore(store); renderHome();
      }
    } else if (el.dataset.downloadShared !== undefined && shared) {
      downloadPdf(shared);
    } else if (el.dataset.importShared !== undefined && shared) {
      importShared();
    } else if (el.dataset.download) {
      downloadPdf(getA(el.dataset.download));
    } else if (el.dataset.printReport !== undefined) {
      var f = document.getElementById("report-frame"); if (f) f.contentWindow.print();
    } else if (el.dataset.scroll) {
      ev.preventDefault();
      var target = document.getElementById(el.dataset.scroll);
      if (target) { target.scrollIntoView({ behavior: "smooth", block: "start" }); var n = document.getElementById("ef-name"); if (n) n.focus({ preventScroll: true }); }
    } else if (el.dataset.gotoEmail !== undefined) {
      ev.preventDefault();
      go("#/a/" + root.dataset.aid + "/results");
      setTimeout(function () { var c = document.getElementById("email-card"); if (c) c.scrollIntoView({ block: "start" }); }, 50);
    }
  });

  document.addEventListener("change", function (ev) {
    var sel = ev.target.closest("select.opt-select");
    if (sel && sel.value) onAnswer(getA(root.dataset.aid), +sel.dataset.qid, sel.value);
  });

  // Save one answer, then move on: next quick question, or the next unanswered question on a stage page.
  function onAnswer(a, qid, value) {
    answer(a, qid, value);
    if (root.dataset.view === "quick") {
      var remaining = C.quickRemaining(bank, a.answers);
      if (!remaining.length) return go("#/a/" + a.id + "/results");
      var hidden = C.hiddenIds(a.answers), order = bank.quickIds.filter(function (q) { return hidden.indexOf(q) < 0; });
      var i = order.indexOf(qid), rest = order.slice(i + 1).concat(order.slice(0, i));
      var next = rest.find(function (q) { return remaining.indexOf(q) >= 0; });
      setTimeout(function () { renderQuick(a, next); }, 180);
    } else {
      renderStage(a, +root.dataset.stage, null, qid);
    }
  }

  var textTimer;
  document.addEventListener("input", function (ev) {
    var ta = ev.target.closest("textarea[data-text]");
    if (!ta) return;
    ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px";
    clearTimeout(textTimer);
    textTimer = setTimeout(function () {
      var a = getA(root.dataset.aid);
      var out = C.applyAnswer(bank, a.answers, +ta.dataset.text, ta.value);
      a.answers = out.answers; persist(a);
    }, 400);
  });

  document.addEventListener("keydown", function (ev) {
    var t = ev.target;
    if (ev.ctrlKey || ev.metaKey || ev.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"))) return;
    var view = root.dataset.view;
    if (view === "quick") {
      var card = document.querySelector(".qcard");
      if (/^[1-9]$/.test(ev.key) && card) {
        var b = card.querySelector('button.opt[data-key="' + ev.key + '"]');
        if (b) { b.click(); ev.preventDefault(); } else { var s = card.querySelector("select"); if (s) { s.focus(); ev.preventDefault(); } }
      } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        var btn = document.querySelectorAll(".quick-nav [data-quick-go]")[ev.key === "ArrowRight" ? 1 : 0];
        if (btn && !btn.disabled) { btn.click(); ev.preventDefault(); }
      }
    } else if (view === "stage") {
      var list = Array.prototype.slice.call(document.querySelectorAll(".qblock:not([hidden])"));
      var cur = (t && t.closest && t.closest(".qblock")) || list.find(function (x) { return x.classList.contains("is-unanswered"); }) || list[0];
      if (!cur) return;
      if (/^[1-9]$/.test(ev.key)) {
        var ob = cur.querySelector('button.opt[data-key="' + ev.key + '"]');
        if (ob) { ob.click(); ev.preventDefault(); }
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        var i = list.indexOf(cur) + (ev.key === "ArrowDown" ? 1 : -1);
        if (i >= 0 && i < list.length) { var f = list[i].querySelector("button.opt, select"); if (f) { f.focus(); list[i].scrollIntoView({ block: "center" }); ev.preventDefault(); } }
      }
    }
  });

  // ------------------------------------------------------------ email the report (Google Apps Script)
  function sendEmail(form) {
    var status = document.getElementById("ef-status");
    var a = getA(form.querySelector("[data-aid]").dataset.aid);
    var name = document.getElementById("ef-name").value.trim(), email = document.getElementById("ef-email").value.trim();
    var consent = document.getElementById("ef-consent").checked, marketing = document.getElementById("ef-marketing").checked;
    var hp = document.getElementById("ef-website").value;
    function say(msg, bad) { status.textContent = msg; status.className = "ef-status" + (bad ? " is-bad" : " is-ok"); }
    if (!name) return say("Please enter your name.", true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return say("Please enter a valid email address.", true);
    if (!consent) return say("Please tick the box so we can email your report.", true);
    var choiceAnswers = {};  // free-text notes never leave the browser
    Object.keys(a.answers).forEach(function (k) {
      var q = bank.qById[k], v = a.answers[k];
      if (q && q.type !== "T" && v.o) choiceAnswers[k] = v.auto ? { o: v.o, auto: v.auto, by: v.by } : { o: v.o };
    });
    var payload = { v: 1, name: name, email: email, consent_report: true, consent_marketing: marketing,
      consent_report_text: CFG.consentReportText, consent_marketing_text: marketing ? CFG.consentMarketingText : "",
      idea_name: a.idea_name, answers: choiceAnswers, bank_version: bank.version, page: location.origin + location.pathname, website: hp };
    var button = form.querySelector("button[type=submit]");
    button.disabled = true; say("Sending…");
    // text/plain keeps this a "simple" request, which Apps Script accepts from any site without a preflight.
    // Give up after 20 seconds so the visitor is never left looking at "Sending…".
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 20000);
    fetch(CFG.leadEndpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
                              body: JSON.stringify(payload), signal: controller ? controller.signal : undefined })
      .then(function () {
        say("Thanks, " + name.split(" ")[0] + ". Your report is on its way to " + email + ". It usually arrives within a minute; check your spam folder if not.");
        form.reset();
      })
      .catch(function () { say("We couldn't send that just now. Please check your connection and try again, or download the report instead.", true); })
      .then(function () { clearTimeout(timer); button.disabled = false; });
  }

  render();
})();
