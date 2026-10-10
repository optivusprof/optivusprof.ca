/* PRISM - SPARK core: question bank helpers, scoring engine, charts and report builder.
 *
 * A line-for-line port of spark/engine.py and web/charts.py, so the website gives exactly the
 * same verdicts as the desktop app (tests/test_web_edition.py compares them). One file, three homes:
 *   - the visitor's browser (window.SparkCore)
 *   - Google Apps Script, which rebuilds the emailed report from the answers (global SparkCore)
 *   - Node, for the parity tests (module.exports)
 * No network, no clock, no randomness: the same answers always give the same result.
 */
var SparkCore = (function () {
  "use strict";

  var STATUS_LABELS = {
    passed: "Passed", failed: "Failed", unproven: "Not yet proven",
    complete: "Complete", in_progress: "In progress", not_started: "Not started"
  };
  var STATUS_ICONS = { passed: "✓", complete: "✓", failed: "✕", unproven: "◐", in_progress: "◐", not_started: "○" };
  var VERDICTS = {
    abandon: ["Not a good idea", "Abandon", "red"],
    change: ["Not a good idea", "Change direction", "red"],
    proceed: ["Good idea", "Proceed", "green"],
    test: ["Maybe", "Test further", "yellow"]
  };
  var SECONDS_PER_QUESTION = 15;

  // ------------------------------------------------------------------ helpers
  function round(x) { return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5); }  // half up, like engine._round

  function pyRound2(x) {  // Python round(x, 2): round half to even on the exact value
    var s = x * 100, f = Math.floor(s), d = s - f;
    var r = d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
    return r / 100;
  }

  function isUpper(c) { return c === c.toUpperCase() && c !== c.toLowerCase(); }
  function isLower(c) { return c === c.toLowerCase() && c !== c.toUpperCase(); }

  function lowerFirst(text) {
    if (text.length > 1 && isUpper(text[0]) && (isLower(text[1]) || " ,'".indexOf(text[1]) >= 0) &&
        text.indexOf("I ") !== 0 && text.indexOf("I'") !== 0) {
      return text[0].toLowerCase() + text.slice(1);
    }
    return text;
  }

  function joinNames(names) {
    if (names.length <= 1) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  function cmpTuple(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }
  function sortBy(arr, key) {  // stable, like Python's sorted
    return arr.map(function (v, i) { return [key(v), i, v]; })
      .sort(function (x, y) { return cmpTuple(x[0], y[0]) || x[1] - y[1]; })
      .map(function (x) { return x[2]; });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // --------------------------------------------------------------------- bank
  function makeBank(data) {
    var stages = data.stages.slice().sort(function (a, b) { return a.id - b.id; });
    var questions = data.questions.slice().sort(function (a, b) { return a.id - b.id; });
    var stageById = {}, qById = {}, byStage = {};
    stages.forEach(function (s) { stageById[s.id] = s; byStage[s.id] = []; });
    questions.forEach(function (q) { qById[q.id] = q; byStage[q.stage].push(q); });
    var bank = {
      data: data, version: String(data.version), thresholds: data.thresholds,
      stages: stages, questions: questions, stageById: stageById, qById: qById, questionsByStage: byStage,
      quickIds: questions.filter(function (q) { return q.quick; }).map(function (q) { return q.id; }),
      scoredStageIds: stages.filter(function (s) { return s.scored !== false && s.weight > 0; }).map(function (s) { return s.id; }),
      coreStageIds: stages.filter(function (s) { return s.core; }).map(function (s) { return s.id; })
    };
    bank.tag = function (opt) { return opt.tag || String(opt.points); };
    bank.option = function (qid, oid) {
      var q = qById[qid];
      if (!q || !q.options) return null;
      for (var i = 0; i < q.options.length; i++) if (q.options[i].id === oid) return q.options[i];
      return null;
    };
    bank.untestedOption = function (qid) {
      var opts = qById[qid].options || [];
      for (var i = 0; i < opts.length; i++) if (opts[i].tag === "U") return opts[i];
      return null;
    };
    bank.gates = function (sid) { return byStage[sid].filter(function (q) { return "gateMin" in q; }); };
    bank.minPassingOption = function (q) {
      var ok = q.options.filter(function (o) { return !o.tag && o.points >= q.gateMin; });
      if (!ok.length) return null;
      return sortBy(ok, function (o) { return [o.points, q.options.indexOf(o)]; })[0];
    };
    return bank;
  }

  // ------------------------------------------------------------------ answers
  function normalize(answers) {
    var out = {};
    Object.keys(answers || {}).forEach(function (k) {
      var v = answers[k];
      if (v && Object.keys(v).length) out[String(parseInt(k, 10))] = v;
    });
    return out;
  }
  function hiddenIds(answers) {
    var a = normalize(answers);
    return Object.keys(a).filter(function (k) { return a[k].auto === "skip"; }).map(Number);
  }
  function isAnswered(q, entry) {
    if (!entry) return false;
    if (q.type === "T") return String(entry.t || "").trim() !== "";
    return !!entry.o;
  }

  function applyAnswer(bank, answers, qid, value) {
    answers = normalize(clone(answers || {}));
    var q = bank.qById[qid];
    var changes = { hidden: [], restored: [] };
    if (q.type === "T") {
      var text = (value || "").trim();
      if (text) answers[qid] = { t: text }; else delete answers[qid];
      return { answers: answers, changes: changes };
    }
    if (value != null && !bank.option(qid, value)) throw new Error("Q" + qid + " has no option " + value);
    Object.keys(answers).forEach(function (k) {
      var e = answers[k];
      if (e.auto === "skip" && e.by === qid) { delete answers[k]; changes.restored.push(Number(k)); }
    });
    if (value == null) {
      delete answers[qid];
    } else {
      answers[qid] = { o: value };
      (bank.option(qid, value).skips || []).forEach(function (target) {
        answers[target] = { o: bank.untestedOption(target).id, auto: "skip", by: qid };
        changes.hidden.push(target);
        var i = changes.restored.indexOf(target);
        if (i >= 0) changes.restored.splice(i, 1);
      });
    }
    changes.hidden.sort(function (a, b) { return a - b; });
    changes.restored.sort(function (a, b) { return a - b; });
    return { answers: answers, changes: changes };
  }

  function markStageUntested(bank, answers, stageId) {
    answers = normalize(clone(answers || {}));
    var filled = [];
    bank.questionsByStage[stageId].forEach(function (q) {
      if (q.type === "S" && !isAnswered(q, answers[q.id])) {
        answers[q.id] = { o: bank.untestedOption(q.id).id, auto: "stage" };
        filled.push(q.id);
      }
    });
    return { answers: answers, filled: filled };
  }

  function reconcile(bank, answers) {
    answers = normalize(clone(answers || {}));
    var flagged = [];
    Object.keys(answers).forEach(function (k) {
      var q = bank.qById[k], e = answers[k];
      if (!q) { delete answers[k]; return; }
      if (q.type === "T") {
        if (!("t" in e)) { delete answers[k]; flagged.push(Number(k)); }
      } else if (!bank.option(Number(k), e.o)) { delete answers[k]; flagged.push(Number(k)); }
    });
    Object.keys(answers).forEach(function (k) {
      var e = answers[k];
      if (e.auto === "skip") {
        var trig = answers[e.by];
        var opt = trig ? bank.option(e.by, trig.o) : null;
        if (!opt || (opt.skips || []).indexOf(Number(k)) < 0) delete answers[k];
      }
    });
    return { answers: answers, flagged: flagged.sort(function (a, b) { return a - b; }) };
  }

  // ----------------------------------------------------------------- progress
  function remainingInStage(bank, answers, stageId) {
    if (stageId === 1) return [];
    answers = normalize(answers);
    return bank.questionsByStage[stageId]
      .filter(function (q) { return q.type !== "T" && !isAnswered(q, answers[q.id]); })
      .map(function (q) { return q.id; });
  }
  function quickRemaining(bank, answers) {
    answers = normalize(answers);
    return bank.quickIds.filter(function (qid) { return !isAnswered(bank.qById[qid], answers[qid]); });
  }
  function stageComplete(bank, answers, stageId, ideaName) {
    if (stageId === 1) return !!(ideaName || "").trim();
    return remainingInStage(bank, answers, stageId).length === 0;
  }
  function progress(bank, answers, ideaName) {
    answers = normalize(answers);
    var hidden = hiddenIds(answers);
    var applicable = bank.questions.filter(function (q) { return q.type !== "T" && q.stage !== 1 && hidden.indexOf(q.id) < 0; });
    var answered = applicable.filter(function (q) { return isAnswered(q, answers[q.id]); }).length;
    var total = applicable.length;
    var quickVisible = bank.quickIds.filter(function (qid) { return hidden.indexOf(qid) < 0; });
    var quickAnswered = quickVisible.filter(function (qid) { return isAnswered(bank.qById[qid], answers[qid]); }).length;
    var deeper = bank.stages.filter(function (s) { return s.id !== 1; }).map(function (s) { return s.id; });
    var stagesDone = deeper.filter(function (sid) { return stageComplete(bank, answers, sid, ideaName); }).length;
    var left = total - answered;
    var quickDone = quickAnswered === quickVisible.length;
    var full = quickDone && stagesDone === deeper.length;
    return {
      named: !!(ideaName || "").trim(),
      quick_answered: quickAnswered, quick_total: quickVisible.length, quick_done: quickDone,
      stages_done: stagesDone, stages_total: deeper.length,
      answered: answered, total: total, left: left,
      pct: total ? round(answered / total * 100) : 0,
      minutes_left: Math.ceil(left * SECONDS_PER_QUESTION / 60),
      step: full ? 5 : quickDone ? 3 : 2, full: full
    };
  }

  // ------------------------------------------------------------------ scoring
  function finding(bank, q, opt) {
    var stage = bank.stageById[q.stage];
    return {
      qid: q.id, stage: q.stage, stage_short: stage.short, core: !!stage.core, label: q.label,
      answer: opt.text, text: q.label + ": " + lowerFirst(opt.text),
      impact: stage.weight * (q.weight || 1), gate: "gateMin" in q, knockout: opt.knockout || null
    };
  }

  function scoreStage(bank, answers, stageId, ideaName) {
    var stage = bank.stageById[stageId], th = bank.thresholds, qs = bank.questionsByStage[stageId];
    var remaining = remainingInStage(bank, answers, stageId);
    var base = {
      id: stageId, title: stage.title, short: stage.short, weight: stage.weight, core: !!stage.core,
      scored: bank.scoredStageIds.indexOf(stageId) >= 0, remaining: remaining.length,
      total: qs.filter(function (q) { return q.type !== "T"; }).length,
      complete: stageComplete(bank, answers, stageId, ideaName)
    };
    if (!base.scored) {
      var status, reason;
      if (stageId === 1) {
        status = base.complete ? "complete" : "not_started";
        reason = base.complete ? "Complete. The idea has a name." : "Not started. The idea has no name yet.";
      } else {
        var answeredN = base.total - base.remaining;
        status = base.complete ? "complete" : (answeredN ? "in_progress" : "not_started");
        reason = "Unscored. The founder's own view.";
      }
      base.status = status; base.status_label = STATUS_LABELS[status]; base.score = null; base.reason = reason;
      base.supports = []; base.against = []; base.untested = []; base.unmet_gates = []; base.answered_scored = 0;
      return base;
    }
    var earned = 0, maximum = 0, nAnswered = 0, nNegative = 0;
    var supports = [], against = [], untested = [], knockouts = [], gateNegatives = [], unmet = [];
    qs.forEach(function (q) {
      if (q.type !== "S") return;
      var entry = answers[q.id];
      var opt = entry && entry.o ? bank.option(q.id, entry.o) : null;
      var w = q.weight || 1;
      if (!opt) { if ("gateMin" in q) unmet.push({ q: q, opt: null, auto: null }); return; }
      var tag = bank.tag(opt);
      if (tag === "X") return;
      nAnswered += 1; earned += opt.points * w; maximum += 3 * w;
      var f = finding(bank, q, opt);
      f.auto = entry.auto || null;
      if (tag === "N") {
        nNegative += 1; against.push(f);
        if (opt.knockout) knockouts.push(f); else if ("gateMin" in q) gateNegatives.push(f);
      } else if (tag === "U") untested.push(f);
      else if (opt.points === 3) supports.push(f);
      if ("gateMin" in q && opt.points < q.gateMin) unmet.push({ q: q, opt: opt, auto: entry.auto || null });
    });
    var score = maximum ? earned / maximum * 100 : null;
    var negFail = nNegative >= th.minNegatives && nAnswered && nNegative / nAnswered >= th.negativeShare;
    var st, rsn;
    if (knockouts.length) { st = "failed"; rsn = "Failed. " + knockouts[0].label + ": " + lowerFirst(knockouts[0].answer) + "."; }
    else if (gateNegatives.length) { st = "failed"; rsn = "Failed. " + gateNegatives[0].label + ": " + lowerFirst(gateNegatives[0].answer) + "."; }
    else if (negFail) { st = "failed"; rsn = "Failed. " + nNegative + " of " + nAnswered + " answers are evidence against the idea."; }
    else if (!unmet.length) {
      st = "passed";
      rsn = "Passed. " + bank.gates(stageId).map(function (g) {
        return g.label + ": " + lowerFirst(bank.option(g.id, answers[g.id].o).text) + ".";
      }).join(" ");
    } else {
      st = "unproven";
      var first = unmet[0];
      if (!first.opt) rsn = "Not yet proven. " + first.q.label + " has not been answered.";
      else rsn = "Not yet proven. " + first.q.label + ": " + lowerFirst(first.opt.text) + ". Needed: " +
        lowerFirst(bank.minPassingOption(first.q).text) + ".";
    }
    base.status = st; base.status_label = STATUS_LABELS[st]; base.reason = rsn;
    base.score = score; base.answered_scored = nAnswered; base.negatives = nNegative;
    base.supports = supports; base.against = against; base.untested = untested;
    base.unmet_gates = unmet.map(function (u) {
      return { qid: u.q.id, label: u.q.label, action: u.q.action || "", auto: u.auto };
    });
    return base;
  }

  function sparkRating(bank, overall, code) {
    var th = bank.thresholds, redMax = th.ratingRedMax, yellowMax = th.ratingYellowMax, zone = VERDICTS[code][2], r;
    if (zone === "red") r = overall * redMax / 100;
    else if (zone === "yellow") r = (redMax + 1) + overall * (yellowMax - redMax - 1) / 100;
    else r = Math.max(overall, yellowMax + 1);
    return [round(r), zone];
  }

  function score(bank, answers, ideaName) {
    answers = normalize(answers);
    ideaName = ideaName || "";
    var th = bank.thresholds;
    var stages = bank.stages.map(function (s) { return scoreStage(bank, answers, s.id, ideaName); });
    var sb = {}; stages.forEach(function (s) { sb[s.id] = s; });
    var scored = stages.filter(function (s) { return s.scored; });
    var core = scored.filter(function (s) { return s.core; });
    var other = scored.filter(function (s) { return !s.core; });
    var overall = scored.reduce(function (t, s) { return t + (s.score || 0) * s.weight; }, 0) / 100;
    var failed = scored.filter(function (s) { return s.status === "failed"; });
    var passed = scored.filter(function (s) { return s.status === "passed"; });
    var coreFailed = core.filter(function (s) { return s.status === "failed"; });
    var corePassed = core.filter(function (s) { return s.status === "passed"; });
    var otherUnproven = other.filter(function (s) { return s.status === "unproven"; });
    var allAgainst = [];
    scored.forEach(function (s) { allAgainst = allAgainst.concat(s.against); });
    var abandonKnockouts = allAgainst.filter(function (f) { return f.knockout === "abandon"; });

    var rule, code;
    if (sb[2].status === "failed" || abandonKnockouts.length) { rule = 1; code = "abandon"; }
    else if (coreFailed.length || failed.length >= th.failedStagesForRed) { rule = 2; code = "change"; }
    else if (!failed.length && corePassed.length === core.length && overall >= th.goodScore &&
             otherUnproven.length <= th.maxUnprovenForGood) { rule = 3; code = "proceed"; }
    else { rule = 4; code = "test"; }

    var nScoredAnswered = scored.reduce(function (t, s) { return t + s.answered_scored; }, 0);
    var nUntested = scored.reduce(function (t, s) { return t + s.untested.length; }, 0);
    var gateQs = [];
    bank.scoredStageIds.forEach(function (sid) { gateQs = gateQs.concat(bank.gates(sid)); });
    var gatesWithoutEvidence = gateQs.filter(function (q) {
      var e = answers[q.id];
      var opt = e && e.o ? bank.option(q.id, e.o) : null;
      return !opt || bank.tag(opt) === "U";
    }).length;
    var gateShare = th.tooEarlyGateShare == null ? 0.5 : th.tooEarlyGateShare;
    var tooEarly = nScoredAnswered === 0 || nUntested * 2 > nScoredAnswered || gatesWithoutEvidence > gateShare * gateQs.length;

    var label = VERDICTS[code][0], action = VERDICTS[code][1];
    var headline = code === "test" ? (tooEarly ? "Too early to tell" : "Promising but unproven")
      : code === "proceed" ? "Supported by the evidence"
      : code === "change" ? "The evidence contradicts the idea" : "It cannot meet your goals";
    var rz = sparkRating(bank, overall, code), rating = rz[0], zone = rz[1];

    var nAnswers = Object.keys(answers).filter(function (k) {
      var q = bank.qById[k];
      return q && q.type !== "T" && isAnswered(q, answers[k]) && answers[k].auto !== "skip";
    }).length;
    var full = stages.every(function (s) { return s.complete; });
    var quickDone = quickRemaining(bank, answers).length === 0;
    var depthLabel = full ? "Full assessment" : "Quick read · " + nAnswers + " answer" + (nAnswers !== 1 ? "s" : "");
    var names = function (list) { return joinNames(list.map(function (s) { return s.short; })); };

    var why;
    if (rule === 1) {
      var trig = abandonKnockouts[0] || sb[2].against[0] || null;
      why = "This idea cannot meet the goals you set.";
      if (trig) why += " " + trig.label + ": " + lowerFirst(trig.answer) + ".";
    } else if (rule === 2) {
      why = "The evidence contradicts the idea at " + names(failed) + ".";
    } else if (rule === 3) {
      why = "The evidence supports the idea. All five core stages passed and the overall score is " + rating + ".";
    } else if (tooEarly) {
      if (nScoredAnswered === 0) why = "No scored questions have been answered yet, so there is not enough evidence to judge.";
      else if (!(nUntested * 2 > nScoredAnswered)) why = gatesWithoutEvidence + " of " + gateQs.length +
        " gate questions have no evidence yet, so there is not enough evidence to judge.";
      else why = nUntested + " of " + nScoredAnswered + " scored answers are untested, so there is not enough evidence to judge yet.";
    } else {
      var coreUnproven = core.filter(function (s) { return s.status === "unproven"; });
      var still = coreUnproven.length ? coreUnproven : otherUnproven;
      why = corePassed.length + " of " + core.length + " core stages have passed.";
      if (still.length) why += " Still unproven: " + names(still) + ".";
      if (failed.length) why += " Failed: " + names(failed) + ".";
    }

    var byImpact = function (f) { return [-f.impact, f.qid]; };
    var evidenceStages = scored.filter(function (s) { return !bank.stageById[s.id].selfReport; });
    var supportsPool = [];
    evidenceStages.forEach(function (s) { supportsPool = supportsPool.concat(s.supports); });
    var supports = [], perStage = {};
    sortBy(supportsPool, byImpact).forEach(function (f) {
      if ((perStage[f.stage] || 0) < 2) { supports.push(f); perStage[f.stage] = (perStage[f.stage] || 0) + 1; }
    });
    var against = sortBy(allAgainst, function (f) { return [f.knockout ? 0 : 1, f.core ? 0 : 1, -f.impact, f.qid]; });
    var untestedPool = [];
    scored.forEach(function (s) { untestedPool = untestedPool.concat(s.untested); });
    var untestedAll = sortBy(untestedPool, byImpact);

    var change = [];
    if (code !== "proceed") {
      abandonKnockouts.forEach(function (f) {
        change.push({ text: "Change the answer that rules the idea out: " + f.label + " (" + f.answer.replace(/\.+$/, "") + ").",
                      qid: f.qid, stage: f.stage });
      });
      failed.forEach(function (s) {
        change.push({ text: "Resolve the evidence against " + s.short + ". " + s.reason.slice("Failed. ".length), qid: null, stage: s.id });
      });
      core.forEach(function (s) {
        if (s.status === "unproven") s.unmet_gates.forEach(function (g) {
          if (g.auto !== "skip") change.push({ text: g.action + " (Q" + g.qid + ").", qid: g.qid, stage: s.id });
        });
      });
      var excess = otherUnproven.length - th.maxUnprovenForGood;
      if (excess > 0) change.push({ text: "Prove at least " + excess + " more of these stages: " + names(otherUnproven) + ".",
                                    qid: null, stage: otherUnproven[0].id });
      if (overall < th.goodScore && !failed.length && corePassed.length === core.length)
        change.push({ text: "Strengthen the weaker answers across the stages; the overall evidence is not yet strong enough.", qid: null, stage: null });
    }

    var deeperRank = function (s) {
      var notPassed = s.scored && s.status !== "passed";
      return [s.core && notPassed ? 0 : notPassed ? 1 : 2, s.id];
    };
    var goDeeper = sortBy(stages.filter(function (s) { return s.remaining > 0; }), deeperRank).map(function (s) {
      return { stage: s.id, short: s.short, title: s.title, remaining: s.remaining, status: s.status, status_label: s.status_label };
    });
    var focus = null;
    [coreFailed, core.filter(function (s) { return s.status === "unproven"; }), failed, otherUnproven].some(function (g) {
      if (g.length) { focus = g[0].id; return true; }
      return false;
    });
    if (focus === null && goDeeper.length) focus = goDeeper[0].stage;

    var experiments = scored.filter(function (s) { return s.status !== "passed"; }).slice(0, 3).map(function (s) {
      return { stage: s.id, short: s.short, text: bank.stageById[s.id].nextStep };
    });

    // evidence mix
    var levels = [["strong", "Strong evidence", "commitments or measured results"],
                  ["good", "Good evidence", "what people did or described"],
                  ["weak", "Weak evidence", "second-hand or stated"],
                  ["untested", "Untested or opinion", "not checked yet"],
                  ["against", "Against the idea", "evidence that contradicts it"]];
    var mix = { strong: 0, good: 0, weak: 0, untested: 0, against: 0 };
    bank.questions.forEach(function (q) {
      if (q.type !== "S" || bank.scoredStageIds.indexOf(q.stage) < 0) return;
      var e = answers[q.id];
      var opt = e && e.o ? bank.option(q.id, e.o) : null;
      if (!opt || bank.tag(opt) === "X") return;
      var tag = bank.tag(opt);
      if (tag === "N") mix.against++; else if (tag === "U") mix.untested++;
      else mix[{ 3: "strong", 2: "good", 1: "weak" }[opt.points]]++;
    });
    var mixTotal = mix.strong + mix.good + mix.weak + mix.untested + mix.against;
    var evidenceMix = {
      total: mixTotal,
      levels: levels.map(function (l) {
        return { key: l[0], label: l[1], hint: l[2], count: mix[l[0]], pct: mixTotal ? round(mix[l[0]] / mixTotal * 100) : 0 };
      }),
      observed_or_better_pct: mixTotal ? round((mix.strong + mix.good) / mixTotal * 100) : 0
    };

    // recommendations
    var recs = [];
    function gateRec(kind, st, qid) {
      var q = bank.qById[qid], e = answers[qid];
      if (e && e.auto === "skip") return null;
      var opt = e && e.o ? bank.option(qid, e.o) : null;
      var need = "gateMin" in q ? bank.minPassingOption(q) : null;
      var now = opt ? "now: " + lowerFirst(opt.text) : "not answered yet";
      var w = st.short + (st.core ? " (core stage)" : "") + ". " + q.label + ", " + now + ".";
      if (need) w += " Needed: " + lowerFirst(need.text) + ".";
      return { kind: kind, stage: st.id, stage_short: st.short, core: st.core, qid: qid,
               title: q.action || q.label, why: w, how: q.howTo || bank.stageById[st.id].nextStep,
               success: q.success || "", time: q.time || "" };
    }
    function rethink(st, title, extraHow, success, time) {
      return { kind: "rethink", stage: st.id, stage_short: st.short, core: st.core, qid: null, title: title,
               why: st.reason.replace("Failed. ", "") + (st.core ? " This is a core stage, so it decides the verdict." : ""),
               how: extraHow + bank.stageById[st.id].nextStep, success: success, time: time };
    }
    abandonKnockouts.forEach(function (f) {
      var r = gateRec("resolve", sb[f.stage], f.qid);
      r.title = "Resolve first: " + f.label.toLowerCase() + " rules the idea out as it stands";
      recs.push(r);
    });
    sortBy(coreFailed, function (x) { return [-x.weight, x.id]; }).forEach(function (st) {
      recs.push(rethink(st, "Rethink " + st.short.toLowerCase() + ": the evidence counts against it",
        "Go back to the customers behind this answer. Change the segment, the problem or the solution, then test again. ",
        "New evidence that supports the changed idea", "2–4 weeks"));
    });
    core.filter(function (x) { return x.status === "unproven"; }).forEach(function (st) {
      st.unmet_gates.forEach(function (g) { var r = gateRec("prove", st, g.qid); if (r) recs.push(r); });
    });
    sortBy(failed.filter(function (x) { return !x.core; }), function (x) { return [-x.weight, x.id]; }).forEach(function (st) {
      if (!recs.some(function (r) { return r.stage === st.id; }))
        recs.push(rethink(st, "Fix what counts against " + st.short.toLowerCase(), "",
          "The negative answers in this stage turn around", "1–3 weeks"));
    });
    otherUnproven.forEach(function (st) {
      st.unmet_gates.forEach(function (g) { var r = gateRec("prove", st, g.qid); if (r) recs.push(r); });
    });
    var ip = answers[105];
    var ipOpt = ip && ip.o ? bank.option(105, ip.o) : null;
    var ipOpen = !ipOpt || (!ipOpt.knockout && (ipOpt.points || 0) < 3);
    if (ipOpen && !recs.some(function (r) { return r.qid === 105; })) {
      var r105 = gateRec("prove", sb[14], 105);
      if (r105) recs.push(r105);
    }
    if (!recs.length) {
      sortBy(scored.filter(function (x) { return (x.score || 0) < 85; }), function (x) { return [x.score || 0, x.id]; })
        .slice(0, 3).forEach(function (st) {
          recs.push({ kind: "strengthen", stage: st.id, stage_short: st.short, core: st.core, qid: null,
                      title: "Strengthen " + st.short.toLowerCase(),
                      why: st.short + " passed, but its score is " + round(st.score || 0) + " out of 100.",
                      how: bank.stageById[st.id].nextStep, success: "A stage score of 85 or more", time: "1–2 weeks" });
        });
      recs.push({ kind: "plan", stage: null, stage_short: "Business plan", core: false, qid: null,
                  title: "Write the business plan",
                  why: "The evidence supports the idea. What is left sits outside this assessment.",
                  how: "Decide the legal structure and tax, a hiring plan, a brand and marketing plan, detailed financial projections and a launch timeline.",
                  success: "A plan your funders and first hires can act on", time: "2–4 weeks" });
    }
    recs.forEach(function (r, i) { r.priority = i + 1; });

    var founderView = [];
    var fvIds = bank.questionsByStage[1].filter(function (q) { return q.label === "Assumptions"; }).map(function (q) { return q.id; })
      .concat(bank.questionsByStage[16].map(function (q) { return q.id; }));
    fvIds.forEach(function (qid) {
      var q = bank.qById[qid], a = answers[qid];
      if (isAnswered(q, a)) founderView.push({ qid: qid, label: q.label, answer: q.type === "T" ? a.t : bank.option(qid, a.o).text });
    });

    var strip = function (f) {
      var o = {};
      ["qid", "stage", "stage_short", "label", "answer", "text", "core", "knockout", "auto"].forEach(function (k) { if (k in f) o[k] = f[k]; });
      return o;
    };
    var stageRows = stages.map(function (s) {
      var row = {};
      ["id", "title", "short", "weight", "core", "scored", "status", "status_label", "reason", "remaining", "total", "complete"]
        .forEach(function (k) { row[k] = s[k]; });
      row.score = s.score == null ? null : round(s.score);
      row.unmet_gates = s.unmet_gates;
      return row;
    });

    return {
      bank_version: bank.version,
      overall: pyRound2(overall),
      rating: rating, zone: zone,
      verdict: { rule: rule, code: code, label: label, action: action, headline: headline },
      text_equivalent: "SPARK rating " + rating + " out of 100: " + label,
      depth: { full: full, quick_done: quickDone, answers: nAnswers, label: depthLabel },
      tiles: { core_passed: corePassed.length, core_total: core.length, passed: passed.length,
               failed: failed.length, scored_total: scored.length },
      stages: stageRows,
      report: {
        why: why,
        supports: supports.slice(0, 5).map(strip),
        against: against.map(strip),
        untested: untestedAll.slice(0, 5).map(strip),
        untested_more: Math.max(0, untestedAll.length - 5),
        change: change, go_deeper: goDeeper, focus_stage: focus, experiments: experiments,
        founder_view: founderView, evidence_mix: evidenceMix, recommendations: recs
      },
      progress: progress(bank, answers, ideaName)
    };
  }

  // -------------------------------------------------------------- report links
  /* Choice answers packed into a short link, so the report email can open the full report on the website.
   * Each answer is "<question id><option id>", plus "~<id>" when skipped by another answer or "!" when the stage
   * was marked untested; answers are joined by ".". Free text, names and emails are never included. */
  function packAnswers(bank, answers) {
    answers = normalize(answers);
    return Object.keys(answers).map(Number).sort(function (a, b) { return a - b; }).filter(function (qid) {
      var q = bank.qById[qid], v = answers[qid];
      return q && q.type !== "T" && v.o && bank.option(qid, v.o);
    }).map(function (qid) {
      var v = answers[qid];
      return qid + v.o + (v.auto === "skip" ? "~" + v.by : v.auto === "stage" ? "!" : "");
    }).join(".");
  }
  function unpackAnswers(bank, packed) {
    var answers = {};
    String(packed || "").split(".").slice(0, 300).forEach(function (item) {
      var m = /^(\d{1,4})([a-z]{1,3})(?:~(\d{1,4})|(!))?$/.exec(item);
      if (!m) return;
      var qid = parseInt(m[1], 10), q = bank.qById[qid];
      if (!q || q.type === "T" || !bank.option(qid, m[2])) return;
      var entry = { o: m[2] };
      if (m[3]) { entry.auto = "skip"; entry.by = parseInt(m[3], 10); } else if (m[4]) entry.auto = "stage";
      answers[qid] = entry;
    });
    return reconcile(bank, answers).answers;
  }

  // ------------------------------------------------------------------- charts
  var INK = "#0F172A", MUTED = "#64748B", RULE = "#E2D9C8";
  var STATUS_FILL = { passed: "#10B981", unproven: "#F59E0B", failed: "#DC2626" };
  var EVIDENCE_FILL = { strong: "#065F46", good: "#10B981", weak: "#A7F3D0", untested: "#CBD5E1", against: "#DC2626" };
  var EVIDENCE_TEXT = { strong: "#FFFFFF", good: "#FFFFFF", weak: INK, untested: INK, against: "#FFFFFF" };

  function stageBars(result) {
    var rows = result.stages.filter(function (s) { return s.scored; });
    var width = 680, labelW = 200, barW = 330, rowH = 30, top = 26, height = top + rowH * rows.length + 8;
    var summary = "Stage scores out of 100: " + rows.map(function (s) {
      return s.short + " " + (s.score != null ? s.score : "no answers") + " (" + s.status_label + ")";
    }).join("; ");
    var p = ['<svg class="chart" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + escapeHtml(summary) + '" xmlns="http://www.w3.org/2000/svg">'];
    [0, 50, 100].forEach(function (v) {
      var x = labelW + barW * v / 100;
      p.push('<line x1="' + x + '" y1="' + (top - 6) + '" x2="' + x + '" y2="' + (height - 6) + '" stroke="' + RULE + '" stroke-width="1"/>');
      p.push('<text x="' + x + '" y="' + (top - 12) + '" font-size="11" fill="' + MUTED + '" text-anchor="middle">' + v + "</text>");
    });
    rows.forEach(function (s, i) {
      var y = top + i * rowH;
      p.push('<text x="' + (labelW - 10) + '" y="' + (y + 19) + '" font-size="13" font-weight="' + (s.core ? "700" : "400") + '" fill="' + INK +
             '" text-anchor="end">' + escapeHtml(s.id + ". " + s.short) + (s.core ? " ●" : "") + "</text>");
      p.push('<rect x="' + labelW + '" y="' + (y + 6) + '" width="' + barW + '" height="18" rx="3" fill="#F5F2ED"/>');
      if (s.score == null) {
        p.push('<text x="' + (labelW + 8) + '" y="' + (y + 19) + '" font-size="12" fill="' + MUTED + '">No answers yet</text>');
        return;
      }
      var w = Math.max(2, barW * s.score / 100);
      p.push('<rect x="' + labelW + '" y="' + (y + 6) + '" width="' + w.toFixed(1) + '" height="18" rx="3" fill="' + (STATUS_FILL[s.status] || "#CBD5E1") + '"/>');
      p.push('<text x="' + (labelW + barW + 8) + '" y="' + (y + 19) + '" font-size="12" fill="' + INK + '">' + s.score + " · " + escapeHtml(s.status_label) + "</text>");
    });
    p.push("</svg>");
    return p.join("");
  }

  function evidenceBar(mix) {
    var width = 680, barY = 8, barH = 36, levels = mix.levels, total = mix.total;
    var height = barY + barH + 18 + Math.ceil(levels.length / 2) * 24;
    var label = "Evidence behind your answers: " + levels.map(function (l) { return l.label + " " + l.count + " (" + l.pct + "%)"; }).join("; ");
    var p = ['<svg class="chart" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + escapeHtml(label) + '" xmlns="http://www.w3.org/2000/svg">'];
    if (!total) {
      p.push('<rect x="0" y="' + barY + '" width="' + width + '" height="' + barH + '" rx="4" fill="#F5F2ED"/>');
      p.push('<text x="' + width / 2 + '" y="' + (barY + 23) + '" font-size="13" fill="' + MUTED + '" text-anchor="middle">No scored answers yet</text>');
    } else {
      var x = 0;
      levels.forEach(function (l) {
        if (!l.count) return;
        var w = width * l.count / total;
        p.push('<rect x="' + x.toFixed(1) + '" y="' + barY + '" width="' + w.toFixed(1) + '" height="' + barH + '" fill="' + EVIDENCE_FILL[l.key] + '"/>');
        if (w >= 34) p.push('<text x="' + (x + w / 2).toFixed(1) + '" y="' + (barY + 23) + '" font-size="12" font-weight="700" fill="' +
                            EVIDENCE_TEXT[l.key] + '" text-anchor="middle">' + l.pct + "%</text>");
        x += w;
      });
    }
    levels.forEach(function (l, i) {
      var lx = (i % 2) * 340, ly = barY + barH + 18 + Math.floor(i / 2) * 24;
      p.push('<rect x="' + lx + '" y="' + ly + '" width="12" height="12" rx="2" fill="' + EVIDENCE_FILL[l.key] + '"/>');
      p.push('<text x="' + (lx + 18) + '" y="' + (ly + 11) + '" font-size="12" fill="' + INK + '">' + escapeHtml(l.label) + ": " + l.count + " (" + l.pct + "%)</text>");
    });
    p.push("</svg>");
    return p.join("");
  }

  function dial(rating, zone, th) {
    var cx = 160, cy = 160, r = 120, redMax = th.ratingRedMax, yellowMax = th.ratingYellowMax;
    function pt(v, rad) { var a = Math.PI - (v / 100) * Math.PI; return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)]; }
    function arc(a, b, colour) {
      var p1 = pt(a, r), p2 = pt(b, r);
      return '<path d="M ' + p1[0].toFixed(2) + " " + p1[1].toFixed(2) + " A " + r + " " + r + " 0 0 1 " + p2[0].toFixed(2) + " " +
             p2[1].toFixed(2) + '" fill="none" stroke="' + colour + '" stroke-width="26"/>';
    }
    var n = pt(rating, r - 18);
    var names = { red: "Not a good idea", yellow: "Maybe", green: "Good idea" };
    return '<svg class="dial-static" viewBox="0 0 320 185" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="SPARK rating ' + rating +
      " out of 100, in the " + names[zone] + ' zone">' + arc(0, redMax + 0.5, "#DC2626") + arc(redMax + 0.5, yellowMax + 0.5, "#F59E0B") +
      arc(yellowMax + 0.5, 100, "#10B981") +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + n[0].toFixed(2) + '" y2="' + n[1].toFixed(2) + '" stroke="' + INK + '" stroke-width="6" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="9" fill="' + INK + '"/>' +
      '<text x="22" y="180" font-size="12" fill="' + MUTED + '">0</text><text x="298" y="180" font-size="12" fill="' + MUTED + '" text-anchor="end">100</text></svg>';
  }

  // ------------------------------------------------------------------- report
  /* Builds the full, self-contained report document (same content as the desktop report).
   * opts: { css, appName, appVersion, date, includeFounderView, toolbarHtml } */
  function reportHtml(bank, result, ideaName, opts) {
    opts = opts || {};
    var e = escapeHtml, rep = result.report, v = result.verdict, mix = rep.evidence_mix, recs = rep.recommendations;
    var th = bank.thresholds, icon = { red: "✕", yellow: "◐", green: "✓" }[result.zone];
    var h = [];
    h.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
    h.push("<title>SPARK report · " + e(ideaName) + "</title><style>" + (opts.css || "") + "</style></head>");
    h.push('<body class="zone-' + result.zone + '">' + (opts.toolbarHtml || ""));
    h.push('<article class="report"><header class="cover"><p class="cover-brand"><span class="cover-mark" aria-hidden="true">✦</span> PRISM - SPARK ' +
           '<span class="cover-sub">Startup Potential Assessment &amp; Rating Kit</span></p><h1 class="cover-title">' + e(ideaName) + "</h1>" +
           '<p class="cover-meta">Idea assessment report · ' + e(opts.date || "") + " · " + e(result.depth.label) + "</p></header>");
    h.push('<section class="verdict-panel"><div class="verdict-dial">' + dial(result.rating, result.zone, th) +
           '<p class="zone-key"><span class="k k-red">■ Not a good idea 0–' + th.ratingRedMax + '</span> <span class="k k-yellow">■ Maybe ' +
           (th.ratingRedMax + 1) + "–" + th.ratingYellowMax + '</span> <span class="k k-green">■ Good idea ' + (th.ratingYellowMax + 1) + "–100</span></p></div>");
    h.push('<div class="verdict-text"><p class="rating"><span class="rating-num">' + result.rating + '</span><span class="rating-of">/100</span> ' +
           '<span class="rating-label">SPARK rating</span></p><h2 class="verdict-label"><span aria-hidden="true">' + icon + "</span> " + e(v.label) +
           (v.code === "test" ? ": " + e(lowerFirst(v.headline)) : "") + '</h2><p class="verdict-action">Recommended action: <strong>' + e(v.action) +
           '</strong></p><p class="why">' + e(rep.why) + "</p></div></section>");
    var t = result.tiles;
    var tile = function (num, small, label, bad) {
      return '<div class="g-tile' + (bad ? " g-bad" : "") + '"><span class="g-num">' + num + (small ? "<small>" + small + "</small>" : "") +
             '</span><span class="g-label">' + label + "</span></div>";
    };
    h.push('<section class="glance">' + tile(t.core_passed, "/" + t.core_total, "Core stages passed") + tile(t.passed, "/" + t.scored_total, "Stages passed") +
           tile(t.failed, "", "Stages failed", t.failed) + tile(mix.observed_or_better_pct, "%", "Answers backed by real behaviour") +
           tile(result.progress.pct, "%", "Of the assessment completed") + "</section>");
    var lede = v.code === "proceed" ? "The evidence supports the idea. These steps strengthen it and move you to launch planning."
      : v.code === "abandon" ? "As it stands, this idea can't meet the goals you set. Resolve the first item before investing more."
      : v.code === "change" ? "The evidence contradicts the idea in at least one place. Start with what counts against it."
      : "These are the steps most likely to change the verdict, in the order to do them.";
    h.push('<section class="r-sec r-page"><h2 class="r-h">Your action plan</h2><p class="r-lede">' + lede + '</p><ol class="priorities">');
    recs.slice(0, 3).forEach(function (r) {
      h.push('<li class="prio prio-' + r.kind + '"><span class="prio-num" aria-hidden="true">' + r.priority + '</span><div class="prio-body">' +
             '<h3 class="prio-title">' + e(r.title) + '</h3><p class="prio-why"><strong>Why:</strong> ' + e(r.why) + '</p><p class="prio-how"><strong>How:</strong> ' +
             e(r.how) + '</p><p class="prio-meta">' + (r.success ? "<span><strong>Done when:</strong> " + e(r.success) + "</span>" : "") +
             (r.time ? "<span><strong>Effort:</strong> " + e(r.time) + "</span>" : "") + "</p></div></li>");
    });
    h.push("</ol>");
    if (recs.length > 3) {
      h.push('<h3 class="r-h3">The rest of the plan</h3><table class="plan"><thead><tr><th scope="col">#</th><th scope="col">Step</th><th scope="col">Stage</th>' +
             '<th scope="col">Done when</th><th scope="col">Effort</th></tr></thead><tbody>');
      recs.slice(3).forEach(function (r) {
        h.push("<tr><td>" + r.priority + "</td><td><strong>" + e(r.title) + '</strong><br><span class="muted">' + e(r.how) + "</span></td><td>" +
               e(r.stage_short) + (r.core ? ' <span class="core">core</span>' : "") + "</td><td>" + e(r.success) + '</td><td class="nowrap">' + e(r.time) + "</td></tr>");
      });
      h.push("</tbody></table>");
    }
    h.push("</section>");
    var untestedPct = 0;
    mix.levels.forEach(function (l) { if (l.key === "untested") untestedPct = l.pct; });
    var againstN = 0;
    mix.levels.forEach(function (l) { if (l.key === "against") againstN = l.count; });
    var mixText = mix.total ? mix.observed_or_better_pct + "% of your " + mix.total + " scored answers rest on what people actually did, committed or measured. " +
      untestedPct + "% are still untested or opinion." + (againstN ? " " + againstN + " answer" + (againstN === 1 ? " counts" : "s count") + " against the idea." : "")
      : "No scored answers yet.";
    h.push('<section class="r-sec r-page"><h2 class="r-h">Where the idea stands</h2><p class="r-lede">Each bar is a stage\'s score out of 100, coloured by its status. ' +
           'Core stages (●) decide the verdict.</p><figure class="fig">' + stageBars(result) + '<figcaption class="legend"><span class="k k-green">■ Passed</span>' +
           '<span class="k k-yellow">■ Not yet proven</span><span class="k k-red">■ Failed</span></figcaption></figure>' +
           '<h2 class="r-h r-h-gap">How strong is the evidence?</h2><p class="r-lede">' + e(mixText) + '</p><figure class="fig">' + evidenceBar(mix) +
           '</figure><p class="note">Evidence levels follow the framework\'s rule: opinion is not evidence, what people do beats what they say, and commitments ' +
           "of money, time or reputation are strongest.</p></section>");
    var list = function (items, empty, more) {
      if (!items.length) return '<p class="muted">' + empty + "</p>";
      return "<ul>" + items.map(function (f) { return "<li>" + e(f.text) + (f.knockout ? " <strong>(knockout)</strong>" : "") + "</li>"; }).join("") + "</ul>" +
             (more ? '<p class="muted small">And ' + more + " more.</p>" : "");
    };
    h.push('<section class="r-sec"><h2 class="r-h">What the answers say</h2><div class="cols">' +
           '<div class="col col-good"><h3 class="r-h3"><span aria-hidden="true">✓</span> Supports the idea</h3>' + list(rep.supports, "No strong support yet.") + "</div>" +
           '<div class="col col-bad"><h3 class="r-h3"><span aria-hidden="true">✕</span> Counts against it</h3>' + list(rep.against, "No evidence against the idea so far.") + "</div>" +
           '<div class="col col-open"><h3 class="r-h3"><span aria-hidden="true">?</span> Still untested</h3>' + list(rep.untested, "Nothing marked untested.", rep.untested_more) + "</div></div>");
    if (rep.change.length) h.push('<h3 class="r-h3">What would change the verdict</h3><ul class="change">' +
                                  rep.change.map(function (c) { return "<li>" + e(c.text) + "</li>"; }).join("") + "</ul>");
    h.push("</section>");
    h.push('<section class="r-sec r-page"><h2 class="r-h">Stage by stage</h2><table class="stages"><thead><tr><th scope="col">Stage</th><th scope="col">Status</th>' +
           '<th scope="col">Score</th><th scope="col">Reason</th></tr></thead><tbody>');
    result.stages.forEach(function (s) {
      h.push('<tr class="st-' + s.status + '"><th scope="row">' + s.id + ". " + e(s.short) + (s.core ? ' <span class="core">core</span>' : "") +
             '</th><td class="nowrap status"><span aria-hidden="true">' + STATUS_ICONS[s.status] + "</span> " + e(s.status_label) + "</td><td>" +
             (s.score != null ? s.score : "–") + "</td><td>" + e(s.reason) + "</td></tr>");
    });
    h.push("</tbody></table>");
    if (opts.includeFounderView !== false && rep.founder_view.length) {
      h.push('<h3 class="r-h3">Founder\'s view</h3><dl class="founder">' + rep.founder_view.map(function (f) {
        return "<dt>" + e(f.label) + "</dt><dd>" + e(f.answer) + "</dd>";
      }).join("") + "</dl>");
    }
    h.push("</section>");
    h.push('<section class="r-sec method"><h2 class="r-h">How this assessment works</h2><p>SPARK applies the Entrepreneur\'s Idea Validation Framework: ' +
           "124 questions across 16 stages, from defining the idea to making the decision. Each scored stage has gate questions that set the minimum " +
           "evidence needed to pass. A stage fails only on evidence against the idea, never on missing evidence. The verdict comes from fixed rules: " +
           "the five core stages (problem, customer, validation, solution and willingness to pay) must pass for a \"Good idea\". The same answers " +
           "always produce the same report, and no AI is used.</p><p>Answer scales are built on published research and practice, including Fitzpatrick's " +
           "<em>The Mom Test</em>, Blank's customer development, Guest, Bunce &amp; Johnson (2006) on interview saturation, Camuffo et al. (2020) on " +
           "hypothesis-driven entrepreneurship, Skok's SaaS unit-economics benchmarks, Helmer's <em>7 Powers</em> and Azoulay et al. (2020) on founder experience.</p></section>");
    h.push('<footer class="r-foot">' + e(opts.appName || "PRISM - SPARK") + " v" + e(opts.appVersion || "") + " · question bank " + e(result.bank_version) +
           " · generated " + e(opts.date || "") + " · Optivus · optivusprof.ca</footer></article></body></html>");
    return h.join("");
  }

  var ZONE_INK = { red: "#B91C1C", yellow: "#92400E", green: "#065F46" };
  var ZONE_SOFT = { red: "#FEE2E2", yellow: "#FEF3C7", green: "#D1FAE5" };
  // Email clients and converters don't always honour the character set, so anything outside plain ASCII
  // becomes an HTML entity. (The class lists only printable ASCII, so it survives any copy and paste.)
  function toEntities(html) {
    return html.replace(/[^\t\n\r -~]/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; });
  }

  /* The email itself. Email clients (Gmail, Outlook, phone apps) ignore <style>, SVG, flexbox and grid, so this is
   * built from tables and inline styles only. opts: { reportUrl, pdfAttached } */
  function emailHtml(result, firstName, ideaName, footerHtml, opts) {
    opts = opts || {};
    var e = escapeHtml, v = result.verdict, t = result.tiles, rep = result.report;
    var F = "font-family:Aptos,'Segoe UI',Arial,Helvetica,sans-serif;";
    var ink = ZONE_INK[result.zone], soft = ZONE_SOFT[result.zone];
    function button(label) {
      return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0"><tr>' +
        '<td bgcolor="#065F46" style="background:#065F46;border-radius:6px"><a href="' + e(opts.reportUrl) + '" target="_blank" style="' + F +
        'display:inline-block;padding:14px 28px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px">' + label +
        "</a></td></tr></table>";
    }
    function stat(num, of, label, bad) {
      return '<td width="33%" align="center" bgcolor="#F5F2ED" style="background:#F5F2ED;border-radius:8px;padding:12px 6px;' + F + '">' +
        '<div style="font-size:24px;font-weight:bold;line-height:1.1;color:' + (bad ? "#B91C1C" : "#0F172A") + '">' + num +
        (of ? '<span style="font-size:13px;color:#64748B;font-weight:normal">' + of + "</span>" : "") + "</div>" +
        '<div style="font-size:12px;line-height:1.3;color:#475569;padding-top:4px">' + label + "</div></td>";
    }
    var steps = rep.recommendations.slice(0, 3).map(function (r) {
      return '<tr><td width="42" valign="top" style="padding:0 12px 16px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td width="30" height="30" align="center" bgcolor="#0F172A" style="background:#0F172A;border-radius:15px;' + F +
        'font-size:14px;font-weight:bold;color:#ffffff">' + r.priority + "</td></tr></table></td>" +
        '<td valign="top" style="padding:0 0 16px;' + F + 'font-size:15px;line-height:1.5;color:#0F172A"><strong>' + e(r.title) + "</strong><br>" +
        '<span style="font-size:14px;color:#475569">' + e(r.how) + "</span>" +
        (r.success || r.time ? '<br><span style="font-size:13px;color:#64748B">' + (r.success ? "Done when: " + e(r.success) : "") +
          (r.success && r.time ? " &middot; " : "") + (r.time ? "Effort: " + e(r.time) : "") + "</span>" : "") + "</td></tr>";
    }).join("");
    var body = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F2ED" style="background:#F5F2ED">' +
      '<tr><td align="center" style="padding:24px 12px">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px">' +
      // header band
      '<tr><td bgcolor="#0F172A" style="background:#0F172A;padding:20px 28px;border-bottom:4px solid #10B981;border-radius:10px 10px 0 0;' + F + '">' +
      '<span style="font-size:15px;font-weight:bold;color:#ffffff;letter-spacing:.5px"><span style="color:#10B981">&#10022;</span> PRISM - SPARK</span>' +
      '<span style="font-size:13px;color:#94A3B8"> &nbsp;by Optivus</span></td></tr>' +
      // greeting
      '<tr><td style="padding:26px 28px 6px;' + F + 'font-size:16px;line-height:1.55;color:#0F172A">Hi ' + e(firstName || "there") + ",<br><br>" +
      "Here is your SPARK assessment for <strong>" + e(ideaName) + "</strong>.</td></tr>" +
      // verdict card
      '<tr><td style="padding:14px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      '<tr><td bgcolor="' + soft + '" style="background:' + soft + ";border-left:6px solid " + ink + ';border-radius:8px;padding:18px 20px;' + F + '">' +
      '<div style="font-size:46px;font-weight:bold;line-height:1;color:' + ink + '">' + result.rating +
      '<span style="font-size:18px;color:#64748B;font-weight:normal">/100</span>' +
      '<span style="font-size:12px;color:#475569;font-weight:bold;letter-spacing:1px"> &nbsp;SPARK RATING</span></div>' +
      '<div style="font-size:22px;font-weight:bold;color:' + ink + ';padding-top:10px">' + e(v.label) + (v.code === "test" ? ": " + e(lowerFirst(v.headline)) : "") + "</div>" +
      '<div style="font-size:15px;color:#0F172A;padding-top:6px">Recommended action: <strong>' + e(v.action) + "</strong></div>" +
      '<div style="font-size:14px;line-height:1.5;color:#334155;padding-top:8px">' + e(rep.why) + "</div></td></tr></table></td></tr>" +
      // stats
      '<tr><td style="padding:6px 22px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0"><tr>' +
      stat(t.core_passed, "/" + t.core_total, "Core stages passed") + stat(t.passed, "/" + t.scored_total, "Stages passed") +
      stat(t.failed, "", "Stages failed", t.failed > 0) + "</tr></table></td></tr>" +
      // main button
      (opts.reportUrl ? '<tr><td style="padding:18px 28px 4px">' + button("View your full report") +
        '<div style="' + F + 'font-size:13px;color:#64748B;padding-top:6px">Opens on optivusprof.ca with the charts, the complete action plan and every stage.</div></td></tr>' : "") +
      // next steps
      (steps ? '<tr><td style="padding:22px 28px 4px;' + F + 'font-size:18px;font-weight:bold;color:#0F172A">Your next three steps</td></tr>' +
        '<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + steps + "</table></td></tr>" : "") +
      (opts.pdfAttached ? '<tr><td style="padding:4px 28px 0;' + F + 'font-size:14px;color:#334155">A PDF copy of the full report is attached, ready to save or print.</td></tr>' : "") +
      (opts.reportUrl && steps ? '<tr><td style="padding:16px 28px 6px">' + button("See the complete action plan") + "</td></tr>" : "") +
      '<tr><td style="padding:6px 28px 24px">' + (footerHtml || "") + "</td></tr>" +
      "</table></td></tr></table>";
    return toEntities(body);
  }

  // ------------------------------------------------------------------- PDF report
  /* A small PDF writer, so the downloaded and emailed report looks like the on-screen one. It runs the same way in the
   * browser and in Apps Script: no libraries and no DOM. Letter pages, Helvetica (built into every PDF reader), and
   * vector shapes for the dial, tiles, cards and charts, so it stays sharp at any zoom and the text can be selected.
   * The whole file is plain ASCII, so its length in characters is its length in bytes. */
  var PDF_W = 612, PDF_H = 792, PDF_M = 40, PDF_BOTTOM = 52;
  // Helvetica and Helvetica-Bold advance widths (1/1000 em) for characters 32 to 126.
  var HELV_W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
    556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667,
    778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
    500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var HELVB_W = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
    556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667,
    778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
    556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  // Unicode characters that WinAnsiEncoding places in 128-159. Latin-1 (160-255) maps to itself.
  var PDF_WIN = { 8364: 128, 8218: 130, 8222: 132, 8230: 133, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149,
                  8211: 150, 8212: 151, 8482: 153 };

  function pdfCodes(s) {  // a string as WinAnsi codes; anything the fonts can't show becomes "?"
    var out = [];
    s = String(s == null ? "" : s);
    for (var i = 0; i < s.length; i++) {
      var n = s.charCodeAt(i);
      if (n >= 0xDC00 && n <= 0xDFFF) continue;              // second half of a pair: the first half became "?"
      if (n >= 32 && n <= 126) out.push(n);
      else if (n >= 160 && n <= 255) out.push(n);
      else if (PDF_WIN[n]) out.push(PDF_WIN[n]);
      else out.push(n === 9 || n === 10 || n === 13 ? 32 : 63);
    }
    return out;
  }
  function pdfCharW(code, bold) {
    if (code >= 32 && code <= 126) return (bold ? HELVB_W : HELV_W)[code - 32];
    if (code === 133 || code === 151) return 1000;
    if (code === 149) return 350;
    if (code === 145 || code === 146) return bold ? 278 : 222;
    if (code === 147 || code === 148) return bold ? 500 : 333;
    if (code === 160 || code === 183) return 278;
    return 556;
  }
  function pdfTextW(s, size, bold, spacing) {
    var codes = pdfCodes(s), w = 0;
    for (var i = 0; i < codes.length; i++) w += pdfCharW(codes[i], bold);
    return w * size / 1000 + (spacing || 0) * codes.length;
  }
  function pdfStr(s) {
    var codes = pdfCodes(s), out = "";
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      if (c === 40 || c === 41 || c === 92) out += "\\" + String.fromCharCode(c);
      else if (c > 126) out += "\\" + ("00" + c.toString(8)).slice(-3);
      else out += String.fromCharCode(c);
    }
    return "(" + out + ")";
  }
  function pdfNum(v) { var r = Math.round(v * 100) / 100; return String(r === 0 ? 0 : r); }
  function pdfRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255].map(function (c) { return String(Math.round(c / 255 * 1000) / 1000); }).join(" ");
  }

  /* Drawing surface. Coordinates are in points from the TOP-left of the page; text y is the baseline. */
  function PdfCanvas() { this.pages = []; this.newPage(); }
  PdfCanvas.prototype = {
    newPage: function () { this.ops = []; this.links = []; this.pages.push({ ops: this.ops, links: this.links }); },
    p: function (x, y) { return pdfNum(x) + " " + pdfNum(PDF_H - y); },
    rect: function (x, y, w, h, hex) {
      this.ops.push(pdfRgb(hex) + " rg " + pdfNum(x) + " " + pdfNum(PDF_H - y - h) + " " + pdfNum(w) + " " + pdfNum(h) + " re f");
    },
    rrectPath: function (x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      var k = 0.5523 * r, x1 = x + w, y1 = y + h, me = this;
      function c(ax, ay, bx, by, cx, cy) { return me.p(ax, ay) + " " + me.p(bx, by) + " " + me.p(cx, cy) + " c"; }
      return this.p(x + r, y) + " m " + this.p(x1 - r, y) + " l " + c(x1 - r + k, y, x1, y + r - k, x1, y + r) + " " +
        this.p(x1, y1 - r) + " l " + c(x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1) + " " + this.p(x + r, y1) + " l " +
        c(x + r - k, y1, x, y1 - r + k, x, y1 - r) + " " + this.p(x, y + r) + " l " + c(x, y + r - k, x + r - k, y, x + r, y) + " h";
    },
    rrect: function (x, y, w, h, r, hex) { this.ops.push(pdfRgb(hex) + " rg " + this.rrectPath(x, y, w, h, r) + " f"); },
    rrectStroke: function (x, y, w, h, r, hex, lw) {
      this.ops.push(pdfRgb(hex) + " RG " + pdfNum(lw) + " w " + this.rrectPath(x, y, w, h, r) + " S");
    },
    line: function (x1, y1, x2, y2, hex, lw, round) {
      this.ops.push(pdfRgb(hex) + " RG " + pdfNum(lw) + " w " + (round ? 1 : 0) + " J " + this.p(x1, y1) + " m " + this.p(x2, y2) + " l S");
    },
    arcPath: function (cx, cy, r, a0, a1, move) {  // math angles (0 = right, PI/2 = up)
      var parts = [], n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2))), d = (a1 - a0) / n, me = this;
      function pt(a, rad) { return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)]; }
      if (move) parts.push(this.p.apply(this, pt(a0, r)) + " m");
      for (var i = 0; i < n; i++) {
        var t0 = a0 + i * d, t1 = t0 + d, k = 4 / 3 * Math.tan(d / 4) * r;
        var p0 = pt(t0, r), p3 = pt(t1, r);
        var p1 = [p0[0] - k * Math.sin(t0), p0[1] - k * Math.cos(t0)], p2 = [p3[0] + k * Math.sin(t1), p3[1] + k * Math.cos(t1)];
        parts.push(me.p(p1[0], p1[1]) + " " + me.p(p2[0], p2[1]) + " " + me.p(p3[0], p3[1]) + " c");
      }
      return parts.join(" ");
    },
    arc: function (cx, cy, r, a0, a1, hex, lw) {
      this.ops.push(pdfRgb(hex) + " RG " + pdfNum(lw) + " w 0 J " + this.arcPath(cx, cy, r, a0, a1, true) + " S");
    },
    circle: function (cx, cy, r, hex) { this.ops.push(pdfRgb(hex) + " rg " + this.arcPath(cx, cy, r, 0, 2 * Math.PI, true) + " h f"); },
    circleStroke: function (cx, cy, r, hex, lw) {
      this.ops.push(pdfRgb(hex) + " RG " + pdfNum(lw) + " w " + this.arcPath(cx, cy, r, 0, 2 * Math.PI, true) + " h S");
    },
    halfDisc: function (cx, cy, r, hex) {  // the left half, for the "not yet proven" icon
      this.ops.push(pdfRgb(hex) + " rg " + this.arcPath(cx, cy, r, Math.PI / 2, 3 * Math.PI / 2, true) + " h f");
    },
    poly: function (pts, hex) {
      var me = this;
      this.ops.push(pdfRgb(hex) + " rg " + pts.map(function (q, i) { return me.p(q[0], q[1]) + (i ? " l" : " m"); }).join(" ") + " h f");
    },
    polyline: function (pts, hex, lw) {
      var me = this;
      this.ops.push(pdfRgb(hex) + " RG " + pdfNum(lw) + " w 1 J 1 j " +
        pts.map(function (q, i) { return me.p(q[0], q[1]) + (i ? " l" : " m"); }).join(" ") + " S");
    },
    text: function (x, y, s, size, bold, hex, spacing) {
      if (s === "" || s == null) return;
      this.ops.push("BT /" + (bold ? "F2" : "F1") + " " + pdfNum(size) + " Tf " + pdfRgb(hex) + " rg " + pdfNum(spacing || 0) + " Tc " +
        this.p(x, y) + " Td " + pdfStr(s) + " Tj ET");
    },
    link: function (x, y, w, h, url) { this.links.push([x, PDF_H - y - h, x + w, PDF_H - y, url]); },
    build: function (title, producer) {
      var objs = [];
      function add(s) { objs.push(s); return objs.length; }
      function ref(n) { return n + " 0 R"; }
      var catalog = add(""), pagesId = add("");
      var font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      var font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      var kids = [];
      this.pages.forEach(function (pg) {
        var content = pg.ops.join("\n");
        var contentId = add("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
        var annots = pg.links.map(function (l) {
          return add("<< /Type /Annot /Subtype /Link /Rect [" + l.slice(0, 4).map(pdfNum).join(" ") + "] /Border [0 0 0] " +
                     "/A << /S /URI /URI " + pdfStr(l[4]) + " >> >>");
        });
        kids.push(add("<< /Type /Page /Parent " + ref(pagesId) + " /MediaBox [0 0 " + PDF_W + " " + PDF_H + "] " +
          "/Resources << /Font << /F1 " + ref(font1) + " /F2 " + ref(font2) + " >> >> /Contents " + ref(contentId) +
          (annots.length ? " /Annots [" + annots.map(ref).join(" ") + "]" : "") + " >>"));
      });
      objs[catalog - 1] = "<< /Type /Catalog /Pages " + ref(pagesId) + " >>";
      objs[pagesId - 1] = "<< /Type /Pages /Kids [" + kids.map(ref).join(" ") + "] /Count " + kids.length + " >>";
      var info = add("<< /Title " + pdfStr(title) + " /Producer " + pdfStr(producer) + " /Creator " + pdfStr(producer) + " >>");
      var out = "%PDF-1.4\n", offsets = [];
      objs.forEach(function (o, i) { offsets.push(out.length); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
      var xref = out.length;
      out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
      offsets.forEach(function (o) { out += ("0000000000" + o).slice(-10) + " 00000 n \n"; });
      return out + "trailer\n<< /Size " + (objs.length + 1) + " /Root " + ref(catalog) + " /Info " + ref(info) + " >>\nstartxref\n" +
        xref + "\n%%EOF\n";
    }
  };

  /* Word-wraps styled runs ([{t, b: bold, c: colour}]) into lines of positioned parts. */
  function pdfWrap(runs, size, width) {
    var lines = [], parts = [], w = 0, space = null;
    function flush() { lines.push({ parts: parts, w: w }); parts = []; w = 0; space = null; }
    function place(tok, run, sw) {
      var tw = pdfTextW(tok, size, run.b), last = parts[parts.length - 1];
      if (last && last.b === run.b && last.c === run.c) last.t += (sw ? " " : "") + tok;
      else parts.push({ t: (sw ? " " : "") + tok, b: run.b, c: run.c, x: w });
      w += sw + tw;
    }
    runs.forEach(function (run) {
      String(run.t == null ? "" : run.t).split(/(\s+)/).forEach(function (tok) {
        if (!tok) return;
        if (/^\s+$/.test(tok)) { if (parts.length) space = run; return; }
        var sw = space ? pdfTextW(" ", size, space.b) : 0;
        if (parts.length && w + sw + pdfTextW(tok, size, run.b) > width) { flush(); sw = 0; }
        while (!parts.length && tok.length > 1 && pdfTextW(tok, size, run.b) > width) {   // a word longer than the line
          var cut = tok.length - 1;
          while (cut > 1 && pdfTextW(tok.slice(0, cut), size, run.b) > width) cut--;
          place(tok.slice(0, cut), run, 0); flush(); tok = tok.slice(cut);
        }
        place(tok, run, sw);
        space = null;
      });
    });
    if (parts.length) flush();
    return lines;
  }
  function pdfDrawLines(cv, lines, x, y, size, lh, align, width) {
    lines.forEach(function (ln, i) {
      var off = align === "right" ? width - ln.w : align === "center" ? (width - ln.w) / 2 : 0;
      var base = y + i * lh + (lh + size * 0.7) / 2;
      ln.parts.forEach(function (part) { cv.text(x + off + part.x, base, part.t, size, part.b, part.c); });
    });
    return y + lines.length * lh;
  }

  /* The full report as a PDF (same content and look as reportHtml). Returns the file as a string of byte values.
   * opts: { appName, appVersion, date, reportUrl } */
  function reportPdf(bank, result, ideaName, opts) {
    opts = opts || {};
    var rep = result.report, v = result.verdict, mix = rep.evidence_mix, tl = result.tiles, th = bank.thresholds, recs = rep.recommendations;
    var cv = new PdfCanvas(), M = PDF_M, W = PDF_W - 2 * PDF_M, L = { y: 0 };
    var C = { ink: "#0F172A", sec: "#475569", muted: "#64748B", rule: "#E2D9C8", off: "#F5F2ED", em: "#10B981", deep: "#065F46",
              pale: "#D1FAE5", red: "#DC2626", redInk: "#B91C1C", amber: "#F59E0B", amberInk: "#92400E", amberNum: "#B45309",
              slate: "#94A3B8", white: "#FFFFFF", light: "#CBD5E1", track: "#F5F2ED" };
    var ratingInk = { red: C.redInk, yellow: C.amberNum, green: C.deep }[result.zone];
    var labelInk = { red: C.redInk, yellow: C.amberInk, green: C.deep }[result.zone];
    var statusInk = { passed: C.deep, complete: C.deep, failed: C.redInk, unproven: C.amberInk, in_progress: C.amberInk, not_started: C.muted };
    var DOT = " " + String.fromCharCode(183) + " ";
    var DASH = String.fromCharCode(8211);
    function R(t, b, c) { return { t: t, b: !!b, c: c || C.ink }; }
    function wrap(runs, size, width) { return pdfWrap(typeof runs === "string" ? [R(runs)] : runs, size, width); }
    function ensure(h) {
      if (L.y + h <= PDF_H - PDF_BOTTOM) return false;
      cv.newPage(); L.y = PDF_M;
      return true;
    }
    function icon(kind, x, y, s, hex) {  // the status symbols, drawn in an s x s box
      if (kind === "passed" || kind === "complete" || kind === "green") {
        cv.polyline([[x + s * 0.12, y + s * 0.55], [x + s * 0.4, y + s * 0.82], [x + s * 0.9, y + s * 0.2]], hex, s * 0.17);
      } else if (kind === "failed" || kind === "red") {
        cv.line(x + s * 0.18, y + s * 0.18, x + s * 0.82, y + s * 0.82, hex, s * 0.17, true);
        cv.line(x + s * 0.82, y + s * 0.18, x + s * 0.18, y + s * 0.82, hex, s * 0.17, true);
      } else if (kind === "unproven" || kind === "in_progress" || kind === "yellow") {
        cv.circleStroke(x + s / 2, y + s / 2, s * 0.4, hex, s * 0.12);
        cv.halfDisc(x + s / 2, y + s / 2, s * 0.4, hex);
      } else {
        cv.circleStroke(x + s / 2, y + s / 2, s * 0.4, hex, s * 0.12);
      }
    }
    function star(cx, cy, r, hex) {
      var pts = [];
      for (var i = 0; i < 8; i++) {
        var a = Math.PI / 2 - i * Math.PI / 4, rad = i % 2 ? r * 0.36 : r;
        pts.push([cx + rad * Math.cos(a), cy - rad * Math.sin(a)]);
      }
      cv.poly(pts, hex);
    }
    function key(items, x, y, width, size) {  // coloured squares with labels, centred, wrapping onto more lines
      var rows = [[]], rowW = [0], gap = 12;
      items.forEach(function (it) {
        var w = 6 + 4 + pdfTextW(it[1], size, false);
        var r = rows.length - 1;
        if (rows[r].length && rowW[r] + gap + w > width) { rows.push([]); rowW.push(0); r++; }
        rowW[r] += (rows[r].length ? gap : 0) + w; rows[r].push([it, w]);
      });
      rows.forEach(function (row, ri) {
        var cx = x + (width - rowW[ri]) / 2, base = y + ri * (size + 5) + size;
        row.forEach(function (cell) {
          cv.rect(cx, base - size * 0.72, 6, 6, cell[0][0]);
          cv.text(cx + 10, base, cell[0][1], size, false, cell[0][2] || cell[0][0]);
          cx += cell[1] + gap;
        });
      });
      return rows.length * (size + 5);
    }
    function pill(text, x, y) {
      var w = pdfTextW(text, 6.5, true, 0.4) + 8;
      cv.rrect(x, y, w, 10, 5, C.pale);
      cv.text(x + 4, y + 7.3, text, 6.5, true, C.deep, 0.4);
      return w;
    }
    function bullets(items, x, width, size, lh, colour) {  // returns {h, draw(y)}
      var wrapped = items.map(function (it) { return wrap(typeof it === "string" ? [R(it, false, colour)] : it, size, width - 11); });
      var h = 0;
      wrapped.forEach(function (ls) { h += ls.length * lh + 4; });
      return {
        h: h, items: wrapped,
        draw: function (y) {
          wrapped.forEach(function (ls) {
            cv.circle(x + 3, y + lh / 2 + 0.3, 1.5, colour || C.ink);
            pdfDrawLines(cv, ls, x + 11, y, size, lh);
            y += ls.length * lh + 4;
          });
          return y;
        }
      };
    }
    function section(title, lede, keep) {
      var ledeLines = lede ? wrap([R(lede, false, C.sec)], 10.5, W) : [];
      ensure(46 + ledeLines.length * 15 + (keep || 0));
      if (L.y > PDF_M + 1) { cv.line(M, L.y, M + W, L.y, C.rule, 0.75); L.y += 20; }
      cv.text(M, L.y + 15, title, 16.5, true, C.ink);
      L.y += 26;
      if (ledeLines.length) { pdfDrawLines(cv, ledeLines, M, L.y, 10.5, 15); L.y += ledeLines.length * 15 + 10; }
    }
    function subhead(title, size, keep) {
      ensure(size + 14 + (keep || 0));
      cv.text(M, L.y + size, title, size, true, C.ink);
      L.y += size + 10;
    }

    // ---- cover band
    var titleLines = wrap([R(ideaName, true, C.white)], 26, W);
    var coverH = 96 + titleLines.length * 31;
    cv.rect(0, 0, PDF_W, coverH, C.ink);
    cv.rect(0, coverH, PDF_W, 4, C.em);
    star(M + 5, 37.5, 6, C.em);
    cv.text(M + 16, 41.5, "PRISM - SPARK", 10, true, C.white, 0.3);
    cv.text(M + 24 + pdfTextW("PRISM - SPARK", 10, true, 0.3), 41.5, "Startup Potential Assessment & Rating Kit", 10, false, C.slate);
    pdfDrawLines(cv, titleLines, M, 58, 26, 31);
    cv.text(M, 58 + titleLines.length * 31 + 20, "Idea assessment report" + DOT + (opts.date || "") + DOT + result.depth.label, 10.5, false, C.light);
    L.y = coverH + 4 + 26;

    // ---- verdict panel: dial on the left, rating and verdict on the right
    var top = L.y, dialW = 196, s = dialW / 320, cx = M + dialW / 2, cy = top + 160 * s, r = 120 * s;
    function ang(val) { return Math.PI - (val / 100) * Math.PI; }
    cv.arc(cx, cy, r, ang(0), ang(th.ratingRedMax + 0.5), C.red, 26 * s);
    cv.arc(cx, cy, r, ang(th.ratingRedMax + 0.5), ang(th.ratingYellowMax + 0.5), C.amber, 26 * s);
    cv.arc(cx, cy, r, ang(th.ratingYellowMax + 0.5), ang(100), C.em, 26 * s);
    var na = ang(Math.max(0, Math.min(100, result.rating))), nr = r - 18 * s;
    cv.line(cx, cy, cx + nr * Math.cos(na), cy - nr * Math.sin(na), C.ink, 6 * s, true);
    cv.circle(cx, cy, 9 * s, C.ink);
    cv.text(M + 22 * s, top + 180 * s, "0", 8, false, C.muted);
    cv.text(M + 298 * s - pdfTextW("100", 8, false), top + 180 * s, "100", 8, false, C.muted);
    var keyH = key([[C.red, "Not a good idea 0" + DASH + th.ratingRedMax], [C.amberNum, "Maybe " + (th.ratingRedMax + 1) + DASH + th.ratingYellowMax],
                    [C.deep, "Good idea " + (th.ratingYellowMax + 1) + DASH + "100"]], M, top + 188 * s, dialW, 8);
    var leftH = 188 * s + keyH;

    var rx = M + dialW + 24, rw = W - dialW - 24;
    var verdictText = v.label + (v.code === "test" ? ": " + lowerFirst(v.headline) : "");
    var verdictLines = wrap([R(verdictText, true, labelInk)], 17, rw - 22);
    var actionLines = wrap([R("Recommended action: "), R(v.action, true)], 11, rw);
    var whyLines = wrap([R(rep.why)], 10, rw - 28);
    var whyH = whyLines.length * 14 + 18;
    var rightH = 54 + verdictLines.length * 22 + 4 + actionLines.length * 15 + 10 + whyH;
    var ry = top + Math.max(0, (leftH - rightH) / 2);
    var num = String(result.rating);
    cv.text(rx, ry + 44, num, 50, true, ratingInk);
    var nx = rx + pdfTextW(num, 50, true) + 5;
    cv.text(nx, ry + 44, "/100", 17, false, C.muted);
    cv.text(nx + pdfTextW("/100", 17, false) + 10, ry + 44, "SPARK RATING", 9, true, C.sec, 0.9);
    ry += 54;
    icon(result.zone, rx, ry + 4, 14, labelInk);
    pdfDrawLines(cv, verdictLines, rx + 21, ry, 17, 22);
    ry += verdictLines.length * 22 + 4;
    pdfDrawLines(cv, actionLines, rx, ry, 11, 15);
    ry += actionLines.length * 15 + 10;
    cv.rrect(rx, ry, rw, whyH, 6, C.off);
    cv.rect(rx, ry, 3.5, whyH, C.em);
    pdfDrawLines(cv, whyLines, rx + 16, ry + 9, 10, 14);
    L.y = top + Math.max(leftH, rightH) + 22;

    // ---- at a glance
    var tileGap = 8, tileW = (W - 4 * tileGap) / 5, tileH = 62;
    [[tl.core_passed, "/" + tl.core_total, "Core stages passed"], [tl.passed, "/" + tl.scored_total, "Stages passed"],
     [tl.failed, "", "Stages failed", tl.failed > 0], [mix.observed_or_better_pct, "%", "Answers backed by real behaviour"],
     [result.progress.pct, "%", "Of the assessment completed"]].forEach(function (tile, i) {
      var x = M + i * (tileW + tileGap), n = String(tile[0]);
      cv.rrect(x, L.y, tileW, tileH, 8, C.off);
      cv.text(x + 11, L.y + 25, n, 19, true, tile[3] ? C.redInk : C.ink);
      if (tile[1]) cv.text(x + 12 + pdfTextW(n, 19, true), L.y + 25, tile[1], 10, true, C.muted);
      pdfDrawLines(cv, wrap([R(tile[2], false, C.sec)], 8.5, tileW - 20), x + 11, L.y + 33, 8.5, 10.5);
    });
    L.y += tileH + 26;

    // ---- action plan
    var lede = v.code === "proceed" ? "The evidence supports the idea. These steps strengthen it and move you to launch planning."
      : v.code === "abandon" ? "As it stands, this idea can't meet the goals you set. Resolve the first item before investing more."
      : v.code === "change" ? "The evidence contradicts the idea in at least one place. Start with what counts against it."
      : "These are the steps most likely to change the verdict, in the order to do them.";
    section("Your action plan", lede, 90);
    recs.slice(0, 3).forEach(function (rec) {
      var x = M, bodyX = x + 54, bodyW = W - 54 - 16;
      var tLines = wrap([R(rec.title, true)], 12.5, bodyW);
      var whyL = wrap([R("Why: ", true), R(rec.why, false, C.ink)], 9.5, bodyW);
      var howL = wrap([R("How: ", true), R(rec.how, false, C.ink)], 9.5, bodyW);
      var meta = [];
      if (rec.success) meta.push(R("Done when: ", true, C.sec), R(rec.success, false, C.sec));
      if (rec.time) meta.push(R((rec.success ? DOT : "") + "Effort: ", true, C.sec), R(rec.time, false, C.sec));
      var metaL = meta.length ? wrap(meta, 9, bodyW) : [];
      var h = 14 + tLines.length * 16 + 4 + whyL.length * 13.5 + 3 + howL.length * 13.5 + (metaL.length ? 6 + metaL.length * 12.5 : 0) + 14;
      ensure(h + 10);
      var edge = rec.kind === "rethink" || rec.kind === "resolve" ? C.red : C.em, y = L.y;
      cv.rrect(x, y, W, h, 9, edge);
      cv.rrect(x + 4.5, y, W - 4.5, h, 9, C.white);
      cv.rect(x + 4.5, y + 0.6, 9, h - 1.2, C.white);
      cv.rrectStroke(x, y, W, h, 9, C.rule, 0.75);
      cv.rect(x, y + 6, 4.5, h - 12, edge);
      cv.circle(x + 31, y + 27, 13, C.ink);
      var pn = String(rec.priority);
      cv.text(x + 31 - pdfTextW(pn, 12, true) / 2, y + 31.3, pn, 12, true, C.white);
      var yy = y + 14;
      pdfDrawLines(cv, tLines, bodyX, yy, 12.5, 16); yy += tLines.length * 16 + 4;
      pdfDrawLines(cv, whyL, bodyX, yy, 9.5, 13.5); yy += whyL.length * 13.5 + 3;
      pdfDrawLines(cv, howL, bodyX, yy, 9.5, 13.5); yy += howL.length * 13.5;
      if (metaL.length) pdfDrawLines(cv, metaL, bodyX, yy + 6, 9, 12.5);
      L.y += h + 10;
    });

    // tables: header row, then rows that never split across pages (the header repeats on a new page)
    function table(cols, rows, size) {
      var pad = 6;
      function header() {
        var x = M;
        cols.forEach(function (c) { cv.text(x + pad, L.y + 12, c.label.toUpperCase(), 7.5, true, C.muted, 0.6); x += c.w; });
        L.y += 18;
        cv.line(M, L.y, M + W, L.y, C.slate, 1);
      }
      ensure(18 + 30);
      header();
      rows.forEach(function (cells) {
        var measured = cells.map(function (cell, i) {
          var inner = cols[i].w - 2 * pad - (cell.icon ? 13 : 0), h = 0;
          var blocks = (cell.blocks || []).map(function (b) {
            var ls = wrap(b.runs, b.size || size, inner); h += ls.length * (b.lh || size * 1.4); return { lines: ls, size: b.size || size, lh: b.lh || size * 1.4 };
          });
          if (cell.pill) h += 13;
          return { blocks: blocks, h: h, cell: cell };
        });
        var rowH = Math.max.apply(null, measured.map(function (m) { return m.h; })) + 2 * pad;
        if (ensure(rowH)) header();
        var x = M;
        measured.forEach(function (m, i) {
          var yy = L.y + pad, tx = x + pad;
          if (m.cell.icon) { icon(m.cell.icon, tx, yy + 2.5, 9, m.cell.iconColour); tx += 13; }
          m.blocks.forEach(function (b) { pdfDrawLines(cv, b.lines, tx, yy, b.size, b.lh); yy += b.lines.length * b.lh; });
          if (m.cell.pill) pill(m.cell.pill, tx, yy + 2);
          x += cols[i].w;
        });
        L.y += rowH;
        cv.line(M, L.y, M + W, L.y, C.rule, 0.6);
      });
      L.y += 14;
    }

    if (recs.length > 3) {
      subhead("The rest of the plan", 12, 60);
      table([{ label: "#", w: 24 }, { label: "Step", w: 226 }, { label: "Stage", w: 100 }, { label: "Done when", w: 118 }, { label: "Effort", w: 72 }],
        recs.slice(3).map(function (rec) {
          return [{ blocks: [{ runs: [R(String(rec.priority))] }] },
                  { blocks: [{ runs: [R(rec.title, true)] }, { runs: [R(rec.how, false, C.muted)], size: 8.5, lh: 12 }] },
                  { blocks: [{ runs: [R(rec.stage_short)] }], pill: rec.core ? "CORE" : "" },
                  { blocks: [{ runs: [R(rec.success || "")] }] },
                  { blocks: [{ runs: [R(rec.time || "")] }] }];
        }), 9);
    }

    // ---- where the idea stands: stage bars
    var scored = result.stages.filter(function (st) { return st.scored; });
    var sc = W / 680, labelW = 200 * sc, barW = 330 * sc, rowH = 28, chartTop = 22;
    var chartH = chartTop + scored.length * rowH + 6;
    section("Where the idea stands", "Each bar is a stage's score out of 100, coloured by its status. Core stages, marked with a dot, decide the verdict.", chartH + 30);
    var y0 = L.y;
    [0, 50, 100].forEach(function (val) {
      var gx = M + labelW + barW * val / 100;
      cv.line(gx, y0 + chartTop - 6, gx, y0 + chartH - 4, C.rule, 0.75);
      cv.text(gx - pdfTextW(String(val), 8, false) / 2, y0 + 12, String(val), 8, false, C.muted);
    });
    scored.forEach(function (st, i) {
      var y = y0 + chartTop + i * rowH, label = st.id + ". " + st.short, bold = !!st.core;
      var lw = pdfTextW(label, 9.5, bold) + (st.core ? 9 : 0);
      cv.text(M + labelW - 8 - lw, y + 15, label, 9.5, bold, C.ink);
      if (st.core) cv.circle(M + labelW - 10.5, y + 11.6, 2.4, C.ink);
      cv.rrect(M + labelW, y + 5, barW, 14, 2.5, C.track);
      if (st.score == null) { cv.text(M + labelW + 7, y + 15.5, "No answers yet", 8.5, false, C.muted); return; }
      var bw = Math.max(2, barW * st.score / 100), fill = STATUS_FILL[st.status] || "#CBD5E1";
      cv.rrect(M + labelW, y + 5, bw, 14, 2.5, fill);
      cv.text(M + labelW + barW + 7, y + 15.5, st.score + DOT + st.status_label, 9, false, C.ink);
    });
    L.y = y0 + chartH + 4;
    L.y += key([[C.em, "Passed"], [C.amber, "Not yet proven", C.amberNum], [C.red, "Failed"]], M, L.y, W, 8.5) + 6;
    cv.circle(M + W / 2 - 22, L.y + 3.3, 2.2, C.muted);
    cv.text(M + W / 2 - 17, L.y + 6.5, "core stage", 8.5, false, C.muted);
    L.y += 22;

    // ---- how strong is the evidence
    var untestedPct = 0, againstN = 0;
    mix.levels.forEach(function (l) { if (l.key === "untested") untestedPct = l.pct; if (l.key === "against") againstN = l.count; });
    var mixText = mix.total ? mix.observed_or_better_pct + "% of your " + mix.total + " scored answers rest on what people actually did, committed or measured. " +
      untestedPct + "% are still untested or opinion." + (againstN ? " " + againstN + " answer" + (againstN === 1 ? " counts" : "s count") + " against the idea." : "")
      : "No scored answers yet.";
    var mixLines = wrap([R(mixText, false, C.sec)], 10.5, W);
    var legendRows = Math.ceil(mix.levels.length / 2);
    var evH = 16 + 10 + mixLines.length * 15 + 10 + 30 + 14 + legendRows * 19 + 30;
    ensure(evH);
    L.y += 6;
    cv.text(M, L.y + 15, "How strong is the evidence?", 16.5, true, C.ink);
    L.y += 26;
    pdfDrawLines(cv, mixLines, M, L.y, 10.5, 15); L.y += mixLines.length * 15 + 10;
    if (!mix.total) {
      cv.rrect(M, L.y, W, 28, 4, C.track);
      cv.text(M + W / 2 - pdfTextW("No scored answers yet", 10, false) / 2, L.y + 18, "No scored answers yet", 10, false, C.muted);
    } else {
      var bx = M;
      cv.rrect(M, L.y, W, 28, 4, C.track);
      mix.levels.forEach(function (l) {
        if (!l.count) return;
        var segW = W * l.count / mix.total;
        cv.rect(bx, L.y, segW, 28, EVIDENCE_FILL[l.key]);
        if (segW >= 30) {
          var lbl = l.pct + "%";
          cv.text(bx + segW / 2 - pdfTextW(lbl, 9.5, true) / 2, L.y + 17.5, lbl, 9.5, true, EVIDENCE_TEXT[l.key]);
        }
        bx += segW;
      });
    }
    L.y += 28 + 14;
    mix.levels.forEach(function (l, i) {
      var lx = M + (i % 2) * (W / 2), ly = L.y + Math.floor(i / 2) * 19;
      cv.rrect(lx, ly, 10, 10, 2, EVIDENCE_FILL[l.key]);
      cv.text(lx + 16, ly + 8.8, l.label + ": " + l.count + " (" + l.pct + "%)", 9.5, false, C.ink);
    });
    L.y += legendRows * 19 + 4;
    var noteLines = wrap([R("Evidence levels follow the framework's rule: opinion is not evidence, what people do beats what they say, and commitments " +
      "of money, time or reputation are strongest.", false, C.muted)], 9, W);
    pdfDrawLines(cv, noteLines, M, L.y, 9, 12.5); L.y += noteLines.length * 12.5 + 16;

    // ---- what the answers say: three columns
    var colGap = 10, colW = (W - 2 * colGap) / 3;
    function listOf(items, empty) {
      return items.length ? items.map(function (f) { return [R(f.text + (f.knockout ? " (knockout)" : ""), false, C.ink)]; }) : null;
    }
    var cols = [["Supports the idea", "passed", C.em, listOf(rep.supports), "No strong support yet."],
                ["Counts against it", "failed", C.red, listOf(rep.against), "No evidence against the idea so far."],
                ["Still untested", "?", C.amber, listOf(rep.untested), "Nothing marked untested."]].map(function (c, i) {
      var b = c[3] ? bullets(c[3], M + i * (colW + colGap) + 12, colW - 24, 9, 12.5, C.ink) : null;
      var emptyL = c[3] ? [] : wrap([R(c[4], false, C.muted)], 9, colW - 24);
      var extra = c[1] === "?" && rep.untested_more ? 14 : 0;
      return { c: c, b: b, emptyL: emptyL, h: 16 + 22 + (b ? b.h : emptyL.length * 12.5) + extra + 10 };
    });
    var colsH = Math.max.apply(null, cols.map(function (c) { return c.h; }));
    section("What the answers say", "", colsH + 10);
    cols.forEach(function (col, i) {
      var x = M + i * (colW + colGap), y = L.y;
      cv.rrect(x, y, colW, colsH, 9, col.c[2]);
      cv.rrect(x, y + 4, colW, colsH - 4, 9, C.off);
      cv.rect(x, y + 4, colW, 10, C.off);
      if (col.c[1] === "?") cv.text(x + 12, y + 27, "?", 11, true, C.amberInk);
      else icon(col.c[1], x + 11, y + 18, 10, col.c[1] === "passed" ? C.deep : C.redInk);
      cv.text(x + 26, y + 27, col.c[0], 10.5, true, C.ink);
      var yy = y + 38;
      if (col.b) yy = col.b.draw(yy);
      else { pdfDrawLines(cv, col.emptyL, x + 12, yy, 9, 12.5); yy += col.emptyL.length * 12.5; }
      if (col.c[1] === "?" && rep.untested_more) cv.text(x + 12, yy + 9, "And " + rep.untested_more + " more.", 9, false, C.muted);
    });
    L.y += colsH + 18;
    if (rep.change.length) {
      var ch = bullets(rep.change.map(function (c) { return c.text; }), M, W, 10, 14, C.ink);
      subhead("What would change the verdict", 12.5, Math.min(ch.h, 120));
      ensure(ch.h);
      L.y = ch.draw(L.y) + 10;
    }

    // ---- stage by stage
    section("Stage by stage", "", 60);
    table([{ label: "Stage", w: 150 }, { label: "Status", w: 98 }, { label: "Score", w: 44 }, { label: "Reason", w: 248 }],
      result.stages.map(function (st) {
        return [{ blocks: [{ runs: [R(st.id + ". " + st.short, true)] }], pill: st.core ? "CORE" : "" },
                { blocks: [{ runs: [R(st.status_label, true, statusInk[st.status] || C.sec)] }], icon: st.status, iconColour: statusInk[st.status] || C.sec },
                { blocks: [{ runs: [R(st.score != null ? String(st.score) : DASH)] }] },
                { blocks: [{ runs: [R(st.reason)] }] }];
      }), 9);

    // ---- method, link and footer band
    var m1 = wrap([R("SPARK applies the Entrepreneur's Idea Validation Framework: 124 questions across 16 stages, from defining the idea to making " +
      "the decision. Each scored stage has gate questions that set the minimum evidence needed to pass. A stage fails only on evidence against " +
      "the idea, never on missing evidence. The verdict comes from fixed rules: the five core stages (problem, customer, validation, solution and " +
      "willingness to pay) must pass for a \"Good idea\". The same answers always produce the same report, and no AI is used.", false, C.sec)], 9.5, W);
    var m2 = wrap([R("Answer scales are built on published research and practice, including Fitzpatrick's The Mom Test, Blank's customer development, " +
      "Guest, Bunce & Johnson (2006) on interview saturation, Camuffo et al. (2020) on hypothesis-driven entrepreneurship, Skok's SaaS " +
      "unit-economics benchmarks, Helmer's 7 Powers and Azoulay et al. (2020) on founder experience.", false, C.sec)], 9.5, W);
    section("How this assessment works", "", (m1.length + m2.length) * 13.5 + 70);
    pdfDrawLines(cv, m1, M, L.y, 9.5, 13.5); L.y += m1.length * 13.5 + 7;
    pdfDrawLines(cv, m2, M, L.y, 9.5, 13.5); L.y += m2.length * 13.5 + 12;
    if (opts.reportUrl) {
      var lead = "View this report online, with the interactive charts: ", linkText = "open your SPARK report";
      var lx = M + pdfTextW(lead, 9.5, false);
      cv.text(M, L.y + 10, lead, 9.5, false, C.sec);
      cv.text(lx, L.y + 10, linkText, 9.5, true, C.deep);
      cv.line(lx, L.y + 12, lx + pdfTextW(linkText, 9.5, true), L.y + 12, C.deep, 0.6);
      cv.link(lx, L.y, pdfTextW(linkText, 9.5, true), 14, opts.reportUrl);
      L.y += 24;
    }
    ensure(30);
    cv.rect(M, L.y, W, 3, C.em);
    cv.rect(M, L.y + 3, W, 24, C.ink);
    cv.text(M + 12, L.y + 18.5, (opts.appName || "PRISM - SPARK") + " v" + (opts.appVersion || "") + DOT + "question bank " + result.bank_version +
            DOT + "generated " + (opts.date || "") + DOT + "Optivus" + DOT + "optivusprof.ca", 8, false, C.slate);

    // ---- page footers
    var total = cv.pages.length, short = ideaName.length > 60 ? ideaName.slice(0, 57) + "..." : ideaName;
    cv.pages.forEach(function (pg, i) {
      cv.ops = pg.ops;
      cv.text(M, PDF_H - 24, "PRISM - SPARK" + DOT + short, 8, false, C.muted);
      var pgText = "Page " + (i + 1) + " of " + total;
      cv.text(M + W - pdfTextW(pgText, 8, false), PDF_H - 24, pgText, 8, false, C.muted);
    });
    return cv.build("SPARK report - " + ideaName, (opts.appName || "PRISM - SPARK") + " v" + (opts.appVersion || ""));
  }

  return {
    STATUS_LABELS: STATUS_LABELS, STATUS_ICONS: STATUS_ICONS, VERDICTS: VERDICTS, SECONDS_PER_QUESTION: SECONDS_PER_QUESTION,
    makeBank: makeBank, normalize: normalize, hiddenIds: hiddenIds, isAnswered: isAnswered,
    applyAnswer: applyAnswer, markStageUntested: markStageUntested, reconcile: reconcile,
    remainingInStage: remainingInStage, quickRemaining: quickRemaining, stageComplete: stageComplete, progress: progress,
    scoreStage: scoreStage, score: score, lowerFirst: lowerFirst, escapeHtml: escapeHtml,
    stageBars: stageBars, evidenceBar: evidenceBar, dial: dial, reportHtml: reportHtml, emailHtml: emailHtml, reportPdf: reportPdf,
    packAnswers: packAnswers, unpackAnswers: unpackAnswers
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SparkCore;
