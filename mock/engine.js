// SiteFlow mock – logic. Plain-JS port of src/lib/{dates,engine,extract-rules,minutes,templates,messages}.ts
// so the mock behaves like the real app in offline (rule-based) mode. You rarely need to touch this file.

(function () {
  const { PROJECT, TEAMS, PERSONAS, MILESTONES, SETTINGS, CONTACTS } = SF;

  // ------------------------------------------------------------------ dates
  function dayToDate(day) {
    const d = new Date(`${PROJECT.planStart}T12:00:00Z`);
    let added = 0;
    const step = day >= 0 ? 1 : -1;
    while (added !== day) {
      d.setUTCDate(d.getUTCDate() + step);
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) added += step;
    }
    return d;
  }
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayLabel = (day) => { const d = dayToDate(day); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`; };
  const dayShort = (day) => { const d = dayToDate(day); return { wd: WD[d.getUTCDay()], date: `${d.getUTCDate()}.${d.getUTCMonth() + 1}.` }; };
  const dayDE = (day) => { const d = dayToDate(day); return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`; };
  const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  // ------------------------------------------------------------------ engine
  const effectiveDuration = (t) => Math.max(1, t.duration + t.delayDays);

  function topoOrder(tasks) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const indeg = new Map();
    tasks.forEach((t) => indeg.set(t.id, t.predecessors.filter((p) => byId.has(p)).length));
    const queue = tasks.filter((t) => indeg.get(t.id) === 0);
    const out = [];
    const seen = new Set();
    while (queue.length) {
      const t = queue.shift();
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
      tasks.filter((s) => s.predecessors.includes(t.id)).forEach((s) => {
        indeg.set(s.id, (indeg.get(s.id) ?? 1) - 1);
        if (indeg.get(s.id) === 0) queue.push(s);
      });
    }
    tasks.forEach((t) => !seen.has(t.id) && out.push(t));
    return out;
  }

  function schedule(tasks) {
    const s = {};
    for (const t of topoOrder(tasks)) {
      const predFinish = Math.max(-1, ...t.predecessors.map((p) => s[p]?.ef ?? -1));
      const es = Math.max(t.plannedStart, predFinish + 1);
      s[t.id] = { es, ef: es + effectiveDuration(t) - 1 };
    }
    return s;
  }

  function milestoneSlips(tasks, sched) {
    return MILESTONES.map((m) => {
      const t = tasks.find((x) => x.milestone === m.id);
      const finish = t ? sched[t.id]?.ef ?? m.targetDay : m.targetDay;
      return { milestone: m, finish, slip: Math.max(0, finish - m.targetDay) };
    });
  }

  function successorsMap(tasks) {
    const m = new Map();
    tasks.forEach((t) => m.set(t.id, []));
    tasks.forEach((t) => t.predecessors.forEach((p) => m.get(p)?.push(t.id)));
    return m;
  }

  function downstream(tasks, id) {
    const succ = successorsMap(tasks);
    const out = [];
    const stack = [...(succ.get(id) ?? [])];
    while (stack.length) {
      const x = stack.pop();
      if (out.includes(x)) continue;
      out.push(x);
      stack.push(...(succ.get(x) ?? []));
    }
    return out;
  }

  function slackToMilestone(tasks, sched, id) {
    const slacks = [id, ...downstream(tasks, id)]
      .map((x) => tasks.find((t) => t.id === x))
      .filter((t) => t && t.milestone)
      .map((t) => MILESTONES.find((m) => m.id === t.milestone).targetDay - sched[t.id].ef);
    return slacks.length ? Math.min(...slacks) : 99;
  }

  const teamName = (team) => PERSONAS.find((p) => p.team === team)?.company ?? team;

  function computeImpact(before, after, sourceId) {
    const s0 = schedule(before);
    const s1 = schedule(after);
    const changed = after.filter((t) => t.id !== sourceId).filter((t) => s0[t.id] && (s0[t.id].es !== s1[t.id].es || s0[t.id].ef !== s1[t.id].ef)).map((t) => t.id);
    const source = after.find((t) => t.id === sourceId);
    const teams = Array.from(new Set(changed.map((id) => after.find((t) => t.id === id).team).filter((tm) => tm !== source?.team)));
    const notify = Array.from(new Set(["site-manager", ...teams]));
    return { changedTaskIds: changed, affectedTeams: teams, notify, slipsBefore: milestoneSlips(before, s0), slipsAfter: milestoneSlips(after, s1) };
  }

  function preventiveScan(tasks, today) {
    const sched = schedule(tasks);
    const alerts = [];
    for (const t of tasks) {
      if (t.status === "done") continue;
      const start = sched[t.id].es;
      if (start < today || start > today + SETTINGS.preventiveHorizonDays) continue;
      for (const [k, item] of Object.entries(t.readiness)) {
        if (!item || item.state !== "open") continue;
        const due = item.dueDay ?? start - 1;
        const slack = slackToMilestone(tasks, sched, t.id);
        const score = (due - today) * 10 + Math.min(slack, 9);
        alerts.push({ taskId: t.id, key: k, note: item.note ?? `${k} not ready`, owner: item.owner ?? "Unassigned", dueDay: due, startDay: start, slack, score });
      }
    }
    return alerts.sort((a, b) => a.score - b.score).slice(0, SETTINGS.maxAlerts);
  }

  const withDelay = (tasks, taskId, delayDays) => tasks.map((t) => (t.id === taskId ? { ...t, delayDays: t.delayDays + delayDays, status: "blocked" } : t));

  function applyActions(tasks, actions) {
    return tasks.map((t) => {
      const a = actions.filter((x) => x.taskId === t.id);
      if (!a.length) return t;
      let next = { ...t };
      for (const act of a) {
        if (act.kind === "crash" && act.newDuration) next = { ...next, duration: act.newDuration, crew: next.crew + (act.extraCrew ?? 0) };
        if (act.kind === "pull-forward") next = { ...next, plannedStart: act.toDay };
      }
      return next;
    });
  }

  function teamWorkDays(tasks, sched, team) {
    const days = new Set();
    tasks.filter((t) => t.team === team && t.status !== "done").forEach((t) => { for (let d = sched[t.id].es; d <= sched[t.id].ef; d++) days.add(d); });
    return days;
  }
  const isReadyExceptPredecessor = (t) => Object.entries(t.readiness).every(([k, v]) => k === "predecessor" || !v || v.state === "cleared");
  function findPullForward(tasks, sched, team, day, exclude) {
    return tasks
      .filter((t) => t.team === team && t.status === "planned" && !exclude.has(t.id))
      .filter((t) => sched[t.id].es > day)
      .filter((t) => t.predecessors.every((p) => sched[p] && sched[p].ef < day))
      .filter(isReadyExceptPredecessor)
      .sort((a, b) => sched[a.id].es - sched[b.id].es)[0];
  }

  function proposeReplan(tasks, triggerTaskId, delayDays, today, stoppageStartHour = 10) {
    const delayed = withDelay(tasks, triggerTaskId, delayDays);
    const impact = computeImpact(tasks, delayed, triggerTaskId);
    const trigger = tasks.find((t) => t.id === triggerTaskId);
    const actions = [];
    const explanation = [];
    let current = delayed;

    const crashesPerDay = new Map();
    for (const slip of impact.slipsAfter.filter((s) => s.slip > 0)) {
      let remaining = slip.slip;
      const msTask = current.find((t) => t.milestone === slip.milestone.id);
      if (!msTask) continue;
      const chain = downstream(current, triggerTaskId).filter((id) => id === msTask.id || downstream(current, id).includes(msTask.id));
      const sched = schedule(current);
      const candidates = chain.map((id) => current.find((t) => t.id === id)).filter((t) => t.status === "planned" && t.minDuration && t.minDuration < t.duration).sort((a, b) => sched[a.id].es - sched[b.id].es);
      for (const c of candidates) {
        if (remaining <= 0) break;
        const day = schedule(current)[c.id].es;
        if ((crashesPerDay.get(day) ?? 0) >= SETTINGS.maxExtraCrewsPerDay) continue;
        const cut = Math.min(remaining, c.duration - (c.minDuration ?? c.duration));
        const act = { kind: "crash", taskId: c.id, team: c.team, fromDay: day, toDay: day, newDuration: c.duration - cut, extraCrew: 1,
          reason: `Add one extra crew to "${c.name} ${c.section}" (${c.duration} → ${c.duration - cut} day${c.duration - cut > 1 ? "s" : ""}) to recover ${cut} day${cut > 1 ? "s" : ""} on "${slip.milestone.name}".` };
        actions.push(act);
        crashesPerDay.set(day, (crashesPerDay.get(day) ?? 0) + 1);
        current = applyActions(current, [act]);
        remaining -= cut;
      }
    }

    const exclude = new Set([triggerTaskId, ...actions.map((a) => a.taskId)]);
    const hoursLeftToday = Math.max(0, Math.min(SETTINGS.hoursPerDay, 16 - stoppageStartHour));
    const pfToday = findPullForward(current, schedule(current), trigger.team, today, exclude);
    if (pfToday && hoursLeftToday > 0) {
      const hours = trigger.crew * hoursLeftToday;
      const act = { kind: "pull-forward", taskId: pfToday.id, team: pfToday.team, fromDay: schedule(current)[pfToday.id].es, toDay: today, idleHoursSaved: hours,
        reason: `${trigger.team === pfToday.team ? "Stopped crew" : "Crew"} moves to "${pfToday.name} ${pfToday.section}" for the rest of today: it is unblocked and fully ready. Saves about ${hours} idle crew-hours.` };
      actions.push(act);
      exclude.add(pfToday.id);
      current = applyActions(current, [act]);
    }
    const s0 = schedule(tasks);
    const sNow = schedule(current);
    for (const team of impact.affectedTeams) {
      const before = teamWorkDays(tasks, s0, team);
      const after = teamWorkDays(current, sNow, team);
      const idleDays = [...before].filter((d) => !after.has(d) && d >= today && d <= today + SETTINGS.preventiveHorizonDays).sort((a, b) => a - b);
      for (const day of idleDays) {
        const sched = schedule(current);
        if (teamWorkDays(current, sched, team).has(day)) continue;
        const pf = findPullForward(current, sched, team, day, exclude);
        if (!pf) continue;
        const hours = pf.crew * SETTINGS.hoursPerDay;
        const act = { kind: "pull-forward", taskId: pf.id, team, fromDay: sched[pf.id].es, toDay: day, idleHoursSaved: hours,
          reason: `"${pf.name} ${pf.section}" moves forward to fill the gap the delay leaves for ${teamName(team)}; its predecessors finish before then and it is fully ready. Saves about ${hours} idle crew-hours.` };
        actions.push(act);
        exclude.add(pf.id);
        current = applyActions(current, [act]);
      }
    }

    const slipsAfterReplan = milestoneSlips(current, schedule(current));
    const idleHoursSaved = actions.reduce((s, a) => s + (a.idleHoursSaved ?? 0), 0);
    const worst = impact.slipsAfter.filter((s) => s.slip > 0);
    explanation.push(`"${trigger.name} ${trigger.section}" is delayed by ${delayDays} day${delayDays > 1 ? "s" : ""}. ` +
      (impact.changedTaskIds.length ? `${impact.changedTaskIds.length} downstream task${impact.changedTaskIds.length > 1 ? "s" : ""} move, affecting ${impact.affectedTeams.map(teamName).join(", ") || "no other team"}.` : "No downstream task moves."));
    explanation.push(worst.length ? `Without action: ${worst.map((s) => `"${s.milestone.name}" slips ${s.slip} day${s.slip > 1 ? "s" : ""}`).join("; ")}.` : "Without action, no milestone slips (there is enough float).");
    const still = slipsAfterReplan.filter((s) => s.slip > 0);
    explanation.push(still.length ? `With this re-plan: ${still.map((s) => `"${s.milestone.name}" still slips ${s.slip} day${s.slip > 1 ? "s" : ""}`).join("; ")}.` : "With this re-plan, all milestones hold.");
    if (idleHoursSaved) explanation.push(`About ${idleHoursSaved} idle crew-hours avoided.`);
    explanation.push(`Limits respected: at most ${SETTINGS.maxExtraCrewsPerDay} extra crew per day, no overtime used.`);
    return { id: `RP-${Date.now().toString(36)}`, triggerTaskId, delayDays, stoppageHoursToday: hoursLeftToday, impact, actions, slipsAfterReplan, idleHoursSaved, explanation };
  }

  // ------------------------------------------------------------------ rule extractor
  const NUM_WORDS = { ein: 1, einen: 1, eine: 1, one: 1, a: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fünf: 5, five: 5, sechs: 6, six: 6 };
  const toNum = (w) => (/^\d+$/.test(w) ? parseInt(w, 10) : NUM_WORDS[w.toLowerCase()] ?? NaN);
  const has = (text, words) => words.some((w) => text.includes(w));
  const WHO_RULES = [
    ["rebar", ["kraus", "bewehrung", "rebar"]],
    ["formwork", ["weber", "schalung", "formwork"]],
    ["earthworks", ["huber", "erdbau", "earthworks", "bagger", "excavat"]],
    ["concrete", ["schmid", "betonbau", "concrete"]],
    ["client", ["bauherr", "client", "auftraggeber", "roth"]],
    ["supplier", ["lieferant", "supplier", "müller", "mueller", "stahlhandel"]],
  ];
  const whoFromText = (text) => WHO_RULES.find(([, w]) => has(text.toLowerCase(), w))?.[0];

  function locationFromText(raw) {
    const t = raw.toLowerCase();
    const parts = [];
    const building = t.match(/(?:haus|building|gebäude)\s+([a-z0-9]+)/);
    if (building) parts.push(`Building ${building[1].toUpperCase()}`);
    const sec = t.match(/(?:abschnitt|section|bauteil)\s+([a-z])\b/);
    if (sec) parts.push(`Section ${sec[1].toUpperCase()}`);
    const ordinal = { erste: "1", ersten: "1", erstes: "1", first: "1", zweite: "2", zweiten: "2", zweites: "2", second: "2", dritte: "3", dritten: "3", drittes: "3", third: "3" };
    const floorWord = t.match(/(erste[sn]?|zweite[sn]?|dritte[sn]?|first|second|third)\s+(?:og|obergeschoss|etage|stock|floor)/);
    const floorNum = t.match(/(\d)\.?\s*(?:og|obergeschoss|etage|stock|floor)\b/) || t.match(/floor\s+(\d)/);
    if (floorWord) parts.push(`Floor ${ordinal[floorWord[1]] ?? floorWord[1]}`);
    else if (floorNum) parts.push(`Floor ${floorNum[1]}`);
    else if (/\b(eg|erdgeschoss|ground floor)\b/.test(t)) parts.push("Ground floor");
    if (/\b(keller|basement|untergeschoss|ug)\b/.test(t)) parts.push("Basement");
    const room = t.match(/(?:raum|room|zimmer)\s+([a-z0-9.]+)/);
    if (room) parts.push(`Room ${room[1].toUpperCase()}`);
    if (/\b(treppe|stairs|treppenhaus|stairwell)\b/.test(t)) parts.push("Stairs");
    return parts.length ? parts.join(", ") : undefined;
  }

  function delayFromText(raw) {
    const m = raw.toLowerCase().match(/(\d+|ein(?:en|e)?|one|zwei|two|drei|three|vier|four|fünf|five)\s+(?:arbeits)?(?:tage?n?|days?)\s+(?:später|spaeter|late|later|verspätet|verzug|delay|verzögerung)/);
    if (!m) return undefined;
    const n = toNum(m[1]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  function overrideFromText(raw, today) {
    const t = raw.toLowerCase();
    const steps = [];
    const m = t.match(/(?:in|nach|after)\s+(\d+|ein(?:em|en)?|one|zwei|two|drei|three|vier|four|sechs|six)\s+(monate?n?|months?|wochen?|weeks?|tage?n?|days?)/);
    const wantsReminder = /(erneut|wieder|nochmal|erinner|ansprechen|remind|bring (?:it )?up|follow up|check again)/.test(t);
    if (m && wantsReminder) {
      const n = toNum(m[1]);
      const days = /mon/.test(m[2]) ? n * 21 : /woch|week/.test(m[2]) ? n * 5 : n;
      steps.push({ kind: "remind", text: `Bring this up again (${m[0]})`, who: "site-manager", dueDay: today + days, source: "user" });
    }
    const suppressAi = /(nichts tun|nichts unternehmen|don'?t do anything|do nothing|keine maßnahmen|no action)/.test(t) || steps.length > 0;
    return { steps, suppressAi };
  }

  const TYPE_RULES = [
    ["stoppage", ["steht", "stillstand", "idle", "blockiert", "blocked", "stopped", "gestoppt", "kann nicht", "cannot", "can't", "behinder", "warten auf", "waiting for"]],
    ["defect", ["riss", "mangel", "mängel", "nacharbeit", "defect", "crack", "rework", "beschädig", "damage", "undicht", "leak", "gebrochen", "broken", "kaputt"]],
    ["delivery", ["lieferung", "geliefert", "delivery", "delivered", "angekommen", "arrived", "lkw", "truck"]],
    ["incident", ["unfall", "verletz", "accident", "injur", "beinahe", "near miss", "erste hilfe"]],
    ["meeting", ["besprechung", "meeting", "protokoll", "baubesprechung", "jour fixe", "minutes"]],
    ["instruction", ["anordnung", "angewiesen", "instruct", "bauherr will", "client wants", "änderung", "zusätzlich", "additional work"]],
    ["attendance", ["mann vor ort", "leute vor ort", "workers on site", "anwesend", "headcount", "attendance"]],
    ["progress", ["fertig", "erledigt", "abgeschlossen", "done", "finished", "completed", "begonnen", "started", "% "]],
  ];
  const TEAM_WORDS = [
    ["earthworks", ["bagger", "aushub", "excavat", "erdbau", "verfüll", "backfill", "schotter", "gravel"]],
    ["formwork", ["schalung", "formwork", "geschalt"]],
    ["rebar", ["bewehrung", "stahl", "rebar", "eisen", "steel"]],
    ["concrete", ["beton", "betonage", "pour", "concrete", "gießen"]],
  ];
  const RESPONSIBLE_RULES = [
    ["Client (Bauherr)", ["bauherr", "client", "leitungsplan", "planunterlagen", "pläne fehlen", "drawings missing", "utility plan", "auftraggeber"]],
    ["Supplier", ["lieferant", "supplier", "falscher durchmesser", "wrong diameter", "lieferung"]],
    ["Weather", ["regen", "frost", "sturm", "wind", "rain", "storm", "snow", "schnee"]],
  ];

  function extractWithRules(raw, tasks, personaTeam, today = 0) {
    const text = raw.toLowerCase();
    const delay = delayFromText(raw);
    let type = TYPE_RULES.find(([, words]) => has(text, words))?.[0] ?? "note";
    if (type === "note" && delay) type = "progress";
    const team = TEAM_WORDS.find(([, words]) => has(text, words))?.[0] ?? personaTeam;
    const section = text.match(/(?:abschnitt|section|bauteil)\s+([a-z])\b/)?.[1]?.toUpperCase();
    let candidates = tasks.filter((t) => (team ? t.team === team : true));
    if (section) { const s = candidates.filter((t) => t.section === section); if (s.length) candidates = s; }
    const hint = [["wand", "wall"], ["decke", "slab"], ["fundament", "foundation"]].find((pair) => has(text, pair));
    if (hint) { const h = candidates.filter((t) => has(t.name.toLowerCase(), [hint[1]])); if (h.length) candidates = h; }
    const task = team || section ? candidates[0] : undefined;
    const fields = {};
    if (task) fields.taskId = task.id;
    const time = text.match(/(?:seit|since|ab|from|um|at)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|am|pm|h)?/);
    if (time) {
      let h = parseInt(time[1], 10);
      if (/pm/.test(time[0]) && h < 12) h += 12;
      fields.startTime = `${String(h).padStart(2, "0")}:${time[2] ?? "00"}`;
    }
    const causeMatch = raw.match(/(?:weil|wegen|da |because|due to|,)\s*(.+)$/i);
    if (["stoppage", "defect", "delivery"].includes(type)) fields.cause = causeMatch ? causeMatch[1].trim().replace(/\.$/, "") : undefined;
    const responsible = RESPONSIBLE_RULES.find(([, words]) => has(text, words))?.[0];
    if (responsible) fields.responsibleParty = responsible;
    if (type === "defect") {
      const sub = text.match(/(?:durch|by)\s+([a-zäöüß]+\s+[a-zäöüß]+)/);
      if (sub) fields.responsibleParty = sub[1].replace(/\b\w/g, (c) => c.toUpperCase());
      fields.location = section ? `Section ${section}` : undefined;
    }
    if (type === "delivery") {
      const qty = raw.match(/(\d+[.,]?\d*)\s*(t|tonnen|tons|m³|m3|stück|pcs)/i);
      if (qty) fields.quantity = qty[0];
      fields.material = has(text, ["stahl", "steel", "bewehrung"]) ? "Rebar steel" : has(text, ["beton", "concrete"]) ? "Concrete" : undefined;
    }
    if (delay) fields.estimatedDelayDays = delay;
    const location = locationFromText(raw);
    const missing = [];
    if (!location && ["stoppage", "defect", "delivery", "incident"].includes(type)) missing.push("location");
    if (type === "stoppage") {
      if (!fields.responsibleParty) missing.push("responsibleParty");
      if (!fields.estimatedDelayDays) missing.push("estimatedDelayDays");
    }
    if (!fields.taskId && type === "stoppage") missing.push("taskId");
    const followUpQuestion = type === "stoppage"
      ? !fields.responsibleParty ? "Who is responsible for the stoppage, and how long will it last?" : "How long do you expect the stoppage to last?"
      : missing.includes("taskId") ? "Which task does this concern?" : undefined;
    const label = { stoppage: "Stoppage", delivery: "Delivery", defect: "Defect", incident: "Incident", meeting: "Meeting", attendance: "Attendance", progress: "Progress", instruction: "Instruction", note: "Note" };
    const clean = raw.trim().replace(/\s+/g, " ");
    const summary = `${label[type]}${task ? ` – ${task.name} ${task.section}` : ""}: ${clean.length > 120 ? clean.slice(0, 117) + "…" : clean}`;
    const state = clean.split(/(?<=[.!?])\s/)[0];
    return {
      type, summary, fields, missing,
      followUpQuestion: followUpQuestion ?? (missing.includes("location") ? "Where exactly is this (building, floor, room or section)?" : undefined),
      engine: "rules", location, state, nextSteps: suggestSteps(type, raw, fields, task, today),
    };
  }

  function suggestSteps(type, raw, fields, task, today) {
    const override = overrideFromText(raw, today);
    if (override.suppressAi) return override.steps;
    const teamWho = task?.team;
    const respWho = fields.responsibleParty ? whoFromText(String(fields.responsibleParty)) : undefined;
    const who = respWho ?? whoFromText(raw);
    const s = (kind, text, w, dueDay) => ({ kind, text, who: w, dueDay, source: "rules" });
    const steps = [];
    const what = task ? `${task.name} ${task.section}` : "the affected work";
    switch (type) {
      case "stoppage":
        if (who && who !== teamWho) {
          steps.push(s("contact", `Stoppage on ${what}: ${fields.cause ?? "see log"}. Please help resolve it.`, who));
          if (teamWho) steps.push(s("notify", `${what} is on hold until this is resolved.`, teamWho));
        } else steps.push(s("notify", `Stoppage on ${what}: ${fields.cause ?? "see log"}.`, who ?? teamWho));
        steps.push(s("task", `Resolve stoppage on ${what}`, "site-manager", today));
        if (who === "client") steps.push(s("other", "Check if an obstruction notice (Behinderungsanzeige) is needed", "site-manager", today));
        break;
      case "defect":
        steps.push(s("task", `Repair defect: ${fields.cause ?? raw.slice(0, 60)}`, who ?? teamWho, today + 3));
        steps.push(s("notify", `Defect found on ${what}. Please repair and confirm.`, who ?? teamWho));
        break;
      case "delivery":
        steps.push(s("contact", `Delivery problem: ${fields.cause ?? "see log"}. Please arrange replacement.`, "supplier"));
        steps.push(s("notify", `Delivery for ${what} is affected.`, teamWho));
        break;
      case "incident":
        steps.push(s("task", "Document incident and inform safety officer", "site-manager", today));
        break;
      case "instruction":
        steps.push(s("other", "Check if an additional cost notice (Mehrkostenanzeige) is needed", "site-manager", today));
        break;
      default:
        if (fields.estimatedDelayDays) steps.push(s("task", `Decide on plan change: ${what} +${fields.estimatedDelayDays} day(s)`, "site-manager", today));
    }
    return steps;
  }

  // ------------------------------------------------------------------ AI fill of next steps (who + when)
  /** Due date said in the dictation: "heute", "morgen", "bis Donnerstag", "in 3 Tagen", "01.12.2026". */
  function dueHint(raw, today) {
    const t = raw.toLowerCase();
    if (/(heute|today|sofort|asap|immediately|gleich)/.test(t)) return today;
    if (/(übermorgen|day after tomorrow)/.test(t)) return today + 2;
    if (/(morgen|tomorrow)/.test(t)) return today + 1;
    const n = t.match(/in\s+(\d+|ein(?:em|en)?|one|zwei|two|drei|three|vier|four|fünf|five)\s+(?:arbeits)?(?:tage?n?|days?)/);
    if (n && !/(später|late|later)/.test(t)) return today + toNum(n[1]);
    return dueFromText(raw, today);
  }

  /** Fill who + dueDay on every step the speaker did not set: routing by task team, cause and kind. Marks them source "ai". */
  function fillSteps(draft, raw, today, tasks) {
    const task = tasks.find((t) => t.id === draft.fields.taskId);
    const hint = dueHint(raw, today);
    const byKind = { contact: today, notify: today, task: today + 1, remind: today + 5, other: today + 1 };
    draft.nextSteps = (draft.nextSteps ?? []).map((st) => {
      if (st.source === "user") return st;
      const who = st.who ?? (st.kind === "remind" || st.kind === "other" ? "site-manager" : task?.team ?? whoFromText(raw) ?? "site-manager");
      const dueDay = st.dueDay ?? hint ?? byKind[st.kind] ?? today;
      return { ...st, who, dueDay, source: "ai" };
    });
    return draft;
  }

  // ------------------------------------------------------------------ minutes
  const WEEKDAYS = [[0, ["montag", "monday"]], [1, ["dienstag", "tuesday"]], [2, ["mittwoch", "wednesday"]], [3, ["donnerstag", "thursday"]], [4, ["freitag", "friday"]]];
  function dueFromText(raw, today) {
    const t = raw.toLowerCase();
    const date = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})?/);
    if (date) {
      const start = new Date(`${PROJECT.planStart}T12:00:00Z`);
      const d = new Date(Date.UTC(Number(date[3] ?? start.getUTCFullYear()), Number(date[2]) - 1, Number(date[1]), 12));
      if (d < start) return undefined;
      let n = 0;
      const cur = new Date(start);
      while (cur < d) { cur.setUTCDate(cur.getUTCDate() + 1); const wd = cur.getUTCDay(); if (wd !== 0 && wd !== 6) n++; }
      return n;
    }
    const wd = WEEKDAYS.find(([, w]) => w.some((x) => t.includes(x)))?.[0];
    if (wd === undefined) return undefined;
    for (let d = today; d < today + 10; d++) if (d % 5 === wd) return d;
    return undefined;
  }
  function splitMinutes(raw) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items = lines.filter((l) => /^(\d+[.)]|[-•*–])\s+/.test(l));
    const chosen = items.length ? items : lines.filter((l) => !/(teilnehmer|participants|protokoll|^baubesprechung)/i.test(l));
    return chosen.map((l) => l.replace(/^(\d+[.)]|[-•*–])\s+/, "").trim()).filter((l) => l.length > 3);
  }
  function minutesWithRules(raw, tasks, today) {
    return splitMinutes(raw).map((line) => {
      const r = extractWithRules(line, tasks, undefined, today);
      const due = dueFromText(line, today);
      const isNextMeeting = /(nächste|next)\s+(bau)?besprechung|next meeting/i.test(line);
      const who = /(bauleitung|hauptbau|herr bauer)\s+(stimmt|klärt|prüft|kümmert|organisiert|informiert|lädt)/i.test(line) ? "site-manager" : (whoFromText(line) ?? (/(bauleitung|hauptbau)/i.test(line) ? "site-manager" : undefined));
      const step = isNextMeeting
        ? { kind: "remind", text: line, who: "site-manager", dueDay: due, source: "user" }
        : { kind: "task", text: line.replace(/\.$/, ""), who: who ?? "site-manager", dueDay: due, source: "user" };
      return { text: line, type: isNextMeeting ? "meeting" : r.type === "note" ? "meeting" : r.type, summary: line.length > 110 ? `${line.slice(0, 107)}…` : line,
        location: locationFromText(line) ?? r.location, state: `Agreed in the site meeting: ${line}`, taskId: r.fields.taskId, nextSteps: [step] };
    });
  }

  // ------------------------------------------------------------------ templates (VOB/B)
  const NOTICE_LABEL = {
    behinderung: "Obstruction notice (Behinderungsanzeige, § 6 Abs. 1 VOB/B)",
    mehrkosten: "Additional cost notice (Mehrkostenanzeige, § 2 Abs. 5/6 VOB/B)",
    bedenken: "Notice of concern (Bedenkenanzeige, § 4 Abs. 3 VOB/B)",
    maengel: "Defect notice (Mängelanzeige)",
    anforderung: "Request (Anforderung)",
    tagesbericht: "Daily site report (Bautagesbericht)",
  };
  const DISCLAIMER = "ENTWURF – Formulierungshilfe, keine Rechtsberatung. Inhalt und Fristen vor Versand durch die Bauleitung prüfen.";
  const ph = (v, label) => (v === undefined || v === "" ? `[${label} ergänzen]` : String(v));
  const signature = () => `Mit freundlichen Grüßen\n\n${PERSONAS[0].name}\nBauleitung, ${PROJECT.contractor}`;
  const header = (to, day, subject) => `${PROJECT.contractor} · Bauleitung\n\nAn: ${to}\n\nBauvorhaben: ${PROJECT.name}, ${PROJECT.address}\nDatum: ${dayDE(day)}\n\nBetreff: ${subject}\n\nSehr geehrte Damen und Herren,`;
  const teamCompany = (t) => (t ? TEAMS.find((x) => x.id === t.team)?.company ?? t.team : undefined);
  const taskLabel = (t) => (t ? `${t.name}, Abschnitt ${t.section}` : undefined);
  const photoFindings = (e) => (e.photoNotes?.length ? `\nFotobefund (automatisch erkannt, bitte prüfen): ${e.photoNotes.join(" · ")}` : "");
  const newId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const nowIso = () => new Date().toISOString();
  const doc = (p) => ({ id: newId("N"), status: "draft", createdAt: nowIso(), ...p });

  function draftBehinderung(entry, task, impact, day, allTasks = []) {
    const f = entry.fields;
    const follow = impact?.changedTaskIds.length
      ? `Folgeleistungen betroffen: ${impact.changedTaskIds.map((id) => { const t = allTasks.find((x) => x.id === id); return t ? `${t.name} ${t.section} (${id})` : id; }).join(", ")}.`
      : "Folgeleistungen: derzeit keine Verschiebung erkennbar.";
    const slips = impact?.slipsAfter.filter((s) => s.slip > 0) ?? [];
    const ms = slips.length ? `Ohne Gegenmaßnahmen verschiebt sich der Meilenstein „${slips[0].milestone.name}“ um ${slips[0].slip} Arbeitstag(e).` : "";
    const clientCaused = /bauherr|client|auftraggeber/i.test(f.responsibleParty ?? "");
    const body = `${header(PROJECT.client, day, `Behinderungsanzeige gemäß § 6 Abs. 1 VOB/B – ${ph(taskLabel(task), "Leistung")}`)}

hiermit zeigen wir Ihnen gemäß § 6 Abs. 1 VOB/B an, dass wir in der ordnungsgemäßen Ausführung unserer Leistungen behindert sind.

Betroffene Leistung: ${ph(taskLabel(task), "Leistung")} (${ph(teamCompany(task), "ausführende Firma")})
Beginn der Behinderung: ${dayDE(entry.day)}, ${ph(f.startTime, "Uhrzeit")} Uhr
Art und Ursache der Behinderung: ${ph(f.cause, "Ursache")}
Verantwortlich nach unserer Kenntnis: ${ph(f.responsibleParty, "Verursacher")}
Voraussichtliche Auswirkung: ${f.estimatedDelayDays !== undefined ? `ca. ${f.estimatedDelayDays} Arbeitstag(e) Verzögerung der betroffenen Leistung` : "[Dauer ergänzen]"}. ${follow} ${ms}
Dokumentation: Bautagebucheintrag vom ${dayDE(entry.day)}, ${clock(entry.createdAt)} Uhr${entry.photos.length ? `, ${entry.photos.length} Foto(s)` : ""}.${photoFindings(entry)}

${clientCaused ? "Wir bitten Sie, die Behinderung umgehend zu beseitigen und uns die hierfür erforderlichen Unterlagen bzw. Mitwirkungshandlungen unverzüglich zur Verfügung zu stellen." : "Wir bitten Sie um Kenntnisnahme."} Wir setzen die Arbeiten unverzüglich fort, sobald die hindernden Umstände wegfallen (§ 6 Abs. 3 VOB/B), und ergreifen bis dahin zumutbare Maßnahmen zur Weiterführung der Arbeiten.

Wir behalten uns vor, eine Verlängerung der Ausführungsfristen (§ 6 Abs. 2 VOB/B) sowie die Erstattung der uns entstehenden Mehrkosten geltend zu machen.

${signature()}

${DISCLAIMER}`;
    return doc({ type: "behinderung", title: `Behinderungsanzeige – ${ph(taskLabel(task), "Leistung")}`, addressee: PROJECT.client, body, refs: [entry.id], mode: "reactive" });
  }

  function draftMaengel(entry, task, day) {
    const f = entry.fields;
    const isDelivery = entry.type === "delivery";
    const to = isDelivery ? ph(f.responsibleParty && !/supplier/i.test(f.responsibleParty) ? f.responsibleParty : "Lieferant (Stahlhandel Müller)", "Lieferant") : ph(f.responsibleParty ?? teamCompany(task), "verantwortliche Firma");
    const deadline = dayDE(day + 3);
    const docu = `Dokumentation: Bautagebucheintrag vom ${dayDE(entry.day)}, ${clock(entry.createdAt)} Uhr${entry.photos.length ? `, ${entry.photos.length} Foto(s)` : ""}.${photoFindings(entry)}`;
    const body = isDelivery
      ? `${header(to, day, `Mängelrüge zur Lieferung vom ${dayDE(entry.day)} – ${ph(f.material, "Material")}`)}

bei der Eingangskontrolle der heutigen Lieferung haben wir folgende Abweichung festgestellt:

Material / Menge: ${ph(f.material, "Material")}, ${ph(f.quantity, "Menge")}
Festgestellte Abweichung: ${ph(f.cause, "Abweichung")}
Verwendung: ${ph(taskLabel(task), "Leistung")}

Wir rügen diesen Mangel hiermit unverzüglich (§ 377 HGB) und bitten um mangelfreie Ersatzlieferung bis spätestens ${deadline}. Die beanstandete Ware halten wir zur Abholung bereit.
${docu}

${signature()}

${DISCLAIMER}`
      : `${header(to, day, `Mängelanzeige gemäß § 4 Abs. 7 VOB/B – ${ph(taskLabel(task), "Leistung")}`)}

bei der Kontrolle Ihrer Leistungen haben wir folgenden Mangel festgestellt:

Leistung: ${ph(taskLabel(task), "Leistung")}
Ort: ${ph(f.location, "Ort")}
Beschreibung: ${ph(f.cause ?? entry.summary, "Beschreibung")}
${docu}

Wir fordern Sie auf, den Mangel gemäß § 4 Abs. 7 VOB/B auf Ihre Kosten bis spätestens ${deadline} zu beseitigen und uns die Beseitigung schriftlich anzuzeigen. Nach fruchtlosem Fristablauf behalten wir uns weitere Schritte nach VOB/B vor.

${signature()}

${DISCLAIMER}`;
    return doc({ type: "maengel", title: isDelivery ? `Mängelrüge Lieferung – ${ph(f.material, "Material")}` : `Mängelanzeige – ${ph(taskLabel(task), "Leistung")}`, addressee: to, body, refs: [entry.id], mode: "reactive" });
  }

  function draftMehrkosten(entry, task, day) {
    const f = entry.fields;
    const body = `${header(PROJECT.client, day, `Ankündigung von Mehrkosten gemäß § 2 Abs. 5/6 VOB/B – ${ph(taskLabel(task), "Leistung")}`)}

am ${dayDE(entry.day)} wurde folgende Änderung bzw. zusätzliche Leistung angeordnet:

Anordnung: ${ph(f.cause ?? entry.summary, "Anordnung")}
Angeordnet durch: ${ph(f.responsibleParty, "Anordnende Person")}
Betroffene Leistung: ${ph(taskLabel(task), "Leistung")}

Diese Leistung ist im Vertrag nicht bzw. nicht in dieser Form vorgesehen. Wir kündigen hiermit gemäß § 2 Abs. 6 Nr. 1 VOB/B vor Ausführung unseren Anspruch auf besondere Vergütung an bzw. machen eine Preisanpassung nach § 2 Abs. 5 VOB/B geltend. Ein Nachtragsangebot reichen wir kurzfristig nach.

${signature()}

${DISCLAIMER}`;
    return doc({ type: "mehrkosten", title: `Mehrkostenanzeige – ${ph(taskLabel(task), "Leistung")}`, addressee: PROJECT.client, body, refs: [entry.id], mode: "reactive" });
  }

  function draftBedenken(entry, task, day) {
    const f = entry.fields;
    const body = `${header(PROJECT.client, day, `Bedenkenanzeige gemäß § 4 Abs. 3 VOB/B – ${ph(taskLabel(task), "Leistung")}`)}

gemäß § 4 Abs. 3 VOB/B teilen wir Ihnen unsere Bedenken gegen die vorgesehene Art der Ausführung bzw. die vorgegebenen Stoffe oder Vorleistungen mit:

Betroffene Leistung: ${ph(taskLabel(task), "Leistung")}
Bedenken: ${ph(f.cause ?? entry.summary, "Bedenken")}
Mögliche Folgen: [Folgen ergänzen]

Wir bitten um Ihre Entscheidung bis ${dayDE(day + 2)}. Bis dahin führen wir die betroffenen Arbeiten nicht aus.

${signature()}

${DISCLAIMER}`;
    return doc({ type: "bedenken", title: `Bedenkenanzeige – ${ph(taskLabel(task), "Leistung")}`, addressee: PROJECT.client, body, refs: [entry.id], mode: "reactive" });
  }

  function draftAnforderung(alert, task, day) {
    const isClient = /client|bauherr/i.test(alert.owner);
    const to = isClient ? PROJECT.client : alert.owner;
    const subject = isClient ? `Anforderung von Ausführungsunterlagen gemäß § 3 Abs. 1 VOB/B – ${taskLabel(task)}` : `Bitte um Bestätigung – ${taskLabel(task)}`;
    const ask = isClient
      ? `Gemäß § 3 Abs. 1 VOB/B sind uns die für die Ausführung nötigen Unterlagen rechtzeitig zu übergeben. Wir bitten Sie daher, uns die fehlenden Unterlagen bis spätestens ${dayDE(alert.dueDay)} zu übermitteln. Andernfalls ist mit einer Behinderung der Arbeiten zu rechnen, die wir gemäß § 6 Abs. 1 VOB/B anzeigen würden.`
      : `Wir bitten Sie, uns den Liefertermin bis spätestens ${dayDE(alert.dueDay)} verbindlich zu bestätigen.`;
    const body = `${header(to, day, subject)}

für die am ${dayDE(alert.startDay)} geplante Leistung „${taskLabel(task)}“ fehlt derzeit:

${alert.note}

${ask}

${signature()}

${DISCLAIMER}`;
    return doc({ type: "anforderung", title: `${isClient ? "Anforderung Unterlagen" : "Bitte um Bestätigung"} – ${taskLabel(task)}`, addressee: to, body, refs: [task.id], mode: "preventive" });
  }

  function draftTagesbericht({ day, tasks, sched, entries, decisions, notices }) {
    const active = tasks.filter((t) => sched[t.id] && sched[t.id].es <= day && sched[t.id].ef >= day && t.status !== "done");
    const byTeam = TEAMS.map((tm) => ({ tm, list: active.filter((t) => t.team === tm.id) })).filter((x) => x.list.length);
    const todays = entries.filter((e) => e.day === day).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const dec = decisions.filter((d) => d.day === day);
    const docs = notices.filter((n) => n.type !== "tagesbericht");
    const prev = dec.filter((d) => d.kind === "preventive").length;
    const reac = dec.filter((d) => d.kind === "reactive").length;
    const lines = [
      `Bautagesbericht – ${PROJECT.name}`,
      `Datum: ${dayDE(day)}    Auftragnehmer: ${PROJECT.contractor}    Bauleitung: ${PERSONAS[0].name}`,
      `Wetter: [ergänzen]`, ``,
      `1. Personal und Leistungen`,
      ...byTeam.map(({ tm, list }) => `- ${tm.company}: ${list.reduce((s, t) => s + t.crew, 0)} Arbeitskräfte – ${list.map((t) => `${t.name} ${t.section}${t.status === "blocked" ? " (behindert)" : ""}`).join("; ")}`),
      ``, `2. Ereignisse (Bautagebuch)`,
      ...(todays.length ? todays.map((e) => `- ${clock(e.createdAt)} ${e.summary}${e.location ? ` (Ort: ${e.location})` : ""}${e.photos.length ? ` [${e.photos.length} Foto(s)]` : ""}`) : ["- keine Einträge"]),
      ``, `2a. Vereinbarte nächste Schritte`,
      ...(todays.some((e) => e.nextSteps?.length)
        ? todays.flatMap((e) => (e.nextSteps ?? []).map((st) => `- ${st.text}${st.who ? ` – ${CONTACTS.find((c) => c.id === st.who)?.name ?? st.who}` : ""}${st.dueDay !== undefined ? ` – bis ${dayDE(st.dueDay)}` : ""}`))
        : ["- keine"]),
      ``, `3. Planänderungen und Entscheidungen`,
      ...(dec.length ? dec.map((d) => `- ${clock(d.createdAt)} [${d.kind === "preventive" ? "präventiv" : d.kind === "reactive" ? "reaktiv" : "Änderung"}] ${d.text}`) : ["- keine"]),
      ``, `4. Schriftverkehr`,
      ...(docs.length ? docs.map((n) => `- ${n.title} an ${n.addressee} (${n.status === "approved" ? "freigegeben" : "Entwurf"})`) : ["- keiner"]),
      ``, `5. Kennzahlen`, `- Entscheidungen heute: ${prev} präventiv, ${reac} reaktiv`, ``,
      `Aufgestellt: ${PERSONAS[0].name}, Bauleitung`, ``, DISCLAIMER,
    ];
    return { id: newId("R"), type: "tagesbericht", title: `Bautagesbericht ${dayDE(day)}`, addressee: "Projektakte", body: lines.join("\n"), refs: todays.map((e) => e.id), status: "draft", createdAt: nowIso(), mode: "report" };
  }

  // ------------------------------------------------------------------ messages (people without the app)
  const first = (name) => (name.includes(" ") && !name.startsWith("Dr.") ? name.split(" ")[0] : name);
  const msgSig = () => `\n\nViele Grüße\n${PERSONAS[0].name}, Bauleitung ${PROJECT.contractor}\n${PROJECT.name}`;
  const draftMsg = (to, purpose, subject, body, entryId) => ({ id: newId("M"), createdAt: nowIso(), to, subject, body, purpose, entryId, status: "draft" });

  function applyNextSteps(entry, contacts) {
    const steps = entry.nextSteps ?? [];
    const todos = [];
    const messages = [];
    const where = entry.location ? ` (${entry.location})` : "";
    for (const st of steps) {
      const c = contacts.find((x) => x.id === st.who);
      const external = c && !c.usesApp;
      if (["task", "remind", "other"].includes(st.kind)) {
        todos.push({ id: newId("T"), createdAt: nowIso(), text: st.text, owner: st.who ?? "site-manager", dueDay: st.dueDay, entryId: entry.id, kind: st.kind === "remind" ? "remind" : st.kind === "task" ? "task" : "other", status: "open" });
        if (st.kind === "task" && external && !steps.some((o) => o !== st && (o.kind === "notify" || o.kind === "contact") && o.who === st.who)) {
          messages.push(draftMsg(c.id, "action", `Bitte erledigen: ${st.text}`, `Hallo ${first(c.name)},\n\nbitte folgendes erledigen${st.dueDay !== undefined ? ` bis ${dayDE(st.dueDay)}` : ""}${where}:\n„${st.source === "user" ? st.text : entry.transcript}“\n\nBitte kurz bestätigen.${msgSig()}`, entry.id));
        }
      }
      if ((st.kind === "notify" || st.kind === "contact") && c && c.id !== "site-manager" && c.id !== entry.author) {
        const action = st.kind === "contact" || steps.some((o) => o.kind === "task" && o.who === st.who);
        if (external) {
          const said = st.source === "user" ? st.text : entry.transcript;
          messages.push(draftMsg(c.id, action ? "action" : "fyi",
            action ? `Bitte um Rückmeldung: ${entry.location ?? entry.summary.slice(0, 50)}` : `Zur Info: ${entry.location ?? entry.summary.slice(0, 50)}`,
            `Hallo ${first(c.name)},\n\n${action ? "wir brauchen eure Unterstützung" : "zur Info"}${where}:\n„${said}“${entry.photos.length ? `\n(${entry.photos.length} Foto(s) in der Baudokumentation)` : ""}\n\n${action ? "Bitte kurz Rückmeldung, wie und bis wann ihr das löst." : "Kein Handlungsbedarf, nur damit ihr Bescheid wisst."}${msgSig()}`, entry.id));
        } else {
          todos.push({ id: newId("T"), createdAt: nowIso(), text: st.text, owner: c.id, dueDay: st.dueDay, entryId: entry.id, kind: "other", status: "open" });
        }
      }
    }
    return { todos, messages };
  }

  function changeMessages(before, after, taskId, reason, contacts) {
    const impact = computeImpact(before, after, taskId);
    const sched = schedule(after);
    const src = after.find((t) => t.id === taskId);
    const out = [];
    const srcC = contacts.find((c) => c.id === src.team);
    if (srcC && !srcC.usesApp) {
      out.push(draftMsg(srcC.id, "action", `Terminänderung bestätigt: ${src.name} ${src.section}`,
        `Hallo ${first(srcC.name)},\n\nwir haben die Verschiebung übernommen: ${src.name}, Abschnitt ${src.section} läuft jetzt ${dayDE(sched[src.id].es)} bis ${dayDE(sched[src.id].ef)}.\nGrund: ${reason}\n\nBitte haltet diesen Termin ein und meldet euch sofort, falls sich weiter etwas verschiebt.${msgSig()}`));
    }
    const byTeam = new Map();
    impact.changedTaskIds.forEach((id) => { const t = after.find((x) => x.id === id); if (t.team !== src.team) byTeam.set(t.team, [...(byTeam.get(t.team) ?? []), t]); });
    for (const [team, list] of byTeam) {
      const c = contacts.find((x) => x.id === team);
      if (!c || c.usesApp) continue;
      out.push(draftMsg(c.id, "fyi", `Zur Info: neue Termine für ${list.map((t) => `${t.name} ${t.section}`).join(", ")}`,
        `Hallo ${first(c.name)},\n\nzur Info: wegen einer Verschiebung bei ${src.name} ${src.section} ändern sich eure Termine:\n${list.map((t) => `- ${t.name}, Abschnitt ${t.section}: ${dayDE(sched[t.id].es)} bis ${dayDE(sched[t.id].ef)}`).join("\n")}\n\nKein Grund zur Eile – bitte Personal und Material entsprechend einplanen.${msgSig()}`));
    }
    return out;
  }

  function channelLink(channel, phone, email, subject, body) {
    const text = encodeURIComponent(body);
    if (channel === "whatsapp") return `https://wa.me/${(phone ?? "").replace(/[^\d]/g, "")}?text=${text}`;
    if (channel === "sms") return `sms:${phone ?? ""}?&body=${text}`;
    return `mailto:${email ?? ""}?subject=${encodeURIComponent(subject)}&body=${text}`;
  }

  Object.assign(SF, {
    dayLabel, dayShort, dayDE, clock, schedule, milestoneSlips, downstream, computeImpact, preventiveScan, withDelay, applyActions, proposeReplan, teamName,
    extractWithRules, fillSteps, minutesWithRules, NOTICE_LABEL, draftBehinderung, draftMaengel, draftMehrkosten, draftBedenken, draftAnforderung, draftTagesbericht,
    applyNextSteps, changeMessages, channelLink, newId, nowIso,
  });
})();
