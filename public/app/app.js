// Cats Track mock – state, actions and every screen.
// "Speak on site → the app sorts it → the right person gets the job."
// Three areas: Today · Record · Plan. Search for "VIEW:" to jump between screens.
// Colours are design tokens (ink, muted, accent, ok, bad, warn, sel …) defined in index.html.
// Colour rules: red = problem / overdue, amber = delay, neutral = normal, green = done / on track, dark = blocked.
// Handlers are inline: onclick="A.something()" calls an action, which updates state and re-renders.

(function () {
  const { PERSONAS, TEAMS, MILESTONES, CONTACTS, SEED_TASKS, SAMPLE_PHRASES, SITE_DOCUMENTS, SAMPLE_MINUTES, PROJECT } = SF;
  const { dayLabel, dayShort, clock, schedule, milestoneSlips, downstream, computeImpact, preventiveScan, withDelay, applyActions, proposeReplan, teamName, NOTICE_LABEL, newId, nowIso } = SF;
  const KEY = "siteflow-mock-v2";

  // ================================================================== state (persisted, like the zustand store)
  const initial = () => ({
    persona: "site-manager",
    today: PROJECT.today,
    tasks: JSON.parse(JSON.stringify(SEED_TASKS)),
    entries: [], notices: [], notifications: [], decisions: [], changes: [],
    pending: null, selectedNoticeId: null,
    project: { ...PROJECT },
    contacts: CONTACTS.map((c) => ({ ...c })),
    siteDocs: [],
    todos: [], messages: [], proposals: [],
  });
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || initial(); } catch { S = initial(); }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch { toast("Storage full – big attachments kept for this session only"); }
  };
  const sessionUrls = {}; // attachment id → object URL (big PDFs are not persisted)

  // UI-only state (not persisted)
  const U = {
    view: "record", planTab: "timeline", moreOpen: false, profileOpen: false, openTask: null, toast: null,
    capture: { lang: "de-DE", text: "", attachments: [], draft: null, usedVoice: false, listening: false },
    demo: false, details: false, stepPick: null, attachMenu: null, contractPicker: null, preview: null, logModal: null,
    open: {}, last: null, edit: null, collapsed: {}, editMsg: {}, reportMenu: false,
    logs: { q: "", filter: "all" }, scope: "all",
    site: { section: null, mode: window.innerWidth >= 640 ? "3d" : "plan", floor: "all", cat: "all", team: "all", pulse: true, people: true },
    minutes: { open: false, text: "", res: null, keep: [] },
    email: { open: false, text: "" },
    setupPreview: null, editContact: null, ai: {}, drag: null,
  };

  const render = () => {
    const scroll = window.scrollY;
    document.getElementById("app").innerHTML = Shell();
    // The 3D site model keeps one WebGL canvas alive across re-renders (public/app/site3d.js).
    const el3d = document.getElementById("site3d");
    if (el3d && window.__site3d) window.Site3D?.mount(el3d, window.__site3d.model, window.__site3d.handlers);
    window.scrollTo(0, scroll);
  };
  const commit = () => { save(); render(); };
  const toast = (m) => { U.toast = m; render(); clearTimeout(toast.t); toast.t = setTimeout(() => { U.toast = null; render(); }, 2500); };
  const renderLater = (inputId) => {
    clearTimeout(renderLater.t);
    renderLater.t = setTimeout(() => {
      render();
      const el = document.getElementById(inputId);
      if (el) { el.focus(); const n = el.value.length; el.setSelectionRange?.(n, n); }
    }, 250);
  };

  // ================================================================== helpers
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = (p) => newId(p);
  const personaName = (id) => PERSONAS.find((p) => p.id === id)?.name ?? id;
  const contactName = (id) => S.contacts.find((c) => c.id === id)?.name ?? id ?? "—";
  const shortName = (id) => {
    if (id === S.persona) return "you";
    const w = String(contactName(id)).split(" ");
    if (w[0] === "Dr.") return `Dr. ${w[w.length - 1]}`;
    return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0];
  };
  const shortDay = (d) => (d === S.today ? "today" : d === S.today + 1 ? "tomorrow" : d > S.today && d - S.today < 5 ? dayShort(d).wd : d > S.today + 20 ? `in ${Math.round((d - S.today) / 21)} months` : dayLabel(d));
  const me = () => PERSONAS.find((p) => p.id === S.persona);
  const isSM = () => S.persona === "site-manager";
  const canEdit = (t) => S.persona === "site-manager" || S.persona === t.team;
  const taskLabel = (id) => { const t = S.tasks.find((x) => x.id === id); return t ? `${t.name} ${t.section}` : id; };
  const missingCount = (t) => Object.values(t.readiness).filter((r) => r?.state === "open").length;
  const newSlipsOf = (impact) => impact.slipsAfter.filter((m) => m.slip > (impact.slipsBefore.find((b) => b.milestone.id === m.milestone.id)?.slip ?? 0));

  // ---- computed status (never stored, so it can't go stale)
  /** Overdue as specified: not done and plannedStart + duration + delayDays < today. */
  const isOverdue = (t) => t.status !== "done" && t.plannedStart + t.duration + t.delayDays < S.today;
  const todoOverdue = (td) => td.status === "open" && td.dueDay !== undefined && td.dueDay < S.today;
  const sortTasks = (list, sched) => [...list].sort((a, b) => isOverdue(b) - isOverdue(a) || sched[a.id].es - sched[b.id].es);
  const delayOf = (e) => Number(e.fields?.estimatedDelayDays ?? 0);
  const isProblem = (e) => ["stoppage", "defect", "incident"].includes(e.type) || delayOf(e) > 0;
  const severity = (e) => e.fields?.severity || (e.type === "stoppage" || e.type === "incident" || delayOf(e) >= 2 ? "High" : "Medium");
  const sectionOfEntry = (e) => S.tasks.find((t) => t.id === e.fields?.taskId)?.section || e.location?.match(/Section ([A-Z])/)?.[1] || "";
  const LEVELS = ["Floor 3", "Floor 2", "Floor 1", "Ground", "Basement", "Foundation"];
  const levelOf = (text) => {
    const s = String(text ?? "").toLowerCase();
    const f = s.match(/floor\s*(\d)/);
    if (f) return `Floor ${f[1]}`;
    if (/basement|keller/.test(s)) return "Basement";
    if (/foundation|fundament/.test(s)) return "Foundation";
    return "Ground";
  };
  const TYPE_LABEL = { stoppage: "Stoppage", delivery: "Delivery", defect: "Defect", incident: "Incident", meeting: "Meeting", attendance: "Attendance", progress: "Progress", instruction: "Instruction", note: "Note" };

  // ---- role-based visibility
  /** Site manager: all (or "mine" = what needs him now). Foremen: own tasks + tasks directly linked to them, always. */
  function scopeTasks() {
    const sched = schedule(S.tasks);
    if (isSM()) {
      if (U.scope === "all") return { own: S.tasks, related: [], link: {} };
      const mine = S.tasks.filter((t) => t.status !== "done" && (isOverdue(t) || t.status === "blocked" || missingCount(t) > 0
        || (sched[t.id].es <= S.today + 2 && sched[t.id].ef >= S.today) || S.proposals.some((p) => p.status === "pending" && p.taskId === t.id)));
      return { own: mine, related: [], link: {} };
    }
    const own = S.tasks.filter((t) => t.team === S.persona);
    const ownIds = new Set(own.map((t) => t.id));
    const link = {};
    own.forEach((t) => t.predecessors.forEach((p) => { if (!ownIds.has(p)) link[p] = "you wait on this"; }));
    S.tasks.forEach((x) => { if (!ownIds.has(x.id) && x.predecessors.some((p) => ownIds.has(p))) link[x.id] = "depends on you"; });
    return { own, related: S.tasks.filter((t) => link[t.id]), link };
  }
  /** Milestones the foreman's work feeds into (their tasks or anything downstream of them). */
  function scopeMilestones() {
    if (isSM()) return MILESTONES;
    const ids = new Set();
    S.tasks.filter((t) => t.team === S.persona).forEach((t) => [t.id, ...downstream(S.tasks, t.id)].forEach((x) => ids.add(x)));
    return MILESTONES.filter((m) => { const t = S.tasks.find((x) => x.milestone === m.id); return t && ids.has(t.id); });
  }

  // ---- UI kit (same building blocks as src/components/ui.tsx)
  const LOGO = (cls) => `<svg viewBox="0 0 512 512" class="${cls} shrink-0" aria-label="Cats Track"><rect width="512" height="512" rx="112" fill="#f06a6a"/><path d="M124 400V150l84 70h96l84-70v250a52 52 0 0 1-52 52H176a52 52 0 0 1-52-52z" fill="#fff"/><circle cx="206" cy="292" r="20" fill="#1e1f21"/><circle cx="306" cy="292" r="20" fill="#1e1f21"/><path d="M176 380h160" stroke="#f9c4c4" stroke-width="18" stroke-linecap="round"/><path d="M176 380h88" stroke="#f06a6a" stroke-width="18" stroke-linecap="round"/><circle cx="264" cy="380" r="20" fill="#f06a6a" stroke="#fff" stroke-width="8"/></svg>`;
  const ICONS = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    plan: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    photo: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    minutes: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    chev: '<path d="m9 18 6-6-6-6"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    today: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  };
  const Ic = (name, cls = "h-5 w-5") => `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u2190-\u21FF\u2300-\u23FF\u2460-\u27BF\u2B00-\u2BFF\uFE0F\u25A0-\u25FF]/gu;
  const plain = (html) => String(html).replace(/<span title="[^"]*" class="inline-flex shrink-0[^>]*>[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "").replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
  const TONES = {
    stone: "bg-soft text-ink", amber: "bg-warn-soft text-warn", red: "bg-bad-soft text-bad", green: "bg-ok-soft text-ok",
    blue: "bg-sel-soft text-sel", violet: "bg-violet-100 text-violet-800", accent: "bg-accent-soft text-accent-dark",
    overdue: "bg-bad text-white", blocked: "bg-ink text-white", outline: "border border-line bg-white text-ink",
  };
  const Badge = (text, tone = "stone", extra = "") => `<span class="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium ${TONES[tone]}" ${extra}>${text}</span>`;
  const OverdueChip = () => Badge("Overdue", "overdue");
  const DelayChip = (n) => Badge(`Delay +${n} d`, "amber");
  const VARIANTS = {
    primary: "bg-accent text-white hover:bg-accent-dark disabled:bg-accent-soft disabled:text-accent",
    secondary: "border border-line bg-white text-ink hover:bg-canvas disabled:text-faint",
    ghost: "text-muted hover:bg-soft",
    success: "bg-ok text-white hover:brightness-110 disabled:opacity-40",
  };
  const Btn = (label, onclick, variant = "secondary", extra = "", cls = "") =>
    `<button onclick="${onclick}" ${extra} class="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed ${VARIANTS[variant]} ${cls}">${label}</button>`;
  const Card = (title, body, right = "", cls = "") => `
    <section class="rounded-lg border border-line bg-white ${cls}">
      ${title || right ? `<header class="flex flex-wrap items-center justify-between gap-2 px-4 pt-4"><h2 class="text-base font-bold text-ink">${title}</h2>${right}</header>` : ""}
      <div class="p-4">${body}</div>
    </section>`;
  const Field = (label, inner) => `<label class="block text-xs font-semibold text-muted">${label}<div class="mt-1 text-sm text-ink">${inner}</div></label>`;
  const inputCls = "w-full min-h-10 rounded-md border border-line bg-white px-3 py-2 text-base text-ink focus:border-sel focus:outline-none";
  const chipBtn = (label, onclick, active, extra = "") =>
    `<button onclick="${onclick}" ${extra} class="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${active ? "border-sel bg-sel-soft text-sel" : "border-line bg-white text-muted"}">${label}</button>`;
  const SectionTitle = (text, right = "") => `<div class="mb-1.5 mt-6 flex items-center justify-between px-0.5"><h2 class="text-[15px] font-semibold text-ink">${text}</h2>${right}</div>`;
  const AVATAR_COLORS = { "site-manager": "#f06a6a", earthworks: "#b45309", formwork: "#2563eb", rebar: "#7c3aed", concrete: "#0f766e", client: "#52525b", supplier: "#52525b" };
  const Avatar = (id, name, size = 24) => {
    const initials = String(name).split(" ").filter((w) => w !== "Dr.").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    return `<span title="${esc(name)}" class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white" style="width:${size}px;height:${size}px;font-size:${size * 0.42}px;background:${AVATAR_COLORS[id] ?? "#71717a"}">${esc(initials)}</span>`;
  };
  const CheckCircle = (done, onclick, disabled) => `
    <button type="button" onclick="event.stopPropagation();${onclick}" ${disabled ? "disabled" : ""} title="${done ? "Mark incomplete" : "Mark complete"}" class="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-default disabled:opacity-40">
      <span class="flex h-5 w-5 items-center justify-center rounded-full border ${done ? "border-ok bg-ok text-white" : "border-faint text-transparent hover:border-ok hover:text-ok"}">
        <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="3"><path d="M3 8.5l3 3 7-7"/></svg>
      </span>
    </button>`;
  const options = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("");
  /** Status chips. Overdue (solid red) and Blocked (solid dark) look different; delay is amber. */
  const StatusChips = (t, showPlanned = true) => {
    const out = [];
    if (isOverdue(t)) out.push(OverdueChip());
    if (t.status === "blocked") out.push(Badge("Blocked", "blocked"));
    else if (t.status === "in-progress") out.push(Badge("In progress", "blue"));
    else if (t.status === "done") out.push(Badge("Done", "green"));
    else if (showPlanned && !out.length) out.push(Badge("Planned"));
    if (t.delayDays > 0) out.push(DelayChip(t.delayDays));
    return out.join("");
  };
  const MissingChip = (t) => (missingCount(t) ? Badge(`⚠ ${missingCount(t)} missing`, "outline") : "");
  const Modal = (title, body, onclose) => `
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onclick="if(event.target===this)${onclose}">
      <div class="max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white p-4 pb-safe sm:max-w-lg sm:rounded-xl">
        <div class="mb-3 flex items-center gap-2"><h3 class="flex-1 text-base font-semibold text-ink">${title}</h3>${Btn("✕", onclose, "ghost", 'aria-label="Close"')}</div>
        ${body}
      </div>
    </div>`;
  const ATT_ICON = { photo: "📷", pdf: "📄", contract: "📑" };
  const attUrl = (a) => a.url || sessionUrls[a.id];
  const AttachChip = (a, previewCall, removeCall) => `
    <span class="inline-flex min-h-10 max-w-full items-center gap-2 rounded-md border border-line bg-white pl-1 pr-1">
      <button onclick="event.stopPropagation();${previewCall}" class="flex min-w-0 items-center gap-2 py-1">
        ${a.kind === "photo" && attUrl(a) ? `<img src="${attUrl(a)}" alt="" class="h-9 w-9 rounded-lg object-cover">` : `<span class="flex h-9 w-9 items-center justify-center rounded-lg bg-canvas text-lg">${ATT_ICON[a.kind]}</span>`}
        <span class="max-w-[9rem] truncate text-xs font-semibold text-ink">${esc(a.name)}</span>
      </button>
      ${removeCall ? `<button onclick="event.stopPropagation();${removeCall}" class="flex h-9 w-9 items-center justify-center rounded-lg text-faint hover:text-bad" aria-label="Remove">✕</button>` : ""}
    </span>`;

  // ================================================================== store actions (ported from src/lib/store.ts)
  function entryDelta(e) {
    const progressDone = e.type === "progress" && e.fields.taskId && /fertig|erledigt|done|finished|completed|abgeschlossen/i.test(e.transcript);
    const { todos, messages } = SF.applyNextSteps(e, S.contacts);
    const delay = delayOf(e);
    const task = S.tasks.find((t) => t.id === e.fields.taskId);
    const proposal = task && delay > 0 && e.type !== "stoppage" && task.status !== "done"
      ? { id: uid("P"), createdAt: nowIso(), entryId: e.id, taskId: task.id, days: Math.round(delay), mode: task.status === "in-progress" ? "extend" : "shift", reason: e.transcript || e.summary, reportedBy: e.author, status: "pending" }
      : null;
    S.entries = [e, ...S.entries];
    if (progressDone) S.tasks = S.tasks.map((t) => (t.id === e.fields.taskId ? { ...t, status: "done" } : t));
    S.todos = [...todos, ...S.todos];
    S.messages = [...messages, ...S.messages];
    if (proposal) S.proposals = [proposal, ...S.proposals];
    if (e.author !== "site-manager")
      S.notifications = [{ id: uid("NT"), createdAt: nowIso(), to: ["site-manager"], from: e.author, kind: "alert", readBy: [], text: `${personaName(e.author)} logged: ${e.summary}${proposal ? ` — proposes moving ${proposal.taskId} by ${proposal.days} day(s)` : ""}` }, ...S.notifications];
  }
  const closeDecideTodos = (entryId) => { S.todos = S.todos.map((t) => (t.entryId === entryId && /plan change|planänderung/i.test(t.text) ? { ...t, status: "done" } : t)); };
  function describePatch(before, patch) {
    const parts = [];
    if (patch.plannedStart !== undefined) parts.push(`start ${dayLabel(before.plannedStart ?? 0)} → ${dayLabel(patch.plannedStart)}`);
    if (patch.duration !== undefined) parts.push(`duration ${before.duration} → ${patch.duration} d`);
    if (patch.status !== undefined) parts.push(`status ${before.status} → ${patch.status}`);
    return parts.join(", ");
  }
  function changeTask(taskId, patch, reason) {
    const t = S.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const after = S.tasks.map((x) => (x.id === taskId ? { ...x, ...patch } : x));
    const impact = computeImpact(S.tasks, after, taskId);
    const before = {};
    Object.keys(patch).forEach((k) => (before[k] = t[k]));
    const slipped = impact.slipsAfter.filter((m) => m.slip > 0 && m.slip > (impact.slipsBefore.find((b) => b.milestone.id === m.milestone.id)?.slip ?? 0));
    const sched = schedule(after);
    const moved = impact.changedTaskIds.map((id) => `${id} → starts ${dayLabel(sched[id].es)}`).join(", ");
    S.tasks = after;
    S.changes = [{ id: uid("C"), createdAt: nowIso(), by: S.persona, taskId, before, after: patch, reason, affectedTaskIds: impact.changedTaskIds, notified: impact.notify }, ...S.changes];
    S.decisions = [{ id: uid("D"), createdAt: nowIso(), day: S.today, by: S.persona, kind: "change", text: `${personaName(S.persona)} changed ${t.name} ${t.section} (${describePatch(before, patch)}). ${reason}` }, ...S.decisions];
    S.notifications = [{ id: uid("NT"), createdAt: nowIso(), to: impact.notify.filter((p) => p !== S.persona), from: S.persona, kind: "change", readBy: [],
      text: `${personaName(S.persona)} changed ${t.name} ${t.section} (${describePatch(before, patch)}).${impact.changedTaskIds.length ? ` Your tasks move: ${moved}.` : ""}${slipped.length ? ` ⚠ ${slipped.map((m) => `${m.milestone.name} slips ${m.slip} day(s)`).join("; ")}.` : ""}${reason ? ` Reason: ${reason}` : ""}` }, ...S.notifications];
  }
  function proposalAfter(p) {
    const sched0 = schedule(S.tasks);
    return p.mode === "extend" ? withDelay(S.tasks, p.taskId, p.days) : S.tasks.map((x) => (x.id === p.taskId ? { ...x, plannedStart: Math.max(x.plannedStart, sched0[x.id].es) + p.days } : x));
  }
  function addNotice(n) { S.notices = [{ by: S.persona, ...n }, ...S.notices]; S.selectedNoticeId = n.id; }
  const fileToDataUrl = (f) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
  async function fileAttachment(f, kind) {
    const a = { id: uid("AT"), kind, name: f.name, size: f.size };
    if (f.size < 800_000) a.url = await fileToDataUrl(f);
    else { sessionUrls[a.id] = URL.createObjectURL(f); a.session = true; }
    return a;
  }
  /** Letter options for a saved note (shown as one "Needs you" card). */
  function letterOptions(e) {
    const o = [];
    if (e.type === "stoppage") o.push(["behinderung", "Behinderungsanzeige"]);
    if (e.type === "defect" || e.type === "delivery") o.push(["maengel", e.type === "delivery" ? "Mängelrüge" : "Mängelanzeige"]);
    if (e.type === "instruction") o.push(["mehrkosten", "Mehrkostenanzeige"]);
    if (["stoppage", "instruction", "defect", "delivery"].includes(e.type)) o.push(["bedenken", "Bedenkenanzeige"]);
    return o;
  }

  async function api(path, body, ms = 20000) {
    if (!/^https?:/.test(location.protocol)) return null;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const out = await res.json();
      return out && !out.error ? out : null;
    } catch { return null; }
  }
  const openTasks = () => S.tasks.filter((t) => t.status !== "done").map(({ id, name, team, section }) => ({ id, name, team, section }));

  const A = {
    // navigation
    go(view, tab) { U.view = view; if (tab) U.planTab = tab; U.moreOpen = false; U.profileOpen = false; U.site.section = null; render(); window.scrollTo({ top: 0 }); },
    planTab(t) { U.planTab = t; U.moreOpen = false; render(); },
    more(open) { U.moreOpen = open; render(); },
    profile(open) { U.profileOpen = open; render(); },
    persona(p) { S.persona = p; U.edit = null; U.scope = "all"; U.profileOpen = false; U.open = {}; commit(); },
    scope(s) { U.scope = s; render(); },
    toggle(key) { U.open[key] = !U.open[key]; render(); },
    reset() { if (confirm("Reset the demo to its starting state?")) { S = initial(); U.last = null; U.openTask = null; U.capture.draft = null; U.capture.attachments = []; U.ai = {}; U.profileOpen = false; U.open = {}; commit(); } },

    // record
    record() { U.view = "record"; U.attachMenu = null; render(); window.scrollTo({ top: 0 }); if (!U.capture.draft && !U.capture.listening) A.mic(true); },
    lang(l) { U.capture.lang = l; render(); },
    demo() { U.demo = !U.demo; render(); },
    sample(i) { U.capture.text = SAMPLE_PHRASES[i].text; U.capture.usedVoice = false; A.structure(); },
    typedKey(ev) { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); U.capture.text = ev.target.value; A.structure(true); } },
    typedDone(v) { U.capture.text = v; if (v.trim() && !U.capture.draft) A.structure(true); },
    attachMenu(where) { U.attachMenu = U.attachMenu === where ? null : where; render(); },
    async attachFile(input, kind) {
      const f = input.files?.[0];
      input.value = "";
      U.attachMenu = null;
      if (!f) return render();
      if (kind === "photo") {
        const a = { id: uid("AT"), kind, name: f.name, url: await downscale(f), vision: "analysing" };
        U.capture.attachments.push(a); U.view = "record"; render();
        const v = await api("/api/vision", { image: a.url, context: U.capture.text });
        a.vision = v ? "done" : "off";
        if (v) a.note = [v.caption, ...(v.findings ?? []).map((x) => `Finding: ${x}`), v.textInImage ? `Text in photo: ${v.textInImage}` : ""].filter(Boolean).join(" ");
      }
      else {
        const a = await fileAttachment(f, kind);
        if (kind === "contract") { S.siteDocs = [{ name: f.name, kind: "Contract", note: "Uploaded from a note", url: a.url }, ...S.siteDocs]; U.contractPicker = null; save(); }
        U.capture.attachments.push(a);
      }
      U.view = "record";
      if (kind === "photo" && !U.capture.draft) return A.structure(true); // a photo starts sorting too
      render();
    },
    contractPicker(open) { U.attachMenu = null; U.contractPicker = open ? { q: "" } : null; render(); },
    contractSearch(v) { U.contractPicker.q = v; renderLater("contract-search"); },
    pickContract(i) {
      const d = [...S.siteDocs, ...SITE_DOCUMENTS][i];
      U.capture.attachments.push({ id: uid("AT"), kind: "contract", name: d.name, docKind: d.kind, url: d.url });
      U.contractPicker = null; U.view = "record"; render();
    },
    removeAttachment(i) { U.capture.attachments.splice(i, 1); render(); },
    previewCapture(i) { U.preview = U.capture.attachments[i]; render(); },
    previewEntry(entryId, i) { U.preview = S.entries.find((e) => e.id === entryId).attachments[i]; render(); },
    closePreview() { U.preview = null; render(); },
    mic(silent) {
      const R = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!R) { if (!silent) toast("Voice needs Chrome, Edge or Safari – type instead"); return; }
      if (U.capture.listening) { A._rec?.stop(); return; }
      const rec = new R();
      rec.lang = U.capture.lang; rec.interimResults = true; rec.continuous = false;
      let final = U.capture.text ? U.capture.text + " " : "";
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) final += ev.results[i][0].transcript + " ";
          else interim += ev.results[i][0].transcript;
        }
        U.capture.text = (final + interim).trim();
        const ta = document.getElementById("capture-text");
        if (ta) ta.value = U.capture.text;
      };
      rec.onerror = () => { U.capture.listening = false; if (!silent) toast("Mic unavailable – type instead"); };
      // Sorting starts by itself when the speaker stops talking.
      rec.onend = () => { U.capture.listening = false; if (U.capture.text.trim() && !U.capture.draft) A.structure(true); else render(); };
      A._rec = rec;
      U.capture.usedVoice = true; U.capture.listening = true;
      try { rec.start(); } catch { U.capture.listening = false; }
      render();
    },
    async structure(auto) {
      const c = U.capture;
      if (!c.text.trim() && !c.attachments.length) return auto ? render() : toast("Say or type what happened");
      if (c.sorting) return;
      const photoNotes = c.attachments.filter((a) => a.kind === "photo" && a.note).map((a) => a.note);
      c.sorting = true; render();
      const ai = await api("/api/extract", { text: c.text, photoNotes, speaker: `${me().name}, ${me().role}`, personaTeam: me().team, today: S.today, tasks: openTasks() });
      const base = ai && ai.type ? ai : SF.extractWithRules(c.text || photoNotes.join(" "), openTasks(), me().team, S.today);
      const d = SF.fillSteps({ ...base, fields: base.fields ?? {}, missing: base.missing ?? [], nextSteps: base.nextSteps ?? [] }, c.text, S.today, S.tasks);
      if (!c.text.trim() && !photoNotes.length) d.summary = "Photo note";
      // Max ONE follow-up question, picked once.
      d.ask = d.type === "stoppage" && d.missing.includes("estimatedDelayDays") ? "delay"
        : d.missing.includes("responsibleParty") ? "responsible" : d.missing.includes("taskId") ? "task" : null;
      c.sorting = false;
      c.draft = d;
      U.details = false; U.stepPick = null;
      render();
    },
    discard() { U.capture = { ...U.capture, text: "", attachments: [], draft: null, usedVoice: false }; render(); },
    reword() { U.capture.draft = null; render(); },
    details() { U.details = !U.details; render(); },
    answer(k, v) { const d = U.capture.draft; d.ask = null; A.setField(k, v); },
    setField(k, v) {
      const d = U.capture.draft;
      if (k === "estimatedDelayDays") v = v === "" || v === undefined ? undefined : Number(v);
      if (v === "") v = undefined;
      d.fields[k] = v;
      d.missing = d.missing.filter((m) => !(m === k && v !== undefined));
      if (k === "taskId") SF.fillSteps(d, U.capture.text, S.today, S.tasks);
      render();
    },
    setDraft(k, v, rerender) { U.capture.draft[k] = v; if (rerender) render(); },
    step(i, k, v, rerender = true) {
      const st = U.capture.draft.nextSteps[i];
      if (k === "dueDay") v = v === "" ? undefined : Number(v);
      if (k === "who" && v === "") v = undefined;
      st[k] = v;
      if (k !== "text") st.source = "user"; // the speaker's change wins over the AI
      if (rerender) render();
    },
    pickStep(i) { U.stepPick = i; render(); },
    closePick() { U.stepPick = null; render(); },
    addStep() { U.capture.draft.nextSteps.push({ kind: "task", text: "", who: S.persona, dueDay: S.today, source: "user" }); U.details = true; render(); },
    removeStep(i) { U.capture.draft.nextSteps.splice(i, 1); U.stepPick = null; render(); },
    saveLog() {
      const c = U.capture, d = c.draft;
      if (!d) return;
      const atts = c.attachments.map((a) => ({ ...a }));
      const e = {
        id: uid("E"), createdAt: nowIso(), day: S.today, author: S.persona, type: d.type, transcript: c.text || "(attachment only)", summary: d.summary, fields: d.fields,
        attachments: atts, photos: atts.filter((a) => a.kind === "photo").map((a) => a.url), photoNotes: [], location: d.location, state: d.state ?? d.summary,
        nextSteps: (d.nextSteps ?? []).filter((st) => st.text.trim()).map((st, i) => ({ ...st, id: `${Date.now().toString(36)}-${i}` })),
        source: c.usedVoice ? "voice" : c.text.trim() ? "text" : "photo", engine: d.engine, model: d.model,
      };
      entryDelta(e);
      U.capture = { ...U.capture, text: "", attachments: [], draft: null, usedVoice: false };
      U.last = letterOptions(e).length ? e : null;
      if (e.type === "stoppage" && e.fields.taskId) A._startReplan(e);
      save();
      U.view = "today";
      window.scrollTo({ top: 0 });
      toast(e.type !== "stoppage" && e.fields.taskId && delayOf(e) > 0 ? (isSM() ? "Saved · plan change waits for you" : "Saved · sent to site manager") : "Saved · sorted");
    },
    _startReplan(e) {
      const hour = e.fields.startTime ? parseInt(String(e.fields.startTime).split(":")[0], 10) : new Date().getHours();
      S.pending = { entryId: e.id, proposal: proposeReplan(S.tasks, e.fields.taskId, Number(e.fields.estimatedDelayDays ?? 1) || 1, S.today, hour) };
    },
    dismissLetter() { U.last = null; render(); },
    makeNotice(kind) {
      const e = U.last, task = S.tasks.find((t) => t.id === e.fields.taskId);
      let n;
      if (kind === "behinderung") {
        const base = S.tasks.map((t) => (t.id === task?.id ? { ...t, delayDays: Math.max(0, t.delayDays - Number(e.fields.estimatedDelayDays ?? 1)) } : t));
        const impact = task ? computeImpact(base, withDelay(base, task.id, Number(e.fields.estimatedDelayDays ?? 1)), task.id) : undefined;
        n = SF.draftBehinderung(e, task, impact, S.today, S.tasks);
      } else if (kind === "maengel") n = SF.draftMaengel(e, task, S.today);
      else if (kind === "mehrkosten") n = SF.draftMehrkosten(e, task, S.today);
      else n = SF.draftBedenken(e, task, S.today);
      addNotice(n);
      U.last = null;
      save(); toast("Letter drafted · approve below");
    },

    // re-plan
    approveReplan() {
      if (!S.pending) return;
      const { proposal } = S.pending;
      const before = S.tasks;
      const after = applyActions(withDelay(before, proposal.triggerTaskId, proposal.delayDays), proposal.actions);
      const impact = computeImpact(before, after, proposal.triggerTaskId);
      const notify = Array.from(new Set(["site-manager", ...impact.affectedTeams, ...proposal.actions.map((a) => a.team)]));
      const trig = before.find((t) => t.id === proposal.triggerTaskId);
      const src = S.entries.find((e) => e.id === S.pending.entryId);
      S.tasks = after;
      S.pending = null;
      S.messages = [...SF.changeMessages(before, after, proposal.triggerTaskId, src?.transcript || src?.summary || "Stillstand", S.contacts), ...S.messages];
      S.decisions = [{ id: uid("D"), createdAt: nowIso(), day: S.today, by: S.persona, kind: "reactive", text: `Re-plan approved after stoppage on ${trig.name} ${trig.section}: ${proposal.actions.length} action(s), ${proposal.idleHoursSaved} idle crew-hours avoided.` }, ...S.decisions];
      S.notifications = [{ id: uid("NT"), createdAt: nowIso(), to: notify, from: S.persona, kind: "replan", readBy: [S.persona], text: `Re-plan approved by ${personaName(S.persona)}: ${proposal.actions.map((a) => a.reason).join(" ")}` }, ...S.notifications];
      save(); toast("Re-plan approved · updates ready to send");
    },
    rejectReplan() {
      if (!S.pending) return;
      const { proposal } = S.pending;
      const after = withDelay(S.tasks, proposal.triggerTaskId, proposal.delayDays);
      const impact = computeImpact(S.tasks, after, proposal.triggerTaskId);
      S.tasks = after; S.pending = null;
      S.decisions = [{ id: uid("D"), createdAt: nowIso(), day: S.today, by: S.persona, kind: "reactive", text: `Delay of ${proposal.delayDays} day(s) recorded on ${proposal.triggerTaskId}; proposed re-plan rejected.` }, ...S.decisions];
      S.notifications = [{ id: uid("NT"), createdAt: nowIso(), to: impact.notify, from: S.persona, kind: "change", readBy: [S.persona], text: `Delay recorded on ${proposal.triggerTaskId}; tasks moved: ${impact.changedTaskIds.join(", ") || "none"}.` }, ...S.notifications];
      commit();
    },

    // proposals (plan changes reported in notes)
    acceptProposal(id) {
      const p = S.proposals.find((x) => x.id === id);
      if (!p || p.status !== "pending" || !isSM()) return;
      const t = S.tasks.find((x) => x.id === p.taskId);
      const before = S.tasks;
      const after = proposalAfter(p);
      const impact = computeImpact(before, after, p.taskId);
      const slipped = impact.slipsAfter.filter((m) => m.slip > 0 && m.slip > (impact.slipsBefore.find((b) => b.milestone.id === m.milestone.id)?.slip ?? 0));
      const patch = p.mode === "extend" ? { delayDays: t.delayDays + p.days } : { plannedStart: after.find((x) => x.id === p.taskId).plannedStart };
      const prev = p.mode === "extend" ? { delayDays: t.delayDays } : { plannedStart: t.plannedStart };
      S.tasks = after;
      S.proposals = S.proposals.map((x) => (x.id === id ? { ...x, status: "accepted", decidedAt: nowIso() } : x));
      closeDecideTodos(p.entryId);
      S.messages = [...SF.changeMessages(before, after, p.taskId, p.reason, S.contacts), ...S.messages];
      S.changes = [{ id: uid("C"), createdAt: nowIso(), by: S.persona, taskId: p.taskId, before: prev, after: patch, reason: p.reason, affectedTaskIds: impact.changedTaskIds, notified: impact.notify }, ...S.changes];
      S.decisions = [{ id: uid("D"), createdAt: nowIso(), day: S.today, by: S.persona, kind: "change", text: `Accepted: ${t.name} ${t.section} ${p.mode === "extend" ? "takes" : "moves"} ${p.days} day(s) ${p.mode === "extend" ? "longer" : "later"} (reported by ${personaName(p.reportedBy)}). ${impact.changedTaskIds.length} follow-on task(s) moved.${slipped.length ? ` ${slipped.map((m) => `${m.milestone.name} slips ${m.slip} d`).join("; ")}.` : ""}` }, ...S.decisions];
      S.notifications = [{ id: uid("NT"), createdAt: nowIso(), to: impact.notify.filter((x) => x !== S.persona), from: S.persona, kind: "change", readBy: [], text: `Plan change accepted: ${t.name} ${t.section} +${p.days} day(s). Moved: ${impact.changedTaskIds.join(", ") || "none"}.` }, ...S.notifications];
      save(); toast("Plan updated · updates ready to send");
    },
    rejectProposal(id) {
      const p = S.proposals.find((x) => x.id === id);
      if (!p || p.status !== "pending") return;
      S.proposals = S.proposals.map((x) => (x.id === id ? { ...x, status: "rejected", decidedAt: nowIso() } : x));
      closeDecideTodos(p.entryId);
      S.decisions = [{ id: uid("D"), createdAt: nowIso(), day: S.today, by: S.persona, kind: "change", text: `Rejected proposed delay of ${p.days} day(s) on ${p.taskId}: plan stays as is.` }, ...S.decisions];
      save(); toast("Plan kept");
    },

    // risks (coming up)
    draftRequest(taskId, key) {
      const a = preventiveScan(S.tasks, S.today).find((x) => x.taskId === taskId && x.key === key);
      addNotice(SF.draftAnforderung(a, S.tasks.find((t) => t.id === taskId), S.today));
      save(); toast("Request drafted · approve below");
    },
    clearBlocker(taskId, key, silent) {
      const t = S.tasks.find((x) => x.id === taskId);
      S.tasks = S.tasks.map((x) => (x.id === taskId ? { ...x, readiness: { ...x.readiness, [key]: { ...x.readiness[key], state: "cleared" } } } : x));
      S.decisions = [{ id: uid("D"), createdAt: nowIso(), day: S.today, by: S.persona, kind: "preventive", text: `Cleared on ${t.name} ${t.section}: ${key} (${t.readiness[key]?.note ?? ""})` }, ...S.decisions];
      S.notifications = [{ id: uid("NT"), createdAt: nowIso(), to: Array.from(new Set(["site-manager", t.team])), from: S.persona, kind: "alert", readBy: [S.persona], text: `${personaName(S.persona)} cleared "${key}" for ${t.name} ${t.section}.` }, ...S.notifications];
      save();
      silent ? render() : toast("Cleared ✓");
    },

    // tasks
    toggleDone(id) {
      const t = S.tasks.find((x) => x.id === id);
      if (!canEdit(t)) return;
      const done = t.status === "done";
      changeTask(id, { status: done ? "planned" : "done" }, done ? "Marked incomplete" : "Marked complete");
      if (U.openTask === id) { const nt = S.tasks.find((x) => x.id === id); U.edit = { shift: 0, dur: nt.duration, status: nt.status, reason: "" }; }
      commit();
    },
    openTask(id) { U.logModal = null; U.openTask = id; const t = S.tasks.find((x) => x.id === id); U.edit = { shift: 0, dur: t.duration, status: t.status, reason: "" }; render(); },
    closeTask() { U.openTask = null; render(); },
    ed(k, v) { if (k === "shift") U.edit.shift += v; else if (k === "dur") U.edit.dur = Math.max(1, U.edit.dur + v); else U.edit[k] = v; if (k !== "reason") render(); },
    undoEdit() { const t = S.tasks.find((x) => x.id === U.openTask); U.edit = { shift: 0, dur: t.duration, status: t.status, reason: "" }; render(); },
    applyEdit() {
      const t = S.tasks.find((x) => x.id === U.openTask);
      const patch = editPatch(t);
      if (!Object.keys(patch).length) return;
      changeTask(t.id, patch, U.edit.reason);
      const nt = S.tasks.find((x) => x.id === t.id);
      U.edit = { shift: 0, dur: nt.duration, status: nt.status, reason: "" };
      save(); toast("Applied · teams notified");
    },
    boardMove(id, status) { const t = S.tasks.find((x) => x.id === id); if (t && t.status !== status && canEdit(t)) { changeTask(id, { status }, "Moved on board"); commit(); } },
    drop(status) { const id = U.drag; U.drag = null; if (id) A.boardMove(id, status); else render(); },
    collapse(team) { U.collapsed[team] = !U.collapsed[team]; render(); },

    // updates, notifications, to-dos
    gotIt(id) { S.notifications = S.notifications.map((n) => (n.id === id && !n.readBy.includes(S.persona) ? { ...n, readBy: [...n.readBy, S.persona] } : n)); commit(); },
    send(id, channel) {
      const m = S.messages.find((x) => x.id === id), c = S.contacts.find((x) => x.id === m.to);
      if (channel === "copy") { try { navigator.clipboard.writeText(m.body); } catch {} }
      else window.open(SF.channelLink(channel, c?.phone, c?.email, m.subject, m.body), "_blank", "noopener");
      S.messages = S.messages.map((x) => (x.id === id ? { ...x, status: "sent", sentAt: nowIso(), channel } : x));
      save();
      toast(channel === "copy" ? "Copied · marked sent" : "Opened · marked sent");
    },
    editMsg(id) { U.editMsg[id] = !U.editMsg[id]; U.open[`m-${id}`] = true; render(); },
    msgBody(id, v) { S.messages = S.messages.map((m) => (m.id === id ? { ...m, body: v } : m)); save(); },
    discardMsg(id) { S.messages = S.messages.filter((m) => m.id !== id); commit(); },
    toggleTodo(id) { S.todos = S.todos.map((t) => (t.id === id ? { ...t, status: t.status === "open" ? "done" : "open" } : t)); commit(); },

    // documents
    libFilter(f) { U.libFilter = f; render(); },
    libOpen(id) { U.libItem = id; render(); },
    libNotice(id) { S.selectedNoticeId = id; U.planTab = "docs"; commit(); },
    selectNotice(id) { S.selectedNoticeId = id; commit(); },
    openNotice(id) { S.selectedNoticeId = id; save(); A.go("plan", "docs"); },
    noticeBody(id, v) { S.notices = S.notices.map((n) => (n.id === id && n.status === "draft" ? { ...n, body: v } : n)); save(); },
    approveNotice(id) {
      const n = S.notices.find((x) => x.id === id);
      if (!n || !isSM()) return;
      S.notices = S.notices.map((x) => (x.id === id ? { ...x, status: "approved", approvedAt: nowIso() } : x));
      if (n.mode !== "report") S.decisions = [{ id: uid("D"), createdAt: nowIso(), day: S.today, by: S.persona, kind: n.mode === "preventive" ? "preventive" : "reactive", text: `Approved: ${n.title} → ${n.addressee}` }, ...S.decisions];
      save(); toast("Approved ✓ · PDF in Plan › More › Documents");
    },
    dailyReport() {
      addNotice(SF.draftTagesbericht({ day: S.today, tasks: S.tasks, sched: schedule(S.tasks), entries: S.entries, decisions: S.decisions, notices: S.notices }));
      U.reportMenu = false;
      save(); toast("Daily report drafted · approve above");
    },
    reportMenu() { U.reportMenu = !U.reportMenu; render(); },
    exportTxt(id) {
      const n = S.notices.find((x) => x.id === id);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([n.body], { type: "text/plain;charset=utf-8" }));
      a.download = `${n.title.replace(/[^\w\-äöüÄÖÜß ]+/g, "").trim()}.txt`;
      a.click();
    },
    print(id) {
      const n = S.notices.find((x) => x.id === id);
      const w = window.open("", "_blank");
      w.document.write(`<pre style="font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;padding:32px">${esc(n.body)}</pre>`);
      w.document.close(); w.print();
    },
    async summarise() {
      const facts = summaryFacts();
      U.ai = { text: "Summarising…", note: "" }; U.reportMenu = false; render();
      const ai = await api("/api/summary", { facts });
      U.ai = ai?.summary ? { text: ai.summary, note: `AI · ${ai.model ?? "open model"}` } : { text: facts, note: "built-in rules" };
      render();
    },

    // site notes
    logFilter(v) { U.logs.filter = v; render(); },
    logSearch(v) { U.logs.q = v; renderLater("log-search"); },
    openLog(id) { U.logModal = id; render(); },
    closeLog() { U.logModal = null; render(); },
    fromMinutes() { U.attachMenu = null; U.view = "plan"; U.planTab = "notes"; U.minutes = { open: true, text: "", res: null, keep: [] }; render(); },
    emailOpen(o) { U.attachMenu = null; U.email = { open: o, text: o ? U.email.text : "" }; render(); },
    emailSample() { U.email.text = SAMPLE_EMAIL; render(); },
    emailSort() {
      const t = U.email.text.trim(); if (!t) return;
      U.email = { open: false, text: "" }; U.view = "record"; U.capture.text = t; A.structure(true);
    },
    minutesOpen(o) { U.minutes = { open: o, text: "", res: null, keep: [] }; render(); },
    minutesSample() { U.minutes.text = SAMPLE_MINUTES; render(); },
    async minutesSplit() {
      const tasks = S.tasks.map(({ id, name, team, section }) => ({ id, name, team, section }));
      U.minutes.busy = true; render();
      const ai = await api("/api/minutes", { text: U.minutes.text, today: S.today, tasks });
      const items = ai?.items?.length ? ai.items : SF.minutesWithRules(U.minutes.text, tasks, S.today);
      U.minutes.busy = false;
      U.minutes.res = { items, engine: ai?.engine ?? "rules" };
      U.minutes.keep = items.map(() => true);
      render();
    },
    minutesKeep(i) { U.minutes.keep[i] = !U.minutes.keep[i]; render(); },
    minutesBack() { U.minutes.res = null; render(); },
    minutesSave() {
      const stamp = Date.now().toString(36);
      const es = U.minutes.res.items.filter((_, i) => U.minutes.keep[i]).map((it, i) => ({
        id: `E-${stamp}-m${i}`, createdAt: nowIso(), day: S.today, author: S.persona, type: it.type, transcript: it.text, summary: it.summary,
        fields: it.taskId ? { taskId: it.taskId } : {}, photos: [], attachments: [], location: it.location, state: it.state,
        nextSteps: it.nextSteps.map((st, j) => ({ ...st, id: `${stamp}-${i}-${j}` })), source: "minutes", engine: "rules",
      }));
      [...es].reverse().forEach(entryDelta);
      U.minutes = { open: false, text: "", res: null, keep: [] };
      save(); toast(`${es.length} site note(s) saved`);
    },

    week(d) { const cur = U.week ?? Math.floor(S.today / 5); U.week = Math.max(0, Math.min(1, cur + d)); render(); },
    siteSet(k) { U.site.section = k; render(); },
    siteSection(s) { U.site.section = U.site.section === s ? null : s; render(); },
    siteMode(m) { U.site.mode = m; render(); },
    site3d(k, v) { U.site[k] = v; render(); },
    site3dReset() { window.Site3D?.reset(); },

    // setup
    project(k, v) { S.project[k] = v; save(); },
    async importFile(input) {
      const f = input.files?.[0];
      input.value = "";
      if (!f) return;
      if (!/\.csv$/i.test(f.name)) { U.setupPreview = { file: f.name, tasks: [], errors: ["Mock reads .csv only"], warnings: [] }; return render(); }
      U.setupPreview = { file: f.name, ...csvToTasks(await f.text()) };
      render();
    },
    usePlan() {
      const p = U.setupPreview;
      S.tasks = p.tasks; S.pending = null; S.proposals = [];
      S.decisions = [{ id: uid("D"), createdAt: nowIso(), day: S.today, by: S.persona, kind: "change", text: `Site plan initialised from ${p.file}: ${p.tasks.length} tasks.` }, ...S.decisions];
      U.setupPreview = null;
      save(); toast(`Plan: ${p.tasks.length} tasks`);
    },
    cancelImport() { U.setupPreview = null; render(); },
    template() {
      const head = "ID,Name,Team,Section,Start,Duration,Crew,Predecessors,Milestone";
      const rows = S.tasks.map((t) => [t.id, t.name, t.team, t.section, t.plannedStart, t.duration, t.crew, t.predecessors.join(" "), t.milestone ?? ""].join(","));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + [head, ...rows].join("\n")], { type: "text/csv;charset=utf-8" }));
      a.download = "siteflow-schedule-template.csv";
      a.click();
    },
    editContact(id) { U.editContact = id; render(); },
    contact(id, k, v, rerender) { S.contacts = S.contacts.map((c) => (c.id === id ? { ...c, [k]: v === "" ? undefined : v } : c)); save(); if (rerender) render(); },

    dragStart(ev, id) { U.drag = id; ev.dataTransfer.setData("text/plain", id); ev.dataTransfer.effectAllowed = "move"; },
    dragOver(ev, col) { ev.preventDefault(); document.querySelectorAll("[data-col]").forEach((el) => el.classList.toggle("ring-4", el.dataset.col === col)); },
  };

  function editPatch(t) {
    const e = U.edit, p = {};
    if (e.shift) p.plannedStart = Math.max(0, t.plannedStart + e.shift);
    if (e.dur !== t.duration) p.duration = Math.max(1, e.dur);
    if (e.status !== t.status) p.status = e.status;
    return p;
  }
  async function downscale(file, max = 900) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((r) => ((img.onload = r), (img.src = url)));
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return c.toDataURL("image/jpeg", 0.7);
  }
  function csvToTasks(text) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    const sep = lines[0]?.includes(";") ? ";" : ",";
    const head = lines.shift()?.split(sep).map((h) => h.trim().toLowerCase()) ?? [];
    const col = (row, name) => row[head.indexOf(name)]?.trim() ?? "";
    const errors = [], warnings = [], tasks = [];
    if (!head.includes("id") || !head.includes("name")) errors.push("Missing columns: ID and Name are required.");
    lines.forEach((l, i) => {
      const r = l.split(sep);
      const team = col(r, "team").toLowerCase();
      if (!TEAMS.some((t) => t.id === team)) warnings.push(`Row ${i + 2}: unknown team "${team}" → earthworks`);
      tasks.push({ id: col(r, "id"), name: col(r, "name"), team: TEAMS.some((t) => t.id === team) ? team : "earthworks", section: col(r, "section"),
        plannedStart: Number(col(r, "start")) || 0, duration: Number(col(r, "duration")) || 1, crew: Number(col(r, "crew")) || 4,
        predecessors: col(r, "predecessors").split(/[\s|]+/).filter(Boolean), milestone: col(r, "milestone") || undefined,
        status: "planned", delayDays: 0, readiness: { predecessor: { state: "cleared" }, material: { state: "cleared" }, crew: { state: "cleared" }, equipment: { state: "cleared" }, permit: { state: "cleared" }, drawings: { state: "cleared" } } });
    });
    return { tasks: errors.length ? [] : tasks, errors, warnings };
  }
  function summaryFacts() {
    const todays = S.entries.filter((e) => e.day === S.today);
    const authors = new Set(todays.map((e) => e.author));
    const openP = S.proposals.filter((p) => p.status === "pending");
    const slips = milestoneSlips(S.tasks, schedule(S.tasks)).filter((m) => m.slip > 0);
    const dec = S.decisions.filter((d) => d.day === S.today);
    return [
      `${todays.length} site note(s) today from ${authors.size} person(s).`,
      ...todays.slice(0, 12).map((e) => `- ${clock(e.createdAt)} ${e.type} by ${contactName(e.author)}${e.location ? ` at ${e.location}` : ""}: ${e.summary}`),
      openP.length ? `Waiting for decision: ${openP.map((p) => `${p.taskId} +${p.days} day(s)`).join("; ")}.` : "",
      slips.length ? `Milestones at risk: ${slips.map((m) => `${m.milestone.name} +${m.slip} d`).join(", ")}.` : "Milestones on track.",
      dec.length ? `Decisions today: ${dec.map((d) => d.text).join(" | ")}` : "",
    ].filter(Boolean).join("\n");
  }

  // ================================================================== NEEDS YOU: one list of everything waiting for the current user
  function needsYou() {
    const items = [];
    const sched = schedule(S.tasks);
    const sm = isSM();
    const T = S.today;

    if (sm && S.pending) {
      const p = S.pending.proposal, trig = S.tasks.find((t) => t.id === p.triggerTaskId);
      const before = p.impact.slipsAfter.filter((s) => s.slip > 0), after = p.slipsAfterReplan.filter((s) => s.slip > 0);
      items.push({ key: "rp", icon: "⚡", tone: "bad", title: `Re-plan · ${trig.name} ${trig.section}`, delay: true, due: T,
        chips: [DelayChip(p.delayDays), Badge(`◆ ${before.length ? `+${Math.max(...before.map((s) => s.slip))} d` : "ok"} → ${after.length ? `+${Math.max(...after.map((s) => s.slip))} d` : "ok"}`, after.length ? "red" : "green"), Badge(`👷 −${p.idleHoursSaved} h idle`)],
        primary: ["✓ Approve", "A.approveReplan()", "success"], more: [["Delay only", "A.rejectReplan()"]], detail: ReplanDetail(p) });
    }
    if (sm) S.proposals.filter((p) => p.status === "pending").forEach((p) => {
      const t = S.tasks.find((x) => x.id === p.taskId);
      const impact = computeImpact(S.tasks, proposalAfter(p), p.taskId), ns = newSlipsOf(impact);
      items.push({ key: `p-${p.id}`, icon: "📅", tone: "warn", title: `Plan change · ${t.name} ${t.section}`, delay: true, due: T,
        chips: [DelayChip(p.days), Badge(`👤 ${esc(shortName(p.reportedBy))}`), ...(impact.changedTaskIds.length ? [Badge(`↪ ${impact.changedTaskIds.join(", ")}`)] : []), ...ns.map((m) => Badge(`◆ ${m.milestone.id} +${m.slip} d`, "red"))],
        primary: ["✓ Accept", `A.acceptProposal('${p.id}')`, "primary"], more: [["✕ Reject", `A.rejectProposal('${p.id}')`]], detail: `<p class="text-sm italic text-muted">“${esc(p.reason)}”</p>` });
    });
    if (U.last) {
      const opts = letterOptions(U.last), e = U.last;
      items.push({ key: "sug", icon: "✍", tone: isProblem(e) ? "bad" : "neutral", title: `Letter · ${opts[0][1]}`, delay: delayOf(e) > 0, due: T,
        chips: [Badge(e.type, isProblem(e) ? "red" : "stone"), ...(e.fields.taskId ? [Badge(`🔗 ${esc(taskLabel(e.fields.taskId))}`)] : [])],
        primary: ["📄 Draft", `A.makeNotice('${opts[0][0]}')`, "primary"], more: [...opts.slice(1).map(([k, l]) => [`📄 ${l}`, `A.makeNotice('${k}')`]), ["✕ Not needed", "A.dismissLetter()"]] });
    }
    if (sm) S.notices.filter((n) => n.status === "draft").forEach((n) => {
      items.push({ key: `n-${n.id}`, icon: "📄", tone: n.mode === "reactive" ? "bad" : "neutral", title: `Approve · ${n.title}`, due: T,
        chips: [Badge(`→ ${esc(n.addressee)}`), ...(/\[[^\]]+ergänzen\]/.test(n.body) ? [Badge("✎ fill [gaps]", "amber")] : [])],
        primary: ["✓ Approve", `A.approveNotice('${n.id}')`, "success"],
        more: [["✎ Full editor", `A.openNotice('${n.id}')`], ["🖨 PDF", `A.print('${n.id}')`], ["⬇ .txt", `A.exportTxt('${n.id}')`]],
        detail: `<textarea oninput="A.noticeBody('${n.id}', this.value)" class="h-64 w-full rounded-xl border border-line bg-canvas p-3 font-mono text-xs leading-relaxed focus:border-sel focus:outline-none">${esc(n.body)}</textarea>` });
    });
    if (sm) S.messages.filter((m) => m.status === "draft").forEach((m) => {
      const c = S.contacts.find((x) => x.id === m.to);
      const ch = c?.phone ? "whatsapp" : "email";
      items.push({ key: `m-${m.id}`, icon: "✉", tone: m.purpose === "action" ? "warn" : "neutral", title: `Send update · ${esc(c?.name ?? m.to)}`, due: T,
        chips: [Badge(m.purpose === "action" ? "❗ action" : "ⓘ FYI", m.purpose === "action" ? "red" : "blue"), Badge(esc(c?.company ?? ""))],
        primary: [ch === "whatsapp" ? "💬 Send" : "✉ Send", `A.send('${m.id}','${ch}')`, "primary"],
        more: [...(c?.phone ? [["📱 SMS", `A.send('${m.id}','sms')`]] : []), ...(c?.email && ch !== "email" ? [["✉ Email", `A.send('${m.id}','email')`]] : []), ["⧉ Copy", `A.send('${m.id}','copy')`], [U.editMsg[m.id] ? "✓ Done" : "✎ Edit text", `A.editMsg('${m.id}')`], ["🗑 Discard", `A.discardMsg('${m.id}')`]],
        detail: U.editMsg[m.id] ? `<textarea class="${inputCls} min-h-40 font-mono text-xs" oninput="A.msgBody('${m.id}', this.value)">${esc(m.body)}</textarea>` : `<p class="whitespace-pre-line rounded-xl bg-canvas p-3 text-sm">${esc(m.body)}</p>` });
    });
    // Coming up: risks (what's missing before a task can start)
    preventiveScan(S.tasks, T).filter((a) => sm || S.tasks.find((t) => t.id === a.taskId)?.team === S.persona).forEach((a) => {
      const t = S.tasks.find((x) => x.id === a.taskId);
      const external = !/site manager/i.test(a.owner);
      const left = a.dueDay - T;
      const request = ["📄 Request", `A.draftRequest('${a.taskId}','${a.key}')`, "primary"];
      const clear = ["✓ Clear", `A.clearBlocker('${a.taskId}','${a.key}')`, sm && external ? "secondary" : "primary"];
      items.push({ key: `r-${a.taskId}-${a.key}`, icon: "⏳", tone: left <= 1 ? "bad" : "neutral", title: `${t.name} ${t.section} · ${a.key} missing`, overdue: a.dueDay < T, due: a.dueDay,
        chips: [Badge(`⏳ ${left <= 0 ? "today" : `${left} d`}`, left <= 1 ? "red" : "stone"), Badge(`👤 ${esc(a.owner.split(" (")[0])}`), Badge(`▶ ${dayShort(a.startDay).wd}`), ...(a.slack <= 0 ? [Badge("◆ critical", "red")] : [])],
        primary: sm && external ? request : clear, more: sm && external ? [["✓ Clear", clear[1]]] : [], detail: `<p class="text-sm text-muted">${esc(a.note)}</p>` });
    });
    // To-dos for me
    S.todos.filter((td) => td.status === "open" && td.owner === S.persona && (td.dueDay === undefined || td.dueDay <= T + 1)).forEach((td) => {
      const src = S.entries.find((e) => e.id === td.entryId);
      items.push({ key: `t-${td.id}`, icon: td.kind === "remind" ? "⏰" : "✔︎", tone: src && isProblem(src) ? "bad" : "neutral", title: esc(td.text), overdue: todoOverdue(td), delay: src ? delayOf(src) > 0 : false, due: td.dueDay ?? T,
        chips: [Badge(`📅 ${td.dueDay !== undefined ? shortDay(td.dueDay) : "—"}`), ...(src?.fields?.taskId ? [Badge(`🔗 ${esc(taskLabel(src.fields.taskId))}`)] : [])],
        primary: ["✓ Done", `A.toggleTodo('${td.id}')`, "secondary"], detail: src ? `<p class="text-sm italic text-muted">“${esc(src.transcript)}”</p>` : null });
    });
    // Updates for me
    const ICON = { change: "✏️", replan: "⚡", alert: "🔔", notice: "📄" };
    S.notifications.filter((n) => n.to.includes(S.persona) && !n.readBy.includes(S.persona)).forEach((n) => {
      items.push({ key: `nt-${n.id}`, icon: ICON[n.kind], tone: /slips|⚠/.test(n.text) ? "bad" : "neutral", title: esc(n.text), delay: /slips|move/.test(n.text), due: T,
        chips: [Badge(`${Avatar(n.from ?? "x", personaName(n.from ?? ""), 16)} ${esc(shortName(n.from))}`), Badge(clock(n.createdAt))],
        primary: ["✓ Got it", `A.gotIt('${n.id}')`, "secondary"], detail: `<p class="text-sm">${esc(n.text)}</p>` });
    });
    // Sort: overdue first, then items that cause a delay, then by due date.
    return items.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || (b.delay ? 1 : 0) - (a.delay ? 1 : 0) || a.due - b.due);
  }

  const TONE_EDGE = { bad: "border-l-bad", warn: "border-l-warn", neutral: "border-l-line", ok: "border-l-ok" };
  const NEED_ICON = { "⚡": "zap", "📅": "cal", "✍": "pen", "📄": "file", "✉": "send", "⏳": "clock", "⏰": "clock", "✔︎": "check", "✏️": "pen", "🔔": "bell" };
  const NEED_TINT = { bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", ok: "bg-ok-soft text-ok", neutral: "bg-soft text-muted" };
  const ACT = { primary: "bg-accent text-white", success: "bg-ok text-white", secondary: "border border-line bg-white text-ink" };
  function NeedCard(it) {
    const open = U.open[it.key];
    const meta = [it.overdue ? '<span class="font-medium text-bad">Overdue</span>' : "", ...it.chips.map((c) => {
      const t = esc(plain(c)); if (!t) return "";
      return /text-bad|bg-bad/.test(c) ? `<span class="text-bad">${t}</span>` : /text-warn/.test(c) ? `<span class="text-warn">${t}</span>` : t;
    })].filter(Boolean);
    const shown = open ? meta : meta.slice(0, 3);
    const [label, call, variant] = it.primary;
    return `
      <li data-need="${it.key}">
        <div class="flex items-center gap-3 px-3 py-2.5">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${NEED_TINT[it.tone] ?? NEED_TINT.neutral}">${Ic(NEED_ICON[it.icon] ?? "bell", "h-4 w-4")}</span>
          <button onclick="A.toggle('${it.key}')" class="min-w-0 flex-1 text-left">
            <span class="block text-sm font-medium leading-snug text-ink ${open ? "" : "truncate"}">${it.title}</span>
            <span class="mt-0.5 block text-xs leading-snug text-muted ${open ? "" : "truncate"}">${shown.join(" · ")}</span>
          </button>
          <button onclick="${call}" class="h-8 shrink-0 rounded-full px-3 text-xs font-semibold ${ACT[variant] ?? ACT.secondary}">${esc(plain(label))}</button>
        </div>
        ${open ? `<div class="space-y-2 px-3 pb-3 pl-14">${it.detail ?? ""}${it.more?.length ? `<div class="flex flex-wrap gap-1.5">${it.more.map(([l, c]) => `<button onclick="${c}" class="h-8 rounded-full border border-line bg-white px-3 text-xs font-medium text-ink">${esc(plain(l))}</button>`).join("")}</div>` : ""}</div>` : ""}
      </li>`;
  }

  function ReplanDetail(p) {
    return `
      <ol class="space-y-2">${p.actions.map((a, i) => `
        <li class="flex gap-2 rounded-xl bg-canvas p-2 text-sm">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">${i + 1}</span>
          <span><b>${a.kind === "crash" ? "👷+ Add crew" : "⏩ Pull forward"} · ${esc(taskLabel(a.taskId))}</b>
            <span class="block text-xs font-semibold text-muted">${a.kind === "pull-forward" ? `${dayShort(a.fromDay).wd} → ${dayShort(a.toDay).wd}` : `${dayShort(a.toDay).wd} · ${a.newDuration} d`}${a.idleHoursSaved ? ` · −${a.idleHoursSaved} h idle` : ""}</span></span>
        </li>`).join("") || Badge("no re-plan found")}</ol>
      ${p.impact.changedTaskIds.length ? `<div class="flex flex-wrap gap-1">${p.impact.changedTaskIds.map((id) => Badge(`↪ ${esc(taskLabel(id))}`)).join("")}</div>` : ""}
      <details class="text-xs text-muted"><summary class="cursor-pointer py-2 font-semibold">ⓘ Why</summary><ul class="list-disc space-y-0.5 pl-5">${p.explanation.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>`;
  }

  // ================================================================== VIEW: shell (bottom bar Today · Record · Plan; slim left rail on desktop)
  const PLAN_TABS = [["timeline", "📅", "Timeline"], ["site", "🗺", "Site"]];
  const MORE_TABS = [["library", "book", "Library"], ["list", "minutes", "Task list"], ["notes", "pen", "Site notes"], ["docs", "file", "Documents"], ["history", "clock", "History"], ["setup", "gear", "Setup"]];

  const SAMPLE_EMAIL = "Von: Stahlhandel Müller\nBetreff: Lieferung Bewehrung Abschnitt C\n\nSehr geehrter Herr Bauer,\nleider können wir den Bewehrungsstahl für Abschnitt C (6,2 t) nicht wie geplant am Freitag liefern. Neuer Liefertermin ist Dienstag. Bitte bestätigen Sie uns kurz.\n\nMit freundlichen Grüßen\nStahlhandel Müller";
  function Shell() {
    const m = me();
    const needs = needsYou().length;
    const view = U.view;
    const title = view === "today" ? "Today" : view === "record" ? "Record" : "Plan";
    const main = { today: Today, record: RecordScreen, plan: Plan }[view]();
    const wide = view === "plan" && ["timeline", "board", "site", "list"].includes(U.planTab);

    return `
    <div class="min-h-screen bg-canvas lg:pl-60">
      <aside class="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-1 bg-[#2e2e30] px-3 py-4 text-white lg:flex">
        <div class="mb-3 flex items-center gap-2 px-2">${LOGO("h-7 w-7")}<span class="font-semibold">Cats Track</span></div>
        <button onclick="A.record()" class="mb-3 flex h-10 items-center gap-2 rounded-full border border-white/25 px-3 text-sm hover:bg-white/10"><span class="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs">+</span>Create note</button>
        ${RailItem(Ic("today", "h-4 w-4"), "Today", view === "today", "A.go('today')", needs)}
        ${RailItem(Ic("plan", "h-4 w-4"), "Plan", view === "plan", "A.go('plan')")}
        <button onclick="A.profile(true)" class="mt-auto flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-white/10" aria-label="Profile">${Avatar(m.id, m.name, 28)}<span class="truncate">${esc(m.name)}</span></button>
      </aside>

      <header class="sticky top-0 z-20 border-b border-line bg-white">
        <div class="flex items-center gap-2.5 px-4 pb-2 pt-3 sm:px-6">
          <span class="lg:hidden">${LOGO("h-8 w-8")}</span>
          <div class="min-w-0 flex-1">
            <h1 class="truncate text-[20px] font-semibold leading-tight text-ink">${title}</h1>
            ${view === "today" ? `<p class="text-xs text-muted">${dayLabel(S.today)} · ${esc(m.name.split(" ")[0])}</p>` : view === "plan" ? `<p class="truncate text-xs text-muted">${esc(S.project.name)}</p>` : ""}
          </div>
          <button onclick="A.profile(true)" class="flex h-10 w-10 items-center justify-center rounded-full lg:hidden" aria-label="Profile">${Avatar(m.id, m.name, 30)}</button>
        </div>
        ${view === "plan" ? PlanTabs() : ""}
      </header>

      <main class="mx-auto ${wide ? "max-w-6xl" : "max-w-xl"} px-3 pb-24 pt-3 sm:px-6 lg:pb-10">
        ${main}
        <p class="mt-8 text-center text-[11px] text-faint">Prototype · drafts aren't legal advice</p>
      </main>

      <nav class="fixed inset-x-0 bottom-0 z-20 grid h-[58px] grid-cols-3 items-center border-t border-line bg-white/95 pb-safe backdrop-blur lg:hidden">
        ${BottomTab("today", "Today", view === "today", "A.go('today')", needs)}
        <div class="flex justify-center"><button onclick="A.record()" aria-label="Record" class="-mt-6 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-md ring-4 ring-white active:scale-95 ${U.capture.listening ? "animate-pulse bg-bad" : "bg-accent"}">${Ic(U.capture.listening ? "stop" : "mic", "h-6 w-6")}</button></div>
        ${BottomTab("plan", "Plan", view === "plan", "A.go('plan')")}
      </nav>

      ${U.profileOpen ? Profile() : ""}
      ${U.moreOpen ? MoreMenu() : ""}
      ${U.openTask ? TaskDrawer() : ""}
      ${U.contractPicker ? ContractPicker() : ""}
      ${U.stepPick !== null && U.capture.draft ? StepPicker() : ""}
      ${U.preview ? Preview() : ""}
      ${U.email.open ? EmailPaste() : ""}
      ${U.logModal ? Modal("📒 Site note", LogCard(S.entries.find((e) => e.id === U.logModal)), "A.closeLog()") : ""}
      ${U.toast ? `<div class="fixed bottom-28 left-1/2 z-[60] -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white shadow-xl lg:bottom-6">${esc(U.toast)}</div>` : ""}
    </div>`;
  }
  const RailItem = (icon, label, active, onclick, count) => `
    <button onclick="${onclick}" class="flex h-9 items-center gap-2 rounded-md px-2 text-sm ${active ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10"}">
      <span class="flex w-5 justify-center">${icon}</span><span class="flex-1 text-left">${label}</span>
      ${count ? `<span class="rounded-full bg-accent px-1.5 text-[11px] text-white">${count}</span>` : ""}
    </button>`;
  const BottomTab = (icon, label, active, onclick, count) => `
    <button onclick="${onclick}" class="relative flex h-full flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium ${active ? "text-ink" : "text-faint"}">
      ${Ic(icon, "h-[22px] w-[22px]")}${label}
      ${count ? `<span class="absolute left-1/2 top-1.5 ml-2 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-white">${count}</span>` : ""}
    </button>`;

  function Profile() {
    return Modal("Acting as", `
      <ul class="space-y-2">${PERSONAS.map((p) => `
        <li><button onclick="A.persona('${p.id}')" class="flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 text-left ${p.id === S.persona ? "border-accent bg-accent-tint" : "border-line"}">
          ${Avatar(p.id, p.name, 36)}<span class="min-w-0 flex-1"><span class="block font-bold">${esc(p.name)}</span><span class="block truncate text-xs text-muted">${esc(p.role.split(" (")[0])}</span></span>${p.id === S.persona ? "✓" : ""}
        </button></li>`).join("")}</ul>
      <div class="mt-4 grid grid-cols-2 gap-2">
        <a href="/platform.html" class="inline-flex min-h-11 items-center justify-center rounded-xl border border-line text-sm font-semibold">ⓘ How it works</a>
        ${Btn("↺ Reset demo", "A.reset()", "secondary")}
      </div>`, "A.profile(false)");
  }

  // ================================================================== VIEW: Today
  function Today() {
    const items = needsYou();
    return `
      ${U.capture.draft ? RecordHero() : ""}
      ${SectionTitle(`Needs you <span class="font-normal text-faint">${items.length}</span>`)}
      ${items.length ? `<ul class="divide-y divide-soft overflow-hidden rounded-lg border border-line bg-white">${items.map(NeedCard).join("")}</ul>` : `<p class="rounded-lg border border-line bg-white px-4 py-5 text-center text-sm text-muted">All clear</p>`}
      ${MyTasks()}
      <div class="mt-5 flex flex-col items-center gap-2">
        ${U.ai.text ? `<div class="w-full whitespace-pre-line rounded-lg border border-line bg-white p-3 text-sm">${esc(U.ai.text)}<p class="mt-1 text-[11px] text-violet-700">${esc(U.ai.note)}</p></div>` : ""}
        ${U.reportMenu ? `<div class="grid w-full grid-cols-2 gap-2">${Btn("Summarise day", "A.summarise()")}${Btn("Daily report", "A.dailyReport()", "primary")}</div>` : ""}
        <button onclick="A.reportMenu()" class="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted hover:bg-soft">${Ic("file", "h-4 w-4")}${U.reportMenu ? "Close" : "End-of-day report"}</button>
      </div>`;
  }

  function RecordHero() {
    const c = U.capture;
    if (c.draft) return `<button onclick="A.go('record')" class="flex h-11 w-full items-center gap-2.5 rounded-full border border-accent bg-accent-tint pl-1.5 pr-4 text-left text-sm"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">${Ic("pen", "h-4 w-4")}</span><span class="flex-1 truncate font-medium">${esc(c.draft.summary)}</span><span class="font-medium text-accent-dark">Save</span></button>`;
    return `
      <section class="flex items-center gap-2">
        <button onclick="A.record()" aria-label="Record note" class="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-line bg-white pl-1.5 pr-4 text-left text-sm text-muted shadow-sm active:bg-canvas">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">${Ic("mic", "h-4 w-4")}</span><span class="truncate">Record a site note…</span>
        </button>
        <div class="relative">
          <button onclick="A.attachMenu('today')" class="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-muted shadow-sm" aria-label="Attach">${Ic("clip", "h-[18px] w-[18px]")}</button>
          ${U.attachMenu === "today" ? AttachMenu() : ""}
        </div>
      </section>`;
  }

  function MilestoneStrip() {
    const sched = schedule(S.tasks);
    const ms = scopeMilestones();
    if (!ms.length) return "";
    return `<div class="mt-3 flex gap-1.5 overflow-x-auto">${milestoneSlips(S.tasks, sched).filter((s) => ms.some((m) => m.id === s.milestone.id)).map((s) => `
      <button onclick="A.go('plan','timeline')" class="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${s.slip ? "bg-bad-soft text-bad" : "bg-ok-soft text-ok"}">
        ◆ ${esc(s.milestone.name.replace(/ complete$/, ""))} · ${s.slip ? `+${s.slip} d` : "on track"} · ${dayLabel(s.milestone.targetDay)}</button>`).join("")}</div>`;
  }

  function MyTasks() {
    const sched = schedule(S.tasks);
    const list = sortTasks(S.tasks.filter((t) => t.status !== "done")
      .filter((t) => (isSM() ? sched[t.id].es <= S.today + 2 && sched[t.id].ef >= S.today : t.team === S.persona)), sched);
    return `${SectionTitle(isSM() ? `On site (${list.length})` : `My tasks (${list.length})`)}
      <ul class="divide-y divide-soft rounded-lg border border-line bg-white px-3">${list.map((t) => TaskRow(t, sched)).join("") || `<li class="py-4 text-center text-sm text-muted">Nothing open</li>`}</ul>`;
  }
  const TaskRow = (t, sched, link) => {
    const f = PERSONAS.find((p) => p.team === t.team);
    return `<li><div role="button" tabindex="0" onclick="A.openTask('${t.id}')" class="flex min-h-[52px] cursor-pointer items-center gap-3 py-2 ${link ? "opacity-60" : ""}">
      ${CheckCircle(t.status === "done", `A.toggleDone('${t.id}')`, !canEdit(t))}
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium ${t.status === "done" ? "text-faint line-through" : "text-ink"}">${esc(t.name)} ${esc(t.section)}${t.milestone ? ` <span class="text-warn">◆</span>` : ""}</span>
        <span class="mt-0.5 flex flex-wrap items-center gap-1">${StatusChips(t, false)}${link ? Badge(`🔗 ${link}`) : ""}${MissingChip(t)}
          <span class="text-xs ${isOverdue(t) ? "text-bad" : "text-muted"}">${dayShort(sched[t.id].es).wd}–${dayLabel(sched[t.id].ef)}</span></span>
      </span>
      ${Avatar(f.id, f.name, 24)}
    </div></li>`;
  };

  // ================================================================== VIEW: Record (confirmation card instead of a form)
  const KIND_VERB = { task: "To-do for", notify: "Inform", contact: "Contact", remind: "Remind", other: "Check:" };
  const KIND_ICON = { task: "✔︎", notify: "📣", contact: "📞", remind: "⏰", other: "•" };
  const KINDS = [["task", "✔︎ To-do"], ["notify", "📣 Inform"], ["contact", "📞 Contact"], ["remind", "⏰ Remind"], ["other", "• Other"]];
  const ENTRY_TYPES = ["stoppage", "delivery", "defect", "incident", "meeting", "attendance", "progress", "instruction", "note"];
  const PARTIES = ["Client (Bauherr)", "Own company", "Supplier", "Weather", "Other subcontractor"];
  const fieldLabel = (m) => ({ startTime: "Start time", responsibleParty: "Responsible", estimatedDelayDays: "Delay (days)", cause: "Cause", material: "Material", quantity: "Quantity" })[m] ?? m;

  function AttachMenu() {
    const row = "flex h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left text-sm text-ink hover:bg-canvas";
    const icon = (n) => `<span class="text-muted">${Ic(n, "h-[18px] w-[18px]")}</span>`;
    return `
      <div class="fixed inset-0 z-30" onclick="A.attachMenu(null)"></div>
      <div class="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg border border-line bg-white p-1.5 shadow-lg">
        <label class="${row}">${icon("file")}PDF<input type="file" accept="application/pdf,.pdf" class="hidden" onchange="A.attachFile(this,'pdf')"></label>
        <label class="${row}">${icon("photo")}Photo<input type="file" accept="image/*" class="hidden" onchange="A.attachFile(this,'photo')"></label>
        <button onclick="A.contractPicker(true)" class="${row}">${icon("contract")}Contract</button>
        <div class="my-1 border-t border-soft"></div>
        <button onclick="A.fromMinutes()" class="${row}">${icon("minutes")}Meeting minutes</button>
        <button onclick="A.emailOpen(true)" class="${row}">${icon("mail")}Paste email</button>
      </div>`;
  }
  function EmailPaste() {
    return Modal("Paste email", `
      <textarea class="${inputCls} min-h-48 text-sm" placeholder="Paste the email here" oninput="U.email.text=this.value">${esc(U.email.text)}</textarea>
      <div class="mt-2 grid grid-cols-[1fr_auto] gap-2">${Btn("Sort it", "A.emailSort()", "primary", "", "w-full")}${Btn("Sample", "A.emailSample()", "secondary")}</div>
      <p class="mt-2 text-xs text-muted">Becomes one card: summary, open items with owner and deadline, and a reply or notice if it reports a deviation.</p>`, "A.emailOpen(false)");
  }
  function ContractPicker() {
    const q = U.contractPicker.q.trim().toLowerCase();
    const all = [...S.siteDocs, ...SITE_DOCUMENTS];
    const docs = all.filter((d) => !q || `${d.name} ${d.kind} ${d.note}`.toLowerCase().includes(q)).sort((a, b) => (b.kind === "Contract") - (a.kind === "Contract"));
    return Modal("📑 Contract", `
      <input id="contract-search" class="${inputCls}" placeholder="🔍 Search" value="${esc(U.contractPicker.q)}" oninput="A.contractSearch(this.value)">
      <ul class="mt-3 space-y-2">${docs.map((d) => `
        <li><button onclick="A.pickContract(${all.indexOf(d)})" class="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line px-3 py-2 text-left hover:bg-canvas">
          <span class="text-xl">${d.kind === "Contract" ? "📑" : /\.xlsx$/.test(d.name) ? "📊" : "📄"}</span>
          <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">${esc(d.name)}</span><span class="text-xs text-muted">${esc(d.kind)}${d.pages ? ` · ${d.pages} p.` : ""}</span></span>
        </button></li>`).join("") || `<li class="py-4 text-center text-sm text-muted">—</li>`}</ul>
      <label class="mt-3 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-white">⬆ Upload
        <input type="file" accept="application/pdf,.pdf,.doc,.docx" class="hidden" onchange="A.attachFile(this,'contract')"></label>`, "A.contractPicker(false)");
  }
  function Preview() {
    const a = U.preview, url = attUrl(a);
    const body = a.kind === "photo" && url ? `<img src="${url}" alt="" class="w-full rounded-lg">`
      : a.kind === "pdf" && url ? `<iframe src="${url}" class="h-[65vh] w-full rounded-lg border border-line" title="${esc(a.name)}"></iframe>`
      : `<div class="flex flex-col items-center gap-2 rounded-lg bg-canvas p-8 text-center"><span class="text-5xl">${ATT_ICON[a.kind]}</span>
          <p class="font-semibold">${esc(a.name)}</p>${a.docKind ? Badge(esc(a.docKind)) : ""}${a.session && !url ? Badge("not in this session", "amber") : ""}
          ${url ? `<a href="${url}" target="_blank" rel="noopener" class="mt-2 inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-semibold text-white">Open</a>` : ""}</div>`;
    return Modal(`${ATT_ICON[a.kind]} ${esc(a.name)}`, body, "A.closePreview()");
  }
  function StepPicker() {
    const i = U.stepPick, st = U.capture.draft.nextSteps[i];
    const days = [...Array.from({ length: 6 }, (_, k) => S.today + k), ...(st.dueDay > S.today + 5 ? [st.dueDay] : [])];
    return Modal(`${KIND_ICON[st.kind]} ${esc(st.text || "Step")}`, `
      <p class="mb-1 text-xs font-bold uppercase text-muted">Who</p>
      <div class="grid grid-cols-2 gap-2">${S.contacts.map((c) => `
        <button onclick="A.step(${i},'who','${c.id}')" class="flex min-h-12 items-center gap-2 rounded-xl border px-2 text-left text-sm font-semibold ${st.who === c.id ? "border-accent bg-accent-tint" : "border-line"}">${Avatar(c.id, c.name, 26)}<span class="truncate">${esc(shortName(c.id))}</span></button>`).join("")}</div>
      <p class="mb-1 mt-4 text-xs font-bold uppercase text-muted">When</p>
      <div class="flex flex-wrap gap-2">${days.map((d) => chipBtn(shortDay(d), `A.step(${i},'dueDay',${d})`, st.dueDay === d)).join("")}${chipBtn("—", `A.step(${i},'dueDay','')`, st.dueDay === undefined)}</div>
      <div class="mt-4 grid grid-cols-[1fr_auto] gap-2">${Btn("✓ Done", "A.closePick()", "primary", "", "w-full")}${Btn("🗑", `A.removeStep(${i})`, "secondary", 'aria-label="Remove step"')}</div>`, "A.closePick()");
  }

  function RecordScreen() {
    const c = U.capture, d = c.draft;
    const langSwitch = `<div class="flex rounded-full bg-soft p-0.5 text-xs font-medium">${["de-DE", "en-US"].map((l) => `<button onclick="A.lang('${l}')" class="h-7 rounded-full px-3 ${c.lang === l ? "bg-white text-ink shadow-sm" : "text-muted"}">${l === "de-DE" ? "DE" : "EN"}</button>`).join("")}</div>`;
    const atts = c.attachments.length ? `<div class="flex flex-wrap gap-2">${c.attachments.map((a, i) => AttachChip(a, `A.previewCapture(${i})`, `A.removeAttachment(${i})`)).join("")}</div>` : "";
    if (d) return ConfirmCard(atts);
    const samples = SAMPLE_PHRASES.map((s, i) => ({ ...s, i })).filter((s) => isSM() || s.persona === S.persona || s.persona === "site-manager");
    const recent = S.entries.filter((e) => e.day === S.today).slice(0, 3);
    const wave = [10, 18, 28, 16, 24, 12, 20, 30, 14, 22, 10];
    const tip = (icon, text) => `<li class="flex items-center gap-3 py-2"><span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent-dark">${Ic(icon, "h-3.5 w-3.5")}</span><span class="text-sm text-ink">${text}</span></li>`;
    return `
      <section class="overflow-hidden rounded-xl border border-line bg-white">
        <div class="flex items-start justify-between px-4 pt-4">
          <div><h2 class="text-[15px] font-semibold text-ink">New site note</h2><p class="text-xs text-muted">${esc(S.project.name)} · ${dayLabel(S.today)}</p></div>
          ${langSwitch}
        </div>
        <div class="relative flex flex-col items-center px-4 pb-6 pt-6" style="background:radial-gradient(circle at 50% 42%, #fde3e3 0, rgba(253,227,227,0) 58%)">
          <div class="flex items-center gap-6">
            <span class="h-11 w-11"></span>
            <button onclick="A.mic()" aria-label="Record" class="flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg ring-8 ring-white transition active:scale-95 ${c.listening ? "animate-pulse bg-bad" : "bg-accent"}">${Ic(c.listening ? "stop" : "mic", "h-10 w-10")}</button>
            <div class="relative">
              <button onclick="A.attachMenu('record')" class="relative flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-muted shadow-sm active:scale-95" aria-label="Attach">${Ic("clip", "h-[18px] w-[18px]")}${c.attachments.length ? `<span class="absolute -right-1 -top-1 min-w-4 rounded-full bg-ink px-1 text-[10px] font-semibold leading-4 text-white">${c.attachments.length}</span>` : ""}</button>
              ${U.attachMenu === "record" ? AttachMenu() : ""}
            </div>
          </div>
          <div class="mt-4 flex h-8 items-end gap-1">${wave.map((h, k) => `<span class="w-1 rounded-full ${c.listening ? "animate-pulse bg-accent" : "bg-line"}" style="height:${c.listening ? h : Math.max(4, h / 3)}px;animation-delay:${k * 90}ms"></span>`).join("")}</div>
          <p class="mt-2 text-sm font-medium text-ink">${c.sorting ? "Sorting…" : c.listening ? "Listening…" : "Tap to speak"}</p>
          <p class="text-xs text-muted">${c.listening ? "Tap again to stop. It sorts itself." : "Stop when you're done. It sorts itself."}</p>
          ${atts ? `<div class="mt-3 w-full">${atts}</div>` : ""}
        </div>
        <div class="relative border-t border-soft">
          <textarea id="capture-text" rows="2" oninput="U.capture.text=this.value" onkeydown="A.typedKey(event)" class="block w-full resize-none border-0 bg-transparent px-4 py-3 pr-14 text-[15px] text-ink placeholder:text-faint focus:outline-none" placeholder="${c.lang === "de-DE" ? "…oder tippen" : "…or type it"}">${esc(c.text)}</textarea>
          <button onclick="A.typedDone(document.getElementById('capture-text').value)" aria-label="Sort note" class="absolute bottom-2.5 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white">${Ic("up", "h-4 w-4")}</button>
        </div>
      </section>

      ${recent.length ? `${SectionTitle(`Today's notes <span class="font-normal text-faint">${S.entries.filter((e) => e.day === S.today).length}</span>`)}
      <ul class="divide-y divide-soft overflow-hidden rounded-lg border border-line bg-white">${recent.map((e) => `
        <li><button onclick="A.openLog('${e.id}')" class="flex w-full items-center gap-3 px-3 py-2.5 text-left">
          <span class="h-2 w-2 shrink-0 rounded-full ${isProblem(e) ? "bg-bad" : "bg-line"}"></span>
          <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-ink">${esc(e.summary)}</span><span class="block truncate text-xs text-muted">${esc(TYPE_LABEL[e.type] ?? e.type)}${e.location ? ` · ${esc(e.location)}` : ""}</span></span>
        </button></li>`).join("")}</ul>` : `
      ${SectionTitle("Say it like this")}
      <div class="rounded-lg border border-line bg-white px-3 py-1">
        <ul class="divide-y divide-soft">
          ${tip("pin", "Where: task, section, floor")}
          ${tip("clock", "What happened, and since when")}
          ${tip("user", "Who has to act, and by when")}
        </ul>
        <p class="border-t border-soft py-2.5 text-xs italic text-muted">„Bagger steht seit 10 Uhr in Abschnitt C, der Leitungsplan fehlt.“</p>
      </div>`}

      <div class="mt-6 flex items-center justify-between px-0.5">
        <h2 class="text-[15px] font-semibold text-ink">Demo phrases</h2>
        <button onclick="A.demo()" role="switch" aria-checked="${U.demo}" aria-label="Demo phrases" class="relative h-6 w-10 rounded-full transition ${U.demo ? "bg-accent" : "bg-line"}"><span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${U.demo ? "left-[18px]" : "left-0.5"}"></span></button>
      </div>
      ${U.demo ? `<ul class="mt-1.5 divide-y divide-soft overflow-hidden rounded-lg border border-line bg-white">${samples.map((p) => `
        <li><button onclick="A.sample(${p.i})" class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-ink hover:bg-canvas"><span class="text-faint">${Ic("mic", "h-4 w-4")}</span><span class="flex-1">${esc(p.label)}</span><span class="text-faint">${Ic("chev", "h-4 w-4")}</span></button></li>`).join("")}</ul>` : ""}`;
  }

  function ConfirmCard(atts) {
    const c = U.capture, d = c.draft;
    const t = S.tasks.find((x) => x.id === d.fields.taskId);
    const prob = isProblem(d), delay = Number(d.fields.estimatedDelayDays ?? 0);
    const dot = prob ? "🔴" : delay ? "🟠" : "⚪";
    const head = [TYPE_LABEL[d.type], t ? `${t.name} ${t.section}` : null, d.location && !(t && d.location === `Section ${t.section}`) ? d.location : null, d.fields.startTime ? `since ${d.fields.startTime}` : null].filter(Boolean);
    const resp = d.fields.responsibleParty ? ` (${String(d.fields.responsibleParty).split(" (")[0].toLowerCase()})` : "";
    const steps = d.nextSteps ?? [];
    const ext = steps.filter((st) => ["notify", "contact", "task"].includes(st.kind) && S.contacts.find((x) => x.id === st.who && !x.usesApp));
    const ask = d.ask === "delay" ? `<p class="text-sm font-bold">❓ How long?</p><div class="mt-2 flex flex-wrap gap-2">${[1, 2, 3].map((n) => `<button onclick="A.answer('estimatedDelayDays',${n})" class="h-8 rounded-full border border-warn bg-white px-3 text-[13px] font-medium">${n} day${n > 1 ? "s" : ""}</button>`).join("")}</div>`
      : d.ask === "responsible" ? `<p class="text-sm font-bold">❓ Who caused it?</p><div class="mt-2 flex flex-wrap gap-2">${PARTIES.map((p) => `<button onclick="A.answer('responsibleParty','${p}')" class="h-8 rounded-full border border-warn bg-white px-3 text-[13px] font-medium">${p.split(" (")[0]}</button>`).join("")}</div>`
      : d.ask === "task" ? `<p class="text-sm font-bold">❓ Which task?</p><div class="mt-2 flex flex-wrap gap-2">${S.tasks.filter((x) => x.status !== "done" && (isSM() || x.team === S.persona)).slice(0, 6).map((x) => `<button onclick="A.answer('taskId','${x.id}')" class="h-8 rounded-full border border-warn bg-white px-3 text-[13px] font-medium">${esc(x.name)} ${esc(x.section)}</button>`).join("")}</div>`
      : "";
    const stepChip = (st, i) => `
      <button onclick="A.pickStep(${i})" class="inline-flex min-h-8 items-center gap-1.5 rounded-full border ${st.source === "ai" ? "border-violet-300 bg-violet-50" : "border-line bg-white"} px-3 text-left text-[13px] font-medium">
        → ${KIND_VERB[st.kind]} ${st.who ? esc(shortName(st.who)) : "?"}${st.dueDay !== undefined ? `, ${shortDay(st.dueDay)}` : ""}
        ${st.source === "ai" ? `<span class="rounded bg-violet-600 px-1 text-[10px] font-semibold text-white">AI</span>` : st.source === "user" ? `<span class="rounded bg-warn px-1 text-[10px] font-semibold text-white">YOU</span>` : ""}
      </button>`;
    const detailKeys = ["cause", "responsibleParty", "startTime", "estimatedDelayDays", "material", "quantity"];
    return `
      <section class="rounded-lg border ${prob ? "border-bad/40 border-l-4 border-l-bad" : "border-line"} bg-white p-4">
        <p class="text-[15px] font-semibold leading-snug">${head.map(esc).join(" · ")}</p>
        ${d.fields.cause ? `<p class="mt-1 text-sm text-ink">Cause: ${esc(d.fields.cause)}${esc(resp)}</p>` : ""}
        <div class="mt-2 flex flex-wrap gap-1">${delay ? DelayChip(delay) : ""}${ext.length ? Badge(`✉ ${ext.length} update${ext.length > 1 ? "s" : ""}`, "blue") : ""}${t && delay && d.type !== "stoppage" ? Badge("📅 → site manager", "amber") : ""}</div>
        ${steps.length ? `<p class="mt-3 text-xs font-bold uppercase text-muted">Next</p><div class="mt-1 flex flex-wrap gap-2">${steps.map(stepChip).join("")}</div>` : ""}
        ${ask ? `<div class="mt-3 rounded-lg bg-warn-soft p-3">${ask}</div>` : ""}
        ${atts ? `<div class="mt-3">${atts}</div>` : ""}
        <div class="mt-4 grid grid-cols-[1fr_auto] gap-2">${Btn("Save", "A.saveLog()", "primary", "", "w-full")}${Btn(U.details ? "▲" : "Edit details", "A.details()", "secondary")}</div>
        ${U.details ? `
        <div class="mt-4 space-y-3 border-t-2 border-soft pt-4">
          ${Field("🗣 Words", `<textarea class="${inputCls}" rows="2" oninput="U.capture.text=this.value">${esc(c.text)}</textarea>`)}
          <div class="grid grid-cols-2 gap-2">${Btn("↻ Sort again", "A.structure()", "secondary", "", "w-full")}${Btn("🗑 Discard", "A.discard()", "ghost", "", "w-full")}</div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            ${Field("Type", `<select class="${inputCls}" onchange="A.setDraft('type', this.value, true)">${options(ENTRY_TYPES.map((x) => [x, x]), d.type)}</select>`)}
            ${Field("Task", `<select class="${inputCls}" onchange="A.setField('taskId', this.value)">${options([["", "—"], ...S.tasks.map((x) => [x.id, `${x.id} · ${x.name} ${x.section}`])], d.fields.taskId)}</select>`)}
          </div>
          ${Field("Summary", `<input class="${inputCls}" value="${esc(d.summary)}" oninput="A.setDraft('summary', this.value)">`)}
          ${Field("📍 Location", `<input class="${inputCls}" value="${esc(d.location)}" oninput="A.setDraft('location', this.value)" onchange="A.setDraft('location', this.value, true)">`)}
          ${Field("Current state", `<textarea class="${inputCls}" rows="2" oninput="A.setDraft('state', this.value)">${esc(d.state ?? d.summary)}</textarea>`)}
          <div class="grid grid-cols-2 gap-3">${detailKeys.map((k) => Field(fieldLabel(k), `<input class="${inputCls}" type="${k === "estimatedDelayDays" ? "number" : "text"}" ${k === "estimatedDelayDays" ? 'min="1"' : ""} value="${esc(d.fields[k])}" onchange="A.setField('${k}', this.value)">`)).join("")}</div>
          <div>
            <p class="mb-1 text-xs font-semibold text-muted">Next steps</p>
            <ul class="space-y-2">${steps.map((st, i) => `<li class="grid grid-cols-[8rem_1fr] gap-2">
              <select class="${inputCls}" onchange="A.step(${i},'kind',this.value)">${options(KINDS, st.kind)}</select>
              <input class="${inputCls}" value="${esc(st.text)}" placeholder="What?" oninput="A.step(${i},'text',this.value,false)"></li>`).join("")}</ul>
            ${Btn("+ Step", "A.addStep()", "ghost", "", "mt-1")}
          </div>
        </div>` : ""}
      </section>`;
  }

  // ================================================================== VIEW: Plan (Timeline · Board · Site · More)
  function PlanTabs() {
    const more = MORE_TABS.find(([id]) => id === U.planTab);
    const tab = (on, label, call) => `<button onclick="${call}" class="relative flex-1 pb-3 pt-1.5 text-center text-sm ${on ? "font-semibold text-ink" : "text-muted"}">${label}${on ? '<span class="absolute inset-x-3 bottom-0 h-0.5 rounded bg-accent"></span>' : ""}</button>`;
    return `<div class="flex px-2 sm:px-4">
      ${PLAN_TABS.map(([id, , label]) => tab(U.planTab === id, label, `A.planTab('${id}')`)).join("")}
      ${tab(!!more, more ? more[2] : "More", "A.more(true)")}
    </div>`;
  }
  function MoreMenu() {
    const drafts = S.notices.filter((n) => n.status === "draft").length;
    return Modal("More", `<ul class="divide-y divide-soft overflow-hidden rounded-lg border border-line">${MORE_TABS.map(([id, icon, label]) => `
      <li><button onclick="A.planTab('${id}')" class="flex h-12 w-full items-center gap-3 px-3 text-left text-sm ${U.planTab === id ? "bg-accent-tint font-medium text-ink" : "text-ink hover:bg-canvas"}">
        <span class="text-muted">${Ic(icon, "h-[18px] w-[18px]")}</span><span class="flex-1">${label}</span>
        ${id === "docs" && drafts ? `<span class="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">${drafts}</span>` : ""}
        <span class="text-faint">${Ic("chev", "h-4 w-4")}</span></button></li>`).join("")}</ul>`, "A.more(false)");
  }
  function Plan() {
    return ({ timeline: Timeline, board: Board, site: SiteView, library: Library, list: TaskList, notes: Notes, docs: Documents, history: History, setup: Setup })[U.planTab]();
  }

  function ScopeBar() {
    if (!isSM()) return `<div class="mb-3 flex flex-wrap gap-1">${Badge(`👤 ${esc(TEAMS.find((t) => t.id === S.persona).name)}`, "accent")}${Badge("🔗 linked · read-only")}</div>`;
    return `<div class="mb-3 flex w-full gap-1 rounded-lg bg-soft p-1 text-sm">${[["all", "All"], ["mine", "Mine"]].map(([k, l]) => `<button onclick="A.scope('${k}')" class="h-9 flex-1 rounded-md ${U.scope === k ? "bg-white font-semibold text-ink shadow-sm" : "text-muted"}">${l}</button>`).join("")}</div>`;
  }

  // ---- Task list (Plan › More)
  function TaskList() {
    const sched = schedule(S.tasks);
    const { own, related, link } = isSM() ? { own: S.tasks, related: [], link: {} } : scopeTasks();
    const pool = [...own, ...related];
    return `${isSM() ? "" : ScopeBar()}
    <div class="space-y-3">${TEAMS.filter((tm) => pool.some((t) => t.team === tm.id)).map((team) => {
      const list = sortTasks(pool.filter((t) => t.team === team.id), sched);
      const col = U.collapsed[team.id];
      const od = list.filter(isOverdue).length;
      return `<section class="rounded-lg border border-line bg-white px-4">
        <button onclick="A.collapse('${team.id}')" class="flex min-h-12 w-full items-center gap-2 text-left">
          <span class="h-3 w-3 rounded-full" style="background:${team.color}"></span><span class="flex-1 text-base font-bold">${team.name}</span>
          ${od ? Badge(`⏰ ${od}`, "overdue") : ""}${S.persona === team.id ? Badge("you", "accent") : ""}${Badge(String(list.length))}
          <span class="text-muted transition ${col ? "-rotate-90" : ""}">▾</span>
        </button>
        ${col ? "" : `<ul class="divide-y divide-soft border-t border-soft">${list.map((t) => TaskRow(t, sched, link[t.id])).join("")}</ul>`}
      </section>`;
    }).join("")}</div>`;
  }

  // ---- Board
  function Board() {
    const COLS = [["planned", "Planned", "#71717a"], ["in-progress", "Active", "#0e7490"], ["blocked", "Blocked", "#18181b"], ["done", "Done", "#15803d"]];
    const sched = schedule(S.tasks);
    const { own, related, link } = scopeTasks();
    const pool = [...own, ...related];
    return `${ScopeBar()}
    <div class="grid gap-3 lg:grid-cols-4">
      ${COLS.map(([status, label, dot]) => {
        const list = sortTasks(pool.filter((t) => t.status === status), sched);
        return `<div data-col="${status}" ondragover="A.dragOver(event,'${status}')" ondrop="event.preventDefault();A.drop('${status}')" class="rounded-lg bg-soft p-2 ring-sel/40 transition">
          <p class="flex min-h-10 items-center gap-2 px-2 text-sm font-bold"><span class="h-3 w-3 rounded-full" style="background:${dot}"></span>${label} ${Badge(String(list.length), "outline")}</p>
          <div class="space-y-2">${list.map((t) => {
            const team = TEAMS.find((x) => x.id === t.team), f = PERSONAS.find((p) => p.team === t.team), s = sched[t.id];
            const ed = canEdit(t), od = isOverdue(t), lk = link[t.id];
            return `<div ${ed ? `draggable="true" ondragstart="A.dragStart(event,'${t.id}')"` : ""} role="button" tabindex="0" onclick="A.openTask('${t.id}')"
              class="cursor-pointer rounded-lg border ${od ? "border-bad" : "border-line"} bg-white p-3 ${lk ? "opacity-60" : ""}">
              <div class="flex items-start gap-3">${CheckCircle(t.status === "done", `A.toggleDone('${t.id}')`, !ed)}
                <p class="flex-1 text-sm font-bold leading-snug ${t.status === "done" ? "text-faint line-through" : ""}">${esc(t.name)} ${esc(t.section)}</p>${Avatar(f.id, f.name, 28)}</div>
              <div class="mt-2 flex flex-wrap items-center gap-1">
                <span class="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style="background:${team.color}">${team.name}</span>
                ${Badge(`👷 ${t.crew}`, "outline")}${od ? OverdueChip() : ""}${t.delayDays ? DelayChip(t.delayDays) : ""}${MissingChip(t)}${lk ? Badge(`🔗 ${lk}`) : ""}
                <span class="ml-auto text-xs font-semibold ${od ? "text-bad" : "text-muted"}">${dayLabel(s.ef)}</span>
              </div>
              ${ed ? `<select aria-label="Move to" onclick="event.stopPropagation()" onchange="A.boardMove('${t.id}', this.value)" class="${inputCls} mt-2 lg:hidden">${options(COLS.map(([s2, l]) => [s2, `→ ${l}`]), t.status)}</select>` : ""}
            </div>`;
          }).join("") || `<p class="py-3 text-center text-xs text-faint">—</p>`}</div>
        </div>`;
      }).join("")}
    </div>`;
  }

  // ---- Timeline
  function Timeline() {
    const sched = schedule(S.tasks);
    const N = 5, wk = U.week ?? Math.floor(S.today / 5), w0 = wk * N, w1 = w0 + N - 1;
    const DAYS = Array.from({ length: N }, (_, k) => w0 + k);
    const { own, related, link } = scopeTasks();
    const pool = [...own, ...related].filter((t) => sched[t.id].ef >= w0 && sched[t.id].es <= w1);
    const ms = scopeMilestones();
    const slips = milestoneSlips(S.tasks, sched).filter((x) => ms.some((m) => m.id === x.milestone.id));
    const pct = (d) => ((d - w0) / N) * 100;
    const todayCol = S.today < w0 || S.today > w1 ? "" : `<span class="absolute inset-y-0 bg-accent/10" style="left:${pct(S.today)}%;width:${100 / N}%"></span>`;
    const dayHead = `<div class="grid grid-cols-5 px-3 pb-2 pt-1 text-center">${DAYS.map((d) => {
      const x = dayShort(d), on = d === S.today;
      return `<div class="flex flex-col items-center leading-tight"><span class="text-[10px] uppercase ${on ? "font-semibold text-accent-dark" : "text-faint"}">${x.wd.slice(0, 2)}</span><span class="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs ${on ? "bg-accent font-semibold text-white" : "text-ink"}">${x.date.split(".")[0]}</span></div>`;
    }).join("")}</div>`;
    const row = (t, team) => {
      const sc = sched[t.id], od = isOverdue(t), lk = link[t.id], miss = missingCount(t);
      const len = sc.ef - sc.es + 1, base = Math.min(len, t.duration), delay = Math.max(0, len - base);
      const vs = Math.max(sc.es, w0), ve = Math.min(sc.ef, w1), be = sc.es + base - 1, vlen = ve - vs + 1;
      const vBase = Math.max(0, Math.min(ve, be) - vs + 1), vDelay = Math.max(0, ve - Math.max(vs, be + 1) + 1);
      const edge = t.status === "blocked" ? "outline outline-2 outline-ink" : od ? "outline outline-2 outline-bad" : "";
      const meta = [od ? '<span class="text-bad">Overdue</span>' : "", t.status === "blocked" ? '<span class="text-ink">Blocked</span>' : "", miss ? `<span class="text-warn">${miss} missing</span>` : "", delay ? `<span class="text-warn">+${delay} d</span>` : "", `${t.crew} crew`].filter(Boolean).join(" · ");
      return `<button onclick="A.openTask('${t.id}')" class="block w-full px-3 py-2 text-left hover:bg-canvas ${lk ? "opacity-50" : ""}" title="${lk ? esc(lk) : ""}">
        <div class="flex items-baseline gap-2"><span class="min-w-0 flex-1 truncate text-[13px] font-medium ${t.status === "done" ? "text-faint line-through" : "text-ink"}">${esc(t.name)} ${esc(t.section)}${t.milestone ? ' <span class="text-warn">◆</span>' : ""}</span><span class="shrink-0 text-[11px] text-muted">${meta}</span></div>
        <div class="relative mt-1.5 h-2.5 rounded-full bg-soft">${todayCol}
          <span class="absolute inset-y-0 flex overflow-hidden rounded-full ${edge} ${t.status === "done" ? "opacity-40" : ""}" style="left:${pct(vs)}%;width:${(vlen / N) * 100}%">
            <span class="h-full" style="width:${(vBase / vlen) * 100}%;background:${team.color}"></span>
            ${vDelay ? `<span class="h-full flex-1" style="background:repeating-linear-gradient(45deg,#f59e0b,#f59e0b 3px,#fde68a 3px,#fde68a 6px)"></span>` : ""}
          </span>
        </div>
      </button>`;
    };
    return `${ScopeBar()}
    ${slips.length ? `<div class="mb-2 flex gap-1.5 overflow-x-auto">${slips.map((x) => `<span class="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${x.slip ? "bg-bad-soft text-bad" : "bg-ok-soft text-ok"}">◆ ${esc(x.milestone.name.replace(/ complete$/, ""))} · ${x.slip ? `+${x.slip} d` : "on track"} · ${dayShort(x.milestone.targetDay).wd}</span>`).join("")}</div>` : ""}
    <section class="overflow-hidden rounded-lg border border-line bg-white">
      <div class="flex items-center justify-between px-2 pt-2">
        <button onclick="A.week(-1)" ${wk === 0 ? "disabled" : ""} aria-label="Previous week" class="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-soft disabled:opacity-30"><span class="rotate-180">${Ic("chev", "h-5 w-5")}</span></button>
        <div class="text-center"><p class="text-sm font-semibold text-ink">${wk === Math.floor(S.today / 5) ? "This week" : wk > Math.floor(S.today / 5) ? "Next week" : "Last week"}</p><p class="text-xs text-muted">${dayLabel(w0)} – ${dayLabel(w1)}</p></div>
        <button onclick="A.week(1)" ${wk === 1 ? "disabled" : ""} aria-label="Next week" class="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-soft disabled:opacity-30">${Ic("chev", "h-5 w-5")}</button>
      </div>
      <div class="border-b border-soft bg-white">${dayHead}</div>
      ${TEAMS.filter((team) => pool.some((t) => t.team === team.id)).map((team) => {
        const list = pool.filter((t) => t.team === team.id).sort((a, b) => sched[a.id].es - sched[b.id].es);
        return `<div class="border-b border-soft last:border-0">
          <div class="flex items-center gap-2 bg-canvas px-3 py-1.5 text-xs font-semibold text-ink"><span class="h-2.5 w-2.5 rounded-full" style="background:${team.color}"></span>${team.name}<span class="font-normal text-faint">${list.length}</span>${S.persona === team.id ? '<span class="ml-auto rounded bg-accent-soft px-1.5 text-[10px] font-medium text-accent-dark">you</span>' : ""}</div>
          <div class="divide-y divide-soft">${list.map((t) => row(t, team)).join("")}</div>
        </div>`;
      }).join("")}
    </section>
    <p class="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span class="flex items-center gap-1"><span class="inline-block h-2 w-4 rounded-full" style="background:repeating-linear-gradient(45deg,#f59e0b,#f59e0b 3px,#fde68a 3px,#fde68a 6px)"></span>Delay</span>
      <span class="flex items-center gap-1"><span class="inline-block h-2 w-4 rounded-full bg-soft outline outline-2 outline-ink"></span>Blocked</span>
      <span class="flex items-center gap-1"><span class="inline-block h-2 w-4 rounded-full bg-soft outline outline-2 outline-bad"></span>Overdue</span>
      <span class="text-warn">◆ Milestone</span>
    </p>`;
  }

    // ---- Site view (drawn site plan + building by section and level)
  function SiteView() {
    const sched = schedule(S.tasks);
    const { own, related, link } = scopeTasks();
    const pool = isSM() ? S.tasks : [...own, ...related];
    const sections = [...new Set(pool.map((t) => t.section).filter(Boolean))].sort();
    const keyOf = (t) => t.section || "Site";
    const entries = S.entries.filter((e) => isSM() || pool.some((t) => t.id === e.fields?.taskId) || e.author === S.persona);
    const sel = U.site.section;
    const C = { problem: "#b91c1c", overdue: "#b91c1c", blocked: "#1e1f21", delay: "#d97706" };
    const stats = (key) => {
      const ts = pool.filter((t) => keyOf(t) === key);
      const open = ts.filter((t) => t.status !== "done");
      return {
        ts, open: open.length,
        problem: entries.filter((e) => isProblem(e) && (sectionOfEntry(e) || "Site") === key).length,
        overdue: ts.filter(isOverdue).length,
        blocked: ts.filter((t) => t.status === "blocked").length,
        delay: open.filter((t) => t.delayDays > 0).length,
        missing: open.filter((t) => missingCount(t)).length,
        done: ts.length && ts.every((t) => t.status === "done"),
      };
    };
    const look = (st) => st.problem || st.overdue ? { fill: "#fdecec", stroke: "#e5a3a3", dot: C.problem }
      : st.blocked ? { fill: "#f1f1f1", stroke: "#9ca0a4", dot: C.blocked }
      : st.delay ? { fill: "#fff6e5", stroke: "#f0c77a", dot: C.delay }
      : st.done ? { fill: "#e9f7ee", stroke: "#9fd5b1", dot: null } : { fill: "#ffffff", stroke: "#d6d6d6", dot: null };
    const flags = (st) => st.problem + st.overdue + st.blocked + st.delay;
    const metaOf = (st) => [`${st.open} open`, st.problem ? `<span class="text-bad">${st.problem} problem${st.problem > 1 ? "s" : ""}</span>` : "", st.overdue ? `<span class="text-bad">${st.overdue} overdue</span>` : "",
      st.blocked ? `<span class="text-ink">${st.blocked} blocked</span>` : "", st.delay ? `<span class="text-warn">${st.delay} delayed</span>` : "", st.missing ? `${st.missing} missing item${st.missing > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");

    // ---- drawn site plan: building sections across the full width, site facilities in a row below
    const W = 360, H = 250, bx = 20, bw = 320, by = 24, bh = 112;
    const sw = sections.length ? bw / sections.length : bw;
    const badge = (x, y, n, color) => n ? `<g><circle cx="${x}" cy="${y}" r="8.5" fill="${color}" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y + 3.3}" font-size="9.5" font-weight="600" text-anchor="middle" fill="#fff">${n}</text></g>` : "";
    const site = stats("Site"), siteLook = look(site);
    const label = (x, y, t, anchor = "middle") => `<text x="${x}" y="${y}" font-size="8.5" text-anchor="${anchor}" fill="#8a8d90" letter-spacing=".2">${t}</text>`;
    const fy = by + bh + 14, fh = 38, road = H - 36;
    const plan = `
      <svg viewBox="0 0 ${W} ${H}" class="block w-full" role="img" aria-label="Site plan">
        <defs>
          <pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="#e6e6e6"/></pattern>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f4f4f4"/><line x1="0" y1="0" x2="0" y2="6" stroke="#e2e2e2" stroke-width="2"/></pattern>
        </defs>
        <rect width="${W}" height="${H}" fill="#fbfbfb"/><rect width="${W}" height="${road}" fill="url(#dots)"/>
        <path d="M206 ${road} H20 a10 10 0 0 1 -10 -10 V20 a10 10 0 0 1 10 -10 H340 a10 10 0 0 1 10 10 V${road - 10} a10 10 0 0 1 -10 10 H246" fill="none" stroke="#cfcfcf" stroke-dasharray="5 4"/>

        ${sections.map((sec, k) => { const st = stats(sec), lk = look(st), x = bx + k * sw, on = sel === sec;
          return `<g onclick="A.siteSet('${sec}')" style="cursor:pointer">
            <rect x="${x + 2}" y="${by}" width="${sw - 4}" height="${bh}" rx="10" fill="${lk.fill}" stroke="${on ? "#f06a6a" : lk.stroke}" stroke-width="${on ? 2.5 : 1.25}"/>
            <text x="${x + sw / 2}" y="${by + bh / 2 - 2}" font-size="28" font-weight="600" text-anchor="middle" fill="#1e1f21">${sec}</text>
            <text x="${x + sw / 2}" y="${by + bh / 2 + 18}" font-size="10" text-anchor="middle" fill="#6d6e6f">${st.open} open</text>
            ${badge(x + sw - 14, by + 13, flags(st), lk.dot || "#6d6e6f")}
          </g>`; }).join("")}

        <g aria-label="Crane">
          <circle cx="48" cy="${fy + fh / 2}" r="22" fill="#f06a6a" fill-opacity=".05" stroke="#f3b0b0" stroke-dasharray="3 3"/>
          <line x1="48" y1="${fy + fh / 2}" x2="64" y2="${fy + 6}" stroke="#9ca0a4" stroke-width="2.5" stroke-linecap="round"/>
          <rect x="43" y="${fy + fh / 2 - 5}" width="10" height="10" rx="2" fill="#6d6e6f"/>
          ${label(86, fy + fh / 2 + 3, "CRANE", "start")}
        </g>
        <g aria-label="Storage"><rect x="124" y="${fy}" width="74" height="${fh}" rx="4" fill="url(#hatch)" stroke="#dcdcdc"/>${label(161, fy + fh / 2 + 3, "STORAGE")}</g>
        <g onclick="A.siteSet('Site')" style="cursor:pointer">
          <rect x="208" y="${fy}" width="36" height="${road - fy}" rx="3" fill="${sel === "Site" ? "#fde3e3" : "#ececec"}" stroke="${sel === "Site" ? "#f06a6a" : "none"}"/>
          ${label(226, fy + fh / 2 + 3, "ACCESS")}
          ${badge(240, fy + 2, flags(site), siteLook.dot || "#6d6e6f")}
        </g>
        <g aria-label="Site office"><rect x="254" y="${fy}" width="40" height="${fh}" rx="3" fill="#fff" stroke="#d4d4d4"/><rect x="298" y="${fy}" width="40" height="${fh}" rx="3" fill="#fff" stroke="#d4d4d4"/>${label(296, fy + fh / 2 + 3, "OFFICE")}</g>

        <rect x="0" y="${road}" width="${W}" height="36" fill="#ececec"/>
        <line x1="0" x2="${W}" y1="${road + 18}" y2="${road + 18}" stroke="#fff" stroke-width="2" stroke-dasharray="10 8"/>
        <text x="14" y="${road + 13}" font-size="9" fill="#6d6e6f">${esc(S.project.address.split(",")[0])}</text>
        <g transform="translate(${W - 24},${road + 6})"><path d="M0 10 L5 -2 L10 10 L5 7 Z" fill="#9ca0a4"/><text x="5" y="21" font-size="8" text-anchor="middle" fill="#9ca0a4">N</text></g>
      </svg>`;

    // ---- section list (or the selected section's levels, tasks and notes)
    const keys = [...sections, ...(stats("Site").ts.length || stats("Site").problem ? ["Site"] : [])];
    const tile = (key) => { const lk = look(stats(key)); return `<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold text-ink" style="background:${lk.fill};border-color:${lk.stroke}">${key === "Site" ? Ic("pin", "h-4 w-4") : key}</span>`; };
    const list = `
      <ul class="divide-y divide-soft overflow-hidden rounded-lg border border-line bg-white">${keys.map((key) => `
        <li><button onclick="A.siteSection('${key}')" class="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas">
          ${tile(key)}
          <span class="min-w-0 flex-1"><span class="block text-sm font-medium text-ink">${key === "Site" ? "Access & site" : `Section ${key}`}</span><span class="block truncate text-xs text-muted">${metaOf(stats(key))}</span></span>
          <span class="text-faint">${Ic("chev", "h-4 w-4")}</span>
        </button></li>`).join("")}</ul>`;
    let detail = "";
    if (sel) {
      const st = stats(sel);
      const levels = LEVELS.filter((l) => st.ts.some((t) => levelOf(t.name) === l));
      const tasks = sortTasks(st.ts, sched);
      const notes = entries.filter((e) => (sectionOfEntry(e) || "Site") === sel);
      detail = `
        <div class="mb-2 px-0.5"><h2 class="text-[15px] font-semibold text-ink">${sel === "Site" ? "Access & site" : `Section ${sel}`}</h2><p class="text-xs text-muted">${metaOf(st)}</p></div>
        ${levels.length ? `<div class="mb-3 flex gap-1.5 overflow-x-auto">${levels.map((l) => { const n = st.ts.filter((t) => levelOf(t.name) === l && t.status !== "done").length; return `<span class="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-2.5 text-xs text-ink">${esc(l)} <span class="text-faint">${n}</span></span>`; }).join("")}</div>` : ""}
        <ul class="divide-y divide-soft rounded-lg border border-line bg-white px-3">${tasks.map((t) => TaskRow(t, sched, link[t.id])).join("") || `<li class="py-4 text-center text-sm text-muted">No tasks here</li>`}</ul>
        ${SectionTitle(`Site notes <span class="font-normal text-faint">${notes.length}</span>`)}
        ${notes.length ? `<ul class="space-y-2">${notes.map((e) => `<li>${LogCard(e, true)}</li>`).join("")}</ul>` : `<p class="rounded-lg border border-line bg-white px-4 py-4 text-center text-sm text-muted">No notes yet</p>`}`;
    }
    const dot = (c, l) => `<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:${c}"></span>${l}</span>`;
    const mapsUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent(S.project.address)}`;
    const modeSwitch = `<div class="mb-3 flex gap-1 rounded-lg bg-soft p-1">${[["3d", "3D model"], ["plan", "Site plan"]].map(([k, l]) =>
      `<button onclick="A.siteMode('${k}')" class="flex h-9 flex-1 items-center justify-center rounded-md text-sm ${U.site.mode === k ? "bg-white font-semibold text-ink shadow-sm" : "text-muted"}">${l}</button>`).join("")}</div>`;
    const below = `
      <div class="mt-4 flex gap-1 rounded-lg bg-soft p-1">${[null, ...keys].map((k) => {
        const on = sel === k, lk = k ? look(stats(k)) : null;
        return `<button onclick="A.siteSet(${k ? `'${k}'` : "null"})" class="relative flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md text-sm ${on ? "bg-white font-semibold text-ink shadow-sm" : "text-muted"}">
          ${k === null ? "All" : k === "Site" ? "Access" : k}${lk?.dot ? `<span class="h-1.5 w-1.5 rounded-full" style="background:${lk.dot}"></span>` : ""}</button>`;
      }).join("")}</div>
      <div class="mt-3">${sel ? detail : list}</div>`;
    if (U.site.mode === "3d") return modeSwitch + Site3DPanel(pool, sched, sections, sel) + below;
    window.__site3d = null;
    return `${modeSwitch}
      <section class="overflow-hidden rounded-lg border border-line bg-white">
        ${plan}
        <div class="flex items-center gap-2 border-t border-soft px-3 py-2">
          <span class="text-muted">${Ic("pin", "h-4 w-4")}</span><span class="min-w-0 flex-1 truncate text-[13px] text-ink">${esc(S.project.address)}</span>
          <a href="${mapsUrl}" target="_blank" rel="noopener" class="text-[13px] font-medium text-sel">Open map</a>
        </div>
      </section>
      <div class="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted">${dot(C.problem, "Problem or overdue")}${dot(C.delay, "Delay")}${dot(C.blocked, "Blocked")}</div>
      ${below}`;
  }

  // ---- 3D site model (Plan › Site › 3D): filters + the model drawn by public/app/site3d.js
  const CAT3D = [["problem", "#dc2626", "Problem · act today"], ["delay", "#f59e0b", "Delayed"], ["blocked", "#3f3f46", "Blocked"],
    ["progress", "#2563eb", "In progress"], ["planned", "#a1a1aa", "Planned"], ["done", "#16a34a", "Done"]];
  const catOf = (t) => {
    if (t.status === "done") return "done";
    const hard = S.entries.some((e) => e.fields?.taskId === t.id && ["stoppage", "defect", "incident"].includes(e.type));
    if (isOverdue(t) || hard || S.pending?.proposal?.triggerTaskId === t.id) return "problem";
    if (t.delayDays > 0 || S.proposals.some((p) => p.status === "pending" && p.taskId === t.id)) return "delay";
    if (t.status === "blocked") return "blocked";
    return t.status === "in-progress" ? "progress" : "planned";
  };
  function Site3DPanel(pool, sched, sections, sel) {
    const f = U.site;
    const tasks = pool.map((t) => {
      const team = TEAMS.find((x) => x.id === t.team) || { name: t.team, color: "#6d6e6f" };
      const sc = sched[t.id];
      const miss = missingCount(t);
      return {
        id: t.id, name: t.name, section: t.section || "", level: levelOf(t.name), team: t.team, teamColor: team.color, status: t.status,
        cat: catOf(t), missing: miss, milestone: !!t.milestone, crew: t.crew,
        label: `${t.name}${t.section ? ` ${t.section}` : ""}`,
        sub: [`${team.name}`, `${dayLabel(sc.es)}${sc.ef > sc.es ? ` – ${dayLabel(sc.ef)}` : ""}`, miss ? `${miss} item${miss > 1 ? "s" : ""} missing` : "", t.milestone ? "milestone" : ""].filter(Boolean).join(" · "),
      };
    });
    const order = ["Floor 3", "Floor 2", "Floor 1", "Ground", "Basement", "Foundation"];
    const top = Math.min(...tasks.filter((t) => t.section).map((t) => order.indexOf(t.level)));
    const floors = order.slice(Number.isFinite(top) ? top : 1);
    const count = (k) => tasks.filter((t) => t.cat === k).length;
    window.__site3d = {
      model: { sections, tasks, floor: f.floor, cat: f.cat, team: f.team, pulse: f.pulse, people: f.people, selected: sel },
      handlers: { openTask: (id) => A.openTask(id), selectSection: (s) => A.siteSet(U.site.section === s ? null : s) },
    };
    const radio = (key, val, label, on) => `<label class="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-ink"><input type="radio" class="h-4 w-4 accent-[#f06a6a]" name="s3-${key}" ${on ? "checked" : ""} onchange="A.site3d('${key}','${val}')">${label}</label>`;
    const check = (key, label) => `<label class="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-ink"><input type="checkbox" class="h-4 w-4 accent-[#f06a6a]" ${f[key] ? "checked" : ""} onchange="A.site3d('${key}',this.checked)">${label}</label>`;
    const head = (t) => `<p class="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted first:mt-0">${t}</p>`;
    const filters = `
      <div class="rounded-lg border border-line bg-white p-4">
        ${head("Floor")}
        ${radio("floor", "all", "All floors", f.floor === "all")}
        ${floors.map((l) => radio("floor", l, l === "Ground" ? "Ground floor" : l, f.floor === l)).join("")}
        ${head("Status")}
        ${radio("cat", "all", `All <span class="text-faint">(${tasks.length})</span>`, f.cat === "all")}
        ${CAT3D.map(([k, , l]) => radio("cat", k, `${l} <span class="text-faint">(${count(k)})</span>`, f.cat === k)).join("")}
        ${head("Team")}
        <select class="h-10 w-full rounded-md border border-line bg-white px-2 text-sm" onchange="A.site3d('team', this.value)">
          <option value="all">All teams</option>${TEAMS.map((t) => `<option value="${t.id}" ${f.team === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
        <div class="mt-3 border-t border-soft pt-2">
          ${check("pulse", "Pulse problems")}
          ${check("people", "Show crews")}
        </div>
        <p class="mt-2 text-xs leading-relaxed text-muted">Crews are atmosphere: helmets in the team colour stand at running tasks; the site manager in white walks to the problems.</p>
      </div>`;
    const legend = `<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink">${CAT3D.map(([, c, l]) => `<span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-full" style="background:${c}"></span>${l}</span>`).join("")}
      <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-full border-2 border-[#f59e0b]"></span>Missing item</span>
      <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rotate-45 bg-[#a1a1aa]"></span>Milestone</span></div>`;
    const shown = tasks.filter((t) => (f.cat === "all" || t.cat === f.cat) && (f.team === "all" || t.team === f.team) && (!t.section || f.floor === "all" || order.indexOf(t.level) >= order.indexOf(f.floor))).length;
    return `
      <div class="grid gap-3 lg:grid-cols-[230px_1fr]">
        <div class="order-2 lg:order-1">${filters}</div>
        <div class="order-1 min-w-0 lg:order-2">
          ${legend}
          <p class="mt-1 text-xs text-muted">${f.floor === "all" ? "All floors" : f.floor}: ${shown} task(s) shown · drag to turn, scroll or pinch to zoom, click a pin for details</p>
          <div class="relative mt-2 overflow-hidden rounded-lg border border-line bg-white">
            <div id="site3d" class="h-[380px] w-full sm:h-[520px]"></div>
            <button onclick="A.site3dReset()" class="absolute right-3 top-3 h-9 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink shadow-sm hover:bg-canvas">Reset view</button>
          </div>
          <p class="mt-1.5 text-[11px] text-faint">Building drawn from the plan: grey = built, yellow = formwork, purple = rebar, dashed = still to build. Click a section to list its tasks below.</p>
        </div>
      </div>`;
  }

  // ---- Library (Plan › More): every report, grouped by the person who added it
  const ARCHIVE = [
    { id: "AR1", by: "site-manager", kind: "report", title: "Bautagesbericht 23.11.2026", day: "Mon 23 Nov", status: "approved", body: "Wetter: bewölkt, 6 °C\nPersonal: 34\nErdbau: Aushub Fundament C begonnen (Abschnitt C)\nSchalung: Wände EG A fertig\nBesonderheiten: keine" },
    { id: "AR2", by: "site-manager", kind: "letter", title: "Mängelanzeige · Abdichtung Keller A", day: "Fri 20 Nov", status: "approved", body: "An: Abdichtung Fischer GmbH\nBetreff: Mängelanzeige gem. § 4 Abs. 7 VOB/B\nAn der Kellerwand Achse A/2 ist die Abdichtung auf ca. 1,5 m nicht verklebt. Wir fordern Sie auf, den Mangel bis 27.11.2026 zu beseitigen." },
    { id: "AR3", by: "earthworks", kind: "note", title: "Excavation started, section C", day: "Mon 23 Nov", status: "note", body: "Aushub Fundament C begonnen, 4 Mann, Bagger 14 t. Leitungsplan vom Bauherrn noch offen." },
    { id: "AR4", by: "formwork", kind: "note", title: "Walls floor 2 A formwork closed", day: "Mon 23 Nov", status: "note", body: "Schalung Wände 2. OG Abschnitt A geschlossen, Abnahme durch Bauleitung morgen 8 Uhr." },
    { id: "AR5", by: "rebar", kind: "note", title: "Partial rebar delivery", day: "Fri 20 Nov", status: "problem", body: "Nur 3,1 t von 6,2 t Bewehrung für Abschnitt C geliefert. Rest laut Lieferant nächste Woche." },
    { id: "AR6", by: "concrete", kind: "note", title: "Pump booked for walls 2 A", day: "Fri 20 Nov", status: "note", body: "Betonpumpe für Do 26.11., 7 Uhr bestellt. Kranslot muss noch bestätigt werden." },
  ];
  function Library() {
    const f = U.libFilter ?? "all";
    const items = [
      ...S.entries.map((e) => ({ id: e.id, by: e.author, kind: e.source === "minutes" ? "minutes" : "note", title: e.summary, day: dayLabel(e.day ?? S.today), status: isProblem(e) ? "problem" : "note", call: `A.openLog('${e.id}')` })),
      ...S.notices.map((n) => ({ id: n.id, by: n.by ?? "site-manager", kind: n.type === "tagesbericht" ? "report" : "letter", title: n.title, day: dayLabel(S.today), status: n.status, call: `A.libNotice('${n.id}')` })),
      ...ARCHIVE.map((a) => ({ ...a, call: `A.libOpen('${a.id}')` })),
    ].filter((it) => f === "all" || (f === "notes" ? ["note", "minutes"].includes(it.kind) : f === "letters" ? it.kind === "letter" : it.kind === "report"));
    const ICON = { note: "mic", minutes: "minutes", letter: "file", report: "book" };
    const KIND = { note: "Site note", minutes: "Minutes", letter: "Letter", report: "Daily report" };
    const STATUS = { draft: '<span class="text-warn">Draft</span>', approved: '<span class="text-ok">Approved</span>', problem: '<span class="text-bad">Problem</span>', note: "" };
    const people = PERSONAS.filter((p) => items.some((it) => it.by === p.id));
    const others = items.filter((it) => !PERSONAS.some((p) => p.id === it.by));
    const group = (id, name, role, list) => `
      <section class="mt-4">
        <div class="mb-1.5 flex items-center gap-2 px-0.5">${Avatar(id, name, 24)}<span class="text-[15px] font-semibold text-ink">${esc(name)}</span><span class="truncate text-xs text-muted">${esc(role)}</span><span class="ml-auto text-xs text-faint">${list.length}</span></div>
        <ul class="divide-y divide-soft overflow-hidden rounded-lg border border-line bg-white">${list.map((it) => `
          <li><button onclick="${it.call}" class="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${it.status === "problem" ? "bg-bad-soft text-bad" : "bg-soft text-muted"}">${Ic(ICON[it.kind], "h-4 w-4")}</span>
            <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-ink">${esc(it.title)}</span><span class="block truncate text-xs text-muted">${[KIND[it.kind], esc(it.day), STATUS[it.status] ?? ""].filter(Boolean).join(" · ")}</span></span>
            <span class="text-faint">${Ic("chev", "h-4 w-4")}</span>
          </button></li>`).join("")}</ul>
      </section>`;
    const open = ARCHIVE.find((a) => a.id === U.libItem);
    return `
      <div class="flex gap-1.5 overflow-x-auto">${[["all", "All"], ["notes", "Site notes"], ["letters", "Letters"], ["reports", "Daily reports"]].map(([k, l]) => chipBtn(l, `A.libFilter('${k}')`, f === k)).join("")}</div>
      ${people.map((p) => group(p.id, p.name, p.role.split(" (")[0], items.filter((it) => it.by === p.id))).join("")}
      ${others.length ? group("x", "Others", "", others) : ""}
      ${items.length ? "" : `<p class="mt-4 rounded-lg border border-line bg-white px-4 py-6 text-center text-sm text-muted">Nothing here yet</p>`}
      ${open ? Modal(esc(open.title), `<p class="mb-2 text-xs text-muted">${esc(personaName(open.by))} · ${esc(open.day)}</p><p class="whitespace-pre-line rounded-md bg-canvas p-3 font-mono text-[13px] leading-relaxed text-ink">${esc(open.body)}</p>`, "A.libOpen(null)") : ""}`;
  }

  // ---- Task drawer
  function TaskDrawer() {
    const t = S.tasks.find((x) => x.id === U.openTask);
    if (!t) return "";
    const done = t.status === "done", ed = canEdit(t);
    const sched = schedule(S.tasks);
    const team = TEAMS.find((x) => x.id === t.team), f = PERSONAS.find((p) => p.team === t.team), ms = MILESTONES.find((m) => m.id === t.milestone);
    const lk = isSM() ? null : scopeTasks().link[t.id];
    const history = S.changes.filter((c) => c.taskId === t.id).slice(0, 5);
    const Row = (icon, inner) => `<div class="flex min-h-11 items-center gap-3 text-sm"><span class="w-6 text-center text-lg">${icon}</span><div class="min-w-0 flex-1">${inner}</div></div>`;
    const KEYS = ["predecessor", "material", "crew", "equipment", "permit", "drawings"];
    const e = U.edit;
    const patch = editPatch(t);
    const dirty = Object.keys(patch).length > 0;
    const preview = dirty ? computeImpact(S.tasks, S.tasks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)), t.id) : null;
    const ns = preview ? newSlipsOf(preview) : [];
    const Stepper = (icon, val, minus, plus) => `<div class="flex items-center gap-2"><span class="w-6 text-center text-lg">${icon}</span>${Btn("−", minus, "secondary", "", "w-12 text-lg")}<span class="flex-1 text-center text-sm font-bold">${val}</span>${Btn("+", plus, "secondary", "", "w-12 text-lg")}</div>`;
    return `
      <div class="fixed inset-0 z-30 bg-black/40" onclick="A.closeTask()"></div>
      <aside class="fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-white shadow-2xl sm:w-[480px]">
        <div class="flex items-center gap-2 border-b border-line px-3 py-2">
          ${ed ? Btn(done ? "✓ Done" : "○ Complete", `A.toggleDone('${t.id}')`, done ? "success" : "secondary") : Badge("🔒 read-only")}
          <span class="ml-auto text-xs font-bold text-faint">${t.id}</span>
          ${Btn("✕", "A.closeTask()", "ghost", 'aria-label="Close"')}
        </div>
        <div class="flex-1 overflow-y-auto px-4 pb-24 pt-4">
          <h2 class="text-2xl font-semibold ${done ? "text-faint line-through" : ""}">${esc(t.name)} ${esc(t.section)}</h2>
          <div class="mt-2 flex flex-wrap gap-1">${StatusChips(t)}${lk ? Badge(`🔗 ${lk}`) : ""}</div>
          <div class="mt-3 divide-y divide-soft">
            ${Row("👤", `<span class="inline-flex items-center gap-2">${Avatar(f.id, f.name)}<b>${esc(f.name)}</b><span class="text-muted">${esc(team.company)}</span></span>`)}
            ${Row("📅", `<b>${dayLabel(sched[t.id].es)} → ${dayLabel(sched[t.id].ef)}</b>`)}
            ${Row("📍", `<span class="inline-flex items-center gap-1.5"><span class="h-3 w-3 rounded-full" style="background:${team.color}"></span>${team.name} · ${t.section ? `Section ${esc(t.section)}` : "Site"} · ${levelOf(t.name)}</span>`)}
            ${Row("👷", `${t.crew}`)}
            ${Row("↩", t.predecessors.length ? t.predecessors.map((p) => Badge(esc(taskLabel(p)))).join(" ") : "—")}
            ${ms ? Row("◆", `<span class="font-bold text-warn">${esc(ms.name)}</span> · ${dayLabel(ms.targetDay)}`) : ""}
          </div>
          <p class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">What's missing</p>
          <div class="flex flex-wrap gap-1.5">${KEYS.map((k) => {
            const it = t.readiness[k], open = it?.state === "open";
            return open && ed ? `<button onclick="A.clearBlocker('${t.id}','${k}',true)" title="${esc(it?.note)}" class="min-h-11 rounded-full bg-bad-soft px-3 text-xs font-bold text-bad">✗ ${k} · clear</button>`
              : `<span title="${esc(it?.note)}" class="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-bold ${open ? "bg-bad-soft text-bad" : "bg-ok-soft text-ok"}">${open ? "✗" : "✓"} ${k}</span>`;
          }).join("")}</div>
          ${KEYS.filter((k) => t.readiness[k]?.state === "open").map((k) => `<p class="mt-2 text-xs font-semibold text-bad">${esc(t.readiness[k].note)} · 👤 ${esc(t.readiness[k].owner)} · ⏳ ${dayLabel(t.readiness[k].dueDay ?? 0)}</p>`).join("")}
          ${ed ? `
          <div class="mt-4 space-y-2 rounded-lg border border-line p-3">
            ${Stepper("▶", dayLabel(Math.max(0, t.plannedStart + e.shift)), "A.ed('shift',-1)", "A.ed('shift',1)")}
            ${Stepper("⏱", `${e.dur} d`, "A.ed('dur',-1)", "A.ed('dur',1)")}
            <div class="flex items-center gap-2"><span class="w-6 text-center text-lg">🏷</span><select class="${inputCls}" onchange="A.ed('status', this.value)">${options(["planned", "in-progress", "blocked", "done"].map((x) => [x, x]), e.status)}</select></div>
            <input class="${inputCls}" placeholder="✎ Reason" value="${esc(e.reason)}" oninput="A.ed('reason', this.value)">
            ${preview ? `<div class="flex flex-wrap gap-1">${preview.changedTaskIds.length ? Badge(`↪ ${preview.changedTaskIds.join(", ")}`, "amber") : Badge("no knock-on", "green")}
              ${preview.notify.filter((p) => p !== S.persona).map((p) => Badge(`🔔 ${esc(shortName(p))}`, "blue")).join("")}
              ${ns.map((m) => Badge(`◆ ${m.milestone.id} +${m.slip} d`, "red")).join("")}</div>` : ""}
            <div class="grid grid-cols-[1fr_auto] gap-2">${Btn("✓ Apply & notify", "A.applyEdit()", "primary", dirty ? "" : "disabled", "w-full")}${dirty ? Btn("↺", "A.undoEdit()", "secondary", 'aria-label="Undo"') : ""}</div>
          </div>` : ""}
          ${history.length ? `<details class="mt-4 text-xs text-muted"><summary class="cursor-pointer py-2 font-bold">🕘 ${history.length}</summary>
            <ul class="space-y-1">${history.map((c) => `<li>${clock(c.createdAt)} · ${esc(JSON.stringify(c.after))}${c.reason ? ` · “${esc(c.reason)}”` : ""}</li>`).join("")}</ul></details>` : ""}
        </div>
      </aside>`;
  }

  // ---- Site notes (Plan › More)
  const SRC = { voice: "🎙", text: "⌨", photo: "📷", minutes: "📝" };
  function LogCard(e, compact) {
    if (!e) return "";
    const prob = isProblem(e), delay = delayOf(e);
    const open = S.todos.filter((t) => t.entryId === e.id && t.status === "open").length;
    const atts = e.attachments ?? [];
    return `
      <article ${compact ? `role="button" onclick="A.openLog('${e.id}')"` : ""} class="rounded-lg border ${prob ? "border-l-[6px] border-bad-soft border-l-bad" : "border-line"} bg-white p-3 ${compact ? "cursor-pointer" : ""}">
        <div class="flex flex-wrap items-center gap-1.5">
          ${prob ? `<span class="text-lg leading-none text-bad">⚠</span>` : ""}
          ${Avatar(e.author, contactName(e.author), 22)}
          <span class="text-xs font-bold">${esc(shortName(e.author))}</span>
          <span class="text-xs text-muted">${dayShort(e.day).wd} ${clock(e.createdAt)} ${e.source ? SRC[e.source] : ""}</span>
          <span class="ml-auto flex flex-wrap gap-1">
            ${prob ? Badge(e.type, "red") + Badge(severity(e) === "High" ? "▲ High" : "■ Medium", severity(e) === "High" ? "overdue" : "red") : Badge(e.type)}
            ${delay > 0 ? DelayChip(delay) : ""}${open ? Badge(`${open} open`) : ""}
          </span>
        </div>
        <p class="mt-1.5 text-sm font-bold ${compact ? "line-clamp-2" : ""}">${esc(e.summary)}</p>
        <div class="mt-1 flex flex-wrap gap-1">${e.location ? Badge(`📍 ${esc(e.location)}`) : ""}${e.fields?.taskId ? Badge(`🔗 ${esc(taskLabel(e.fields.taskId))}`) : ""}</div>
        ${!compact && e.nextSteps?.length ? `<div class="mt-2 flex flex-wrap gap-1">${e.nextSteps.map((st) => Badge(`→ ${KIND_VERB[st.kind]} ${esc(shortName(st.who))}${st.dueDay !== undefined ? `, ${shortDay(st.dueDay)}` : ""}${st.source === "user" ? " · YOU" : st.source === "ai" ? " · AI" : ""}`, "outline")).join("")}</div>` : ""}
        ${atts.length ? `<div class="mt-2 flex flex-wrap gap-2">${atts.map((a, i) => AttachChip(a, `A.previewEntry('${e.id}',${i})`)).join("")}</div>` : ""}
        ${!compact ? `<details class="mt-1 text-xs text-muted"><summary class="cursor-pointer py-2 font-semibold">“…”</summary><p class="italic">“${esc(e.transcript)}”</p></details>` : ""}
      </article>`;
  }
  function Notes() {
    const L = U.logs;
    const needle = L.q.trim().toLowerCase();
    const base = S.entries.filter((e) => !needle || [e.summary, e.location, e.state, e.transcript, taskLabel(e.fields?.taskId)].some((x) => x?.toLowerCase().includes(needle)));
    const nProb = base.filter(isProblem).length;
    const list = base.filter((e) => L.filter === "all" || (L.filter === "problems" ? isProblem(e) : !isProblem(e)));
    return `
      <div class="space-y-3">
        ${U.minutes.open ? MinutesImport() : ""}
        <div class="flex gap-2">
          <input id="log-search" class="${inputCls}" placeholder="🔍 Search" value="${esc(L.q)}" oninput="A.logSearch(this.value)">
          ${U.minutes.open ? "" : Btn("📝", "A.minutesOpen(true)", "secondary", 'aria-label="Import meeting minutes" title="Import meeting minutes"', "text-lg")}
        </div>
        <div class="flex gap-2 overflow-x-auto">
          ${chipBtn(`All ${base.length}`, "A.logFilter('all')", L.filter === "all")}
          ${chipBtn(`⚠ Problems ${nProb}`, "A.logFilter('problems')", L.filter === "problems")}
          ${chipBtn(`📝 Notes ${base.length - nProb}`, "A.logFilter('notes')", L.filter === "notes")}
        </div>
        <ul class="space-y-2">${list.map((e) => `<li>${LogCard(e)}</li>`).join("") || `<li class="py-10 text-center text-4xl">📒</li>`}</ul>
      </div>`;
  }
  function MinutesImport() {
    const M = U.minutes;
    const body = !M.res ? `
      <textarea class="${inputCls} min-h-40 text-sm" placeholder="Paste minutes" oninput="U.minutes.text=this.value">${esc(M.text)}</textarea>
      <div class="mt-2 grid grid-cols-2 gap-2">${Btn("Split →", "A.minutesSplit()", "primary", "", "w-full")}${Btn("🧪 Sample", "A.minutesSample()", "secondary", "", "w-full")}</div>` : `
      <ul class="space-y-2">${M.res.items.map((it, i) => `
        <li><label class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${M.keep[i] ? "border-line" : "border-dashed border-line opacity-50"}">
          <input type="checkbox" class="mt-1 h-5 w-5 accent-[#c2410c]" ${M.keep[i] ? "checked" : ""} onchange="A.minutesKeep(${i})">
          <span class="min-w-0 flex-1 text-sm">${esc(it.text)}
            <span class="mt-1 flex flex-wrap gap-1">${Badge(it.type)}${it.taskId ? Badge(`🔗 ${it.taskId}`) : ""}
              ${it.nextSteps.map((st) => Badge(`→ ${KIND_VERB[st.kind]} ${esc(shortName(st.who))}${st.dueDay !== undefined ? `, ${shortDay(st.dueDay)}` : ""}`, "outline")).join("")}</span></span>
        </label></li>`).join("")}</ul>
      <div class="mt-2 grid grid-cols-[1fr_auto] gap-2">${Btn(`✓ Save ${M.keep.filter(Boolean).length}`, "A.minutesSave()", "primary", M.keep.some(Boolean) ? "" : "disabled", "w-full")}${Btn("←", "A.minutesBack()", "secondary")}</div>`;
    return Card("📝 Meeting minutes", body, Btn("✕", "A.minutesOpen(false)", "ghost", 'aria-label="Close"'));
  }

  // ---- History (Plan › More): decisions, changes, sent updates
  function History() {
    const KIND = { preventive: ["risk", "green"], reactive: ["problem", "red"], change: ["change", "stone"] };
    const sent = S.messages.filter((m) => m.status === "sent");
    return `
      <div class="space-y-3">
        ${Card(`⚖ Decisions ${Badge(String(S.decisions.length))}`, `<ul class="space-y-2">${S.decisions.map((d) => `<li class="text-sm">${Badge(KIND[d.kind][0], KIND[d.kind][1])} <span class="text-xs text-faint">${clock(d.createdAt)}</span> ${esc(d.text)}</li>`).join("") || `<li class="text-sm text-faint">—</li>`}</ul>`)}
        ${Card(`🕘 Changes ${Badge(String(S.changes.length))}`, `<ul class="space-y-2 text-sm">${S.changes.map((c) => `<li class="rounded-xl bg-canvas p-2">
          <p><span class="text-xs text-faint">${clock(c.createdAt)}</span> <b>${esc(shortName(c.by))}</b> · ${esc(taskLabel(c.taskId))}</p>
          <p class="text-xs text-muted">${esc(JSON.stringify(c.before))} → ${esc(JSON.stringify(c.after))}${c.reason ? ` · “${esc(c.reason)}”` : ""}</p>
          <p class="text-xs text-muted">↪ ${c.affectedTaskIds.join(", ") || "—"} · 🔔 ${c.notified.map(shortName).map(esc).join(", ")}</p></li>`).join("") || `<li class="text-sm text-faint">—</li>`}</ul>`)}
        ${Card(`✉ Sent updates ${Badge(String(sent.length))}`, `<ul class="space-y-2 text-sm">${sent.map((m) => `<li class="flex items-center gap-2">${Avatar(m.to, contactName(m.to), 24)}<span class="min-w-0 flex-1 truncate">${esc(m.subject)}</span>${Badge(`${clock(m.sentAt)} · ${m.channel}`, "green")}</li>`).join("") || `<li class="text-sm text-faint">—</li>`}</ul>`)}
      </div>`;
  }

  // ---- Documents (Plan › More)
  function Documents() {
    const sel = S.notices.find((n) => n.id === S.selectedNoticeId) ?? S.notices[0];
    return `
      <div class="space-y-3">
        <ul class="space-y-2">${S.notices.map((n) => `
          <li><button onclick="A.selectNotice('${n.id}')" class="w-full rounded-lg border p-3 text-left ${sel?.id === n.id ? "border-sel bg-sel-soft" : "border-line bg-white"}">
            <div class="flex items-center justify-between gap-2"><span class="text-sm font-bold">${esc(n.title)}</span>${Badge(n.status === "approved" ? "✓ approved" : "✎ draft", n.status === "approved" ? "green" : "stone")}</div>
            <div class="mt-1 flex flex-wrap gap-1">${Badge(n.mode === "reactive" ? "problem" : n.mode === "preventive" ? "risk" : "report", n.mode === "reactive" ? "red" : n.mode === "preventive" ? "green" : "stone")}${Badge(`→ ${esc(n.addressee)}`)}</div>
          </button></li>`).join("") || `<li class="py-10 text-center text-4xl">📄</li>`}</ul>
        ${sel ? Card(esc(sel.title), `
          <p class="mb-2 text-xs font-semibold text-muted">${NOTICE_LABEL[sel.type]}</p>
          <textarea ${sel.status !== "draft" ? "readonly" : ""} oninput="A.noticeBody('${sel.id}', this.value)" class="h-[55vh] w-full rounded-xl border border-line bg-canvas p-3 font-mono text-[13px] leading-relaxed focus:border-sel focus:outline-none">${esc(sel.body)}</textarea>
          <div class="mt-2 grid grid-cols-3 gap-2">
            ${Btn("🖨 PDF", `A.print('${sel.id}')`, "secondary", "", "w-full")}${Btn("⬇ .txt", `A.exportTxt('${sel.id}')`, "secondary", "", "w-full")}
            ${sel.status === "draft" ? Btn("✓ Approve", `A.approveNotice('${sel.id}')`, "success", isSM() ? "" : 'disabled title="Site manager only"', "w-full") : Badge("🔒 approved", "green", 'style="justify-content:center"')}
          </div>`) : ""}
      </div>`;
  }

  // ---- Setup (Plan › More)
  function Setup() {
    const P = U.setupPreview;
    const fields = [["name", "🏗 Project"], ["address", "📍 Address"], ["contractor", "🏢 Contractor"], ["client", "👔 Client"], ["contractBasis", "⚖ Contract"], ["planStart", "📅 Plan start"]];
    return `
      <div class="space-y-3">
        ${Card("1 · Project", `<div class="grid grid-cols-1 gap-3">${fields.map(([k, l]) => Field(l, `<input class="${inputCls}" value="${esc(S.project[k])}" ${!isSM() || k === "planStart" ? "disabled" : ""} oninput="A.project('${k}', this.value)" onchange="render()">`)).join("")}</div>`)}
        ${Card("2 · Schedule", `
          <p class="mb-2 text-xs font-semibold text-muted">CSV · ID, Name, Team, Section, Start, Duration, Crew, Predecessors, Milestone</p>
          <div class="grid grid-cols-2 gap-2">
            <label class="inline-flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold ${isSM() ? "cursor-pointer bg-accent text-white" : "bg-soft text-faint"}">⬆ Upload
              <input type="file" accept=".csv,text/csv,.xlsx" class="hidden" ${isSM() ? "" : "disabled"} onchange="A.importFile(this)"></label>
            ${Btn("⬇ Template", "A.template()", "secondary", "", "w-full")}
          </div>
          ${P ? `<div class="mt-3 rounded-xl bg-canvas p-3">
            <p class="text-sm font-bold">${esc(P.file)} · ${P.tasks.length}</p>
            ${P.errors.map((x) => `<p class="text-xs text-bad">✕ ${esc(x)}</p>`).join("")}${P.warnings.slice(0, 5).map((x) => `<p class="text-xs text-warn">⚠ ${esc(x)}</p>`).join("")}
            ${P.tasks.length ? `<ul class="mt-2 max-h-48 overflow-auto text-xs">${P.tasks.map((t) => `<li>${esc(t.id)} · ${esc(t.name)} ${esc(t.section)} · ${dayLabel(t.plannedStart)} · ${t.duration} d</li>`).join("")}</ul>
              <div class="mt-2 grid grid-cols-2 gap-2">${Btn("✓ Use plan", "A.usePlan()", "primary", "", "w-full")}${Btn("✕", "A.cancelImport()", "secondary", "", "w-full")}</div>` : ""}
          </div>` : ""}`, Badge(`${S.tasks.length} tasks`, "green"))}
        ${Card("3 · Documents", `
          <ul class="divide-y divide-soft">${[...S.siteDocs, ...SITE_DOCUMENTS].map((d) => `<li class="flex min-h-12 items-center gap-3 py-1"><span class="text-xl">${d.kind === "Contract" ? "📑" : /\.xlsx$/.test(d.name) ? "📊" : "📄"}</span>
            <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">${esc(d.name)}</span><span class="text-xs text-muted">${esc(d.kind)}${d.pages ? ` · ${d.pages} p.` : ""}</span></span></li>`).join("")}</ul>`)}
        ${Card("4 · People", `
          <ul class="space-y-2">${S.contacts.map((c) => U.editContact === c.id ? `
            <li class="grid grid-cols-1 gap-2 rounded-xl bg-canvas p-2">
              <input class="${inputCls}" value="${esc(c.name)}" oninput="A.contact('${c.id}','name',this.value)" aria-label="Name">
              <input class="${inputCls}" value="${esc(c.phone)}" placeholder="📱 +49…" oninput="A.contact('${c.id}','phone',this.value)" aria-label="Phone">
              <input class="${inputCls}" value="${esc(c.email)}" placeholder="✉ Email" oninput="A.contact('${c.id}','email',this.value)" aria-label="Email">
              <label class="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" class="h-5 w-5" ${c.usesApp ? "checked" : ""} onchange="A.contact('${c.id}','usesApp',this.checked,true)"> 📲 uses app</label>
              ${Btn("✓ Done", "A.editContact(null)", "primary", "", "w-full")}
            </li>` : `
            <li class="flex min-h-12 items-center gap-3">${Avatar(c.id, c.name, 32)}
              <span class="min-w-0 flex-1"><span class="block truncate text-sm font-bold">${esc(c.name)}</span><span class="block truncate text-xs text-muted">${esc(c.role.split(" (")[0])}</span></span>
              ${Badge(c.usesApp ? "📲 app" : "💬 msg", c.usesApp ? "green" : "stone")}
              ${isSM() ? Btn("✎", `A.editContact('${c.id}')`, "ghost", 'aria-label="Edit"') : ""}
            </li>`).join("")}</ul>`)}
      </div>`;
  }

  // ================================================================== boot
  window.A = A;
  window.U = U;
  window.render = render;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (U.preview) A.closePreview(); else if (U.stepPick !== null) A.closePick(); else if (U.contractPicker) A.contractPicker(false);
    else if (U.logModal) A.closeLog(); else if (U.openTask) A.closeTask(); else if (U.moreOpen) A.more(false); else if (U.profileOpen) A.profile(false);
  });
  document.addEventListener("dragend", () => { U.drag = null; document.querySelectorAll("[data-col]").forEach((el) => el.classList.remove("ring-4")); });
  render();
})();
