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

  /* Short, inline-styled email body (email clients strip <style> and SVG, so the full report is attached). */
  function emailHtml(result, firstName, ideaName, footerHtml) {
    var e = escapeHtml, v = result.verdict;
    var colour = { red: "#B91C1C", yellow: "#92400E", green: "#065F46" }[result.zone];
    var steps = result.report.recommendations.slice(0, 3).map(function (r) {
      return '<li style="margin:0 0 10px"><strong>' + e(r.title) + '</strong><br><span style="color:#475569">' + e(r.how) + "</span></li>";
    }).join("");
    var body = '<div style="font-family:Aptos,Segoe UI,Arial,sans-serif;color:#0F172A;max-width:600px;line-height:1.5">' +
      '<div style="background:#0F172A;color:#fff;padding:18px 22px;border-bottom:3px solid #10B981"><strong style="color:#10B981">✦</strong> ' +
      "<strong>PRISM - SPARK</strong> · Startup Potential Assessment</div>" +
      '<div style="padding:20px 22px;background:#fff">' +
      "<p>Hi " + e(firstName || "there") + ",</p><p>Here is your SPARK report for <strong>" + e(ideaName) + "</strong>.</p>" +
      '<p style="font-size:30px;font-weight:800;color:' + colour + ';margin:8px 0">' + result.rating + '<span style="font-size:15px;color:#64748B">/100</span> ' +
      e(v.label) + (v.code === "test" ? ": " + e(lowerFirst(v.headline)) : "") + "</p>" +
      "<p>Recommended action: <strong>" + e(v.action) + "</strong>. " + e(result.report.why) + "</p>" +
      (steps ? '<p style="margin-top:18px"><strong>Your next three steps</strong></p><ol style="padding-left:20px">' + steps + "</ol>" : "") +
      '<p style="background:#D1FAE5;padding:10px 12px;border-radius:6px">Your full report, with charts and the complete action plan, is attached. ' +
      "Open it in any web browser, and print or save it as a PDF from there.</p>" + (footerHtml || "") + "</div></div>";
    // Email clients don't always honour the character set, so every non-ASCII character becomes an HTML entity.
    return body.replace(/[\u0080-\uFFFF]/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; });
  }

  return {
    STATUS_LABELS: STATUS_LABELS, STATUS_ICONS: STATUS_ICONS, VERDICTS: VERDICTS, SECONDS_PER_QUESTION: SECONDS_PER_QUESTION,
    makeBank: makeBank, normalize: normalize, hiddenIds: hiddenIds, isAnswered: isAnswered,
    applyAnswer: applyAnswer, markStageUntested: markStageUntested, reconcile: reconcile,
    remainingInStage: remainingInStage, quickRemaining: quickRemaining, stageComplete: stageComplete, progress: progress,
    scoreStage: scoreStage, score: score, lowerFirst: lowerFirst, escapeHtml: escapeHtml,
    stageBars: stageBars, evidenceBar: evidenceBar, dial: dial, reportHtml: reportHtml, emailHtml: emailHtml
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SparkCore;
