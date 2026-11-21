// Notice and report templates (German, VOB/B based).
// Drafts are filled ONLY from recorded fields. Missing facts become visible [placeholders].
// Drafting aid, not legal advice: the site manager reviews every draft.

import { dayDE, clock } from "./dates";
import { CONTACTS, PERSONAS, PROJECT, TEAMS } from "./seed";
import type { Decision, DiaryEntry, Notice, NoticeType, Task } from "./types";
import type { BlockerAlert, Impact } from "./engine";

export const NOTICE_LABEL: Record<NoticeType, string> = {
  behinderung: "Obstruction notice (Behinderungsanzeige, § 6 Abs. 1 VOB/B)",
  mehrkosten: "Additional cost notice (Mehrkostenanzeige, § 2 Abs. 5/6 VOB/B)",
  bedenken: "Notice of concern (Bedenkenanzeige, § 4 Abs. 3 VOB/B)",
  maengel: "Defect notice (Mängelanzeige)",
  anforderung: "Request (Anforderung)",
  tagesbericht: "Daily site report (Bautagesbericht)",
};

export const DISCLAIMER =
  "ENTWURF – Formulierungshilfe, keine Rechtsberatung. Inhalt und Fristen vor Versand durch die Bauleitung prüfen.";

const ph = (v: string | number | undefined, label: string) =>
  v === undefined || v === "" ? `[${label} ergänzen]` : String(v);

const signature = () => {
  const sm = PERSONAS.find((p) => p.id === "site-manager")!;
  return `Mit freundlichen Grüßen\n\n${sm.name}\nBauleitung, ${PROJECT.contractor}`;
};

const header = (to: string, day: number, subject: string) =>
  `${PROJECT.contractor} · Bauleitung\n\nAn: ${to}\n\nBauvorhaben: ${PROJECT.name}, ${PROJECT.address}\nDatum: ${dayDE(day)}\n\nBetreff: ${subject}\n\nSehr geehrte Damen und Herren,`;

const teamCompany = (t?: Task) => (t ? TEAMS.find((x) => x.id === t.team)?.company ?? t.team : undefined);
const taskLabel = (t?: Task) => (t ? `${t.name}, Abschnitt ${t.section}` : undefined);

const photoFindings = (e: DiaryEntry) => (e.photoNotes?.length ? `\nFotobefund (automatisch erkannt, bitte prüfen): ${e.photoNotes.join(" · ")}` : "");

const newId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// ------------------------------------------------------------- reactive notices

export function draftBehinderung(entry: DiaryEntry, task: Task | undefined, impact: Impact | undefined, day: number, allTasks: Task[] = []): Notice {
  const f = entry.fields;
  const delay = f.estimatedDelayDays;
  const follow = impact?.changedTaskIds.length
    ? `Folgeleistungen betroffen: ${impact.changedTaskIds.map((id) => { const t = allTasks.find((x) => x.id === id); return t ? `${t.name} ${t.section} (${id})` : id; }).join(", ")}.`
    : "Folgeleistungen: derzeit keine Verschiebung erkennbar.";
  const slips = impact?.slipsAfter.filter((s) => s.slip > 0) ?? [];
  const ms = slips.length
    ? `Ohne Gegenmaßnahmen verschiebt sich der Meilenstein „${slips[0].milestone.name}“ um ${slips[0].slip} Arbeitstag(e).`
    : "";
  const clientCaused = /bauherr|client|auftraggeber/i.test(f.responsibleParty ?? "");
  const body = `${header(PROJECT.client, day, `Behinderungsanzeige gemäß § 6 Abs. 1 VOB/B – ${ph(taskLabel(task), "Leistung")}`)}

hiermit zeigen wir Ihnen gemäß § 6 Abs. 1 VOB/B an, dass wir in der ordnungsgemäßen Ausführung unserer Leistungen behindert sind.

Betroffene Leistung: ${ph(taskLabel(task), "Leistung")} (${ph(teamCompany(task), "ausführende Firma")})
Beginn der Behinderung: ${dayDE(entry.day)}, ${ph(f.startTime, "Uhrzeit")} Uhr
Art und Ursache der Behinderung: ${ph(f.cause, "Ursache")}
Verantwortlich nach unserer Kenntnis: ${ph(f.responsibleParty, "Verursacher")}
Voraussichtliche Auswirkung: ${delay !== undefined ? `ca. ${delay} Arbeitstag(e) Verzögerung der betroffenen Leistung` : "[Dauer ergänzen]"}. ${follow} ${ms}
Dokumentation: Bautagebucheintrag vom ${dayDE(entry.day)}, ${clock(entry.createdAt)} Uhr${entry.photos.length ? `, ${entry.photos.length} Foto(s)` : ""}.${photoFindings(entry)}

${clientCaused ? "Wir bitten Sie, die Behinderung umgehend zu beseitigen und uns die hierfür erforderlichen Unterlagen bzw. Mitwirkungshandlungen unverzüglich zur Verfügung zu stellen." : "Wir bitten Sie um Kenntnisnahme."} Wir setzen die Arbeiten unverzüglich fort, sobald die hindernden Umstände wegfallen (§ 6 Abs. 3 VOB/B), und ergreifen bis dahin zumutbare Maßnahmen zur Weiterführung der Arbeiten.

Wir behalten uns vor, eine Verlängerung der Ausführungsfristen (§ 6 Abs. 2 VOB/B) sowie die Erstattung der uns entstehenden Mehrkosten geltend zu machen.

${signature()}

${DISCLAIMER}`;
  return { id: newId("N"), type: "behinderung", title: `Behinderungsanzeige – ${ph(taskLabel(task), "Leistung")}`, addressee: PROJECT.client, body, refs: [entry.id, ...(task ? [task.id] : [])], status: "draft", createdAt: new Date().toISOString(), mode: "reactive" };
}

export function draftMaengel(entry: DiaryEntry, task: Task | undefined, day: number): Notice {
  const f = entry.fields;
  const isDelivery = entry.type === "delivery";
  const to = isDelivery ? ph(f.responsibleParty && !/supplier/i.test(f.responsibleParty) ? f.responsibleParty : "Lieferant (Stahlhandel Müller)", "Lieferant") : ph(f.responsibleParty ?? teamCompany(task), "verantwortliche Firma");
  const deadline = dayDE(day + 3);
  const body = isDelivery
    ? `${header(to, day, `Mängelrüge zur Lieferung vom ${dayDE(entry.day)} – ${ph(f.material, "Material")}`)}

bei der Eingangskontrolle der heutigen Lieferung haben wir folgende Abweichung festgestellt:

Material / Menge: ${ph(f.material, "Material")}, ${ph(f.quantity, "Menge")}
Festgestellte Abweichung: ${ph(f.cause, "Abweichung")}
Verwendung: ${ph(taskLabel(task), "Leistung")}

Wir rügen diesen Mangel hiermit unverzüglich (§ 377 HGB) und bitten um mangelfreie Ersatzlieferung bis spätestens ${deadline}. Die beanstandete Ware halten wir zur Abholung bereit.
Dokumentation: Bautagebucheintrag vom ${dayDE(entry.day)}, ${clock(entry.createdAt)} Uhr${entry.photos.length ? `, ${entry.photos.length} Foto(s)` : ""}.${photoFindings(entry)}

${signature()}

${DISCLAIMER}`
    : `${header(to, day, `Mängelanzeige gemäß § 4 Abs. 7 VOB/B – ${ph(taskLabel(task), "Leistung")}`)}

bei der Kontrolle Ihrer Leistungen haben wir folgenden Mangel festgestellt:

Leistung: ${ph(taskLabel(task), "Leistung")}
Ort: ${ph(f.location, "Ort")}
Beschreibung: ${ph(f.cause ?? entry.summary, "Beschreibung")}
Dokumentation: Bautagebucheintrag vom ${dayDE(entry.day)}, ${clock(entry.createdAt)} Uhr${entry.photos.length ? `, ${entry.photos.length} Foto(s)` : ""}.${photoFindings(entry)}

Wir fordern Sie auf, den Mangel gemäß § 4 Abs. 7 VOB/B auf Ihre Kosten bis spätestens ${deadline} zu beseitigen und uns die Beseitigung schriftlich anzuzeigen. Nach fruchtlosem Fristablauf behalten wir uns weitere Schritte nach VOB/B vor.

${signature()}

${DISCLAIMER}`;
  return { id: newId("N"), type: "maengel", title: isDelivery ? `Mängelrüge Lieferung – ${ph(f.material, "Material")}` : `Mängelanzeige – ${ph(taskLabel(task), "Leistung")}`, addressee: to, body, refs: [entry.id], status: "draft", createdAt: new Date().toISOString(), mode: "reactive" };
}

export function draftMehrkosten(entry: DiaryEntry, task: Task | undefined, day: number): Notice {
  const f = entry.fields;
  const body = `${header(PROJECT.client, day, `Ankündigung von Mehrkosten gemäß § 2 Abs. 5/6 VOB/B – ${ph(taskLabel(task), "Leistung")}`)}

am ${dayDE(entry.day)} wurde folgende Änderung bzw. zusätzliche Leistung angeordnet:

Anordnung: ${ph(f.cause ?? entry.summary, "Anordnung")}
Angeordnet durch: ${ph(f.responsibleParty, "Anordnende Person")}
Betroffene Leistung: ${ph(taskLabel(task), "Leistung")}

Diese Leistung ist im Vertrag nicht bzw. nicht in dieser Form vorgesehen. Wir kündigen hiermit gemäß § 2 Abs. 6 Nr. 1 VOB/B vor Ausführung unseren Anspruch auf besondere Vergütung an bzw. machen eine Preisanpassung nach § 2 Abs. 5 VOB/B geltend. Ein Nachtragsangebot reichen wir kurzfristig nach.

${signature()}

${DISCLAIMER}`;
  return { id: newId("N"), type: "mehrkosten", title: `Mehrkostenanzeige – ${ph(taskLabel(task), "Leistung")}`, addressee: PROJECT.client, body, refs: [entry.id], status: "draft", createdAt: new Date().toISOString(), mode: "reactive" };
}

export function draftBedenken(entry: DiaryEntry, task: Task | undefined, day: number): Notice {
  const f = entry.fields;
  const body = `${header(PROJECT.client, day, `Bedenkenanzeige gemäß § 4 Abs. 3 VOB/B – ${ph(taskLabel(task), "Leistung")}`)}

gemäß § 4 Abs. 3 VOB/B teilen wir Ihnen unsere Bedenken gegen die vorgesehene Art der Ausführung bzw. die vorgegebenen Stoffe oder Vorleistungen mit:

Betroffene Leistung: ${ph(taskLabel(task), "Leistung")}
Bedenken: ${ph(f.cause ?? entry.summary, "Bedenken")}
Mögliche Folgen: [Folgen ergänzen]

Wir bitten um Ihre Entscheidung bis ${dayDE(day + 2)}. Bis dahin führen wir die betroffenen Arbeiten nicht aus.

${signature()}

${DISCLAIMER}`;
  return { id: newId("N"), type: "bedenken", title: `Bedenkenanzeige – ${ph(taskLabel(task), "Leistung")}`, addressee: PROJECT.client, body, refs: [entry.id], status: "draft", createdAt: new Date().toISOString(), mode: "reactive" };
}

// ------------------------------------------------------------- preventive request

export function draftAnforderung(alert: BlockerAlert, task: Task, day: number): Notice {
  const isClient = /client|bauherr/i.test(alert.owner);
  const to = isClient ? PROJECT.client : alert.owner;
  const subject = isClient
    ? `Anforderung von Ausführungsunterlagen gemäß § 3 Abs. 1 VOB/B – ${taskLabel(task)}`
    : `Bitte um Bestätigung – ${taskLabel(task)}`;
  const ask = isClient
    ? `Gemäß § 3 Abs. 1 VOB/B sind uns die für die Ausführung nötigen Unterlagen rechtzeitig zu übergeben. Wir bitten Sie daher, uns die fehlenden Unterlagen bis spätestens ${dayDE(alert.dueDay)} zu übermitteln. Andernfalls ist mit einer Behinderung der Arbeiten zu rechnen, die wir gemäß § 6 Abs. 1 VOB/B anzeigen würden.`
    : `Wir bitten Sie, uns den Liefertermin bis spätestens ${dayDE(alert.dueDay)} verbindlich zu bestätigen.`;
  const body = `${header(to, day, subject)}

für die am ${dayDE(alert.startDay)} geplante Leistung „${taskLabel(task)}“ fehlt derzeit:

${alert.note}

${ask}

${signature()}

${DISCLAIMER}`;
  return { id: newId("N"), type: "anforderung", title: `${isClient ? "Anforderung Unterlagen" : "Bitte um Bestätigung"} – ${taskLabel(task)}`, addressee: to, body, refs: [task.id], status: "draft", createdAt: new Date().toISOString(), mode: "preventive" };
}

// ------------------------------------------------------------- daily report

export function draftTagesbericht(args: {
  day: number;
  tasks: Task[];
  sched: Record<string, { es: number; ef: number }>;
  entries: DiaryEntry[];
  decisions: Decision[];
  notices: Notice[];
}): Notice {
  const { day, tasks, sched, entries, decisions, notices } = args;
  const active = tasks.filter((t) => sched[t.id] && sched[t.id].es <= day && sched[t.id].ef >= day && t.status !== "done");
  const byTeam = TEAMS.map((tm) => ({ tm, list: active.filter((t) => t.team === tm.id) })).filter((x) => x.list.length);
  const todays = entries.filter((e) => e.day === day).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const dec = decisions.filter((d) => d.day === day);
  const docs = notices.filter((n) => n.type !== "tagesbericht" && n.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10));
  const prev = dec.filter((d) => d.kind === "preventive").length;
  const reac = dec.filter((d) => d.kind === "reactive").length;

  const lines = [
    `Bautagesbericht – ${PROJECT.name}`,
    `Datum: ${dayDE(day)}    Auftragnehmer: ${PROJECT.contractor}    Bauleitung: ${PERSONAS[0].name}`,
    `Wetter: [ergänzen]`,
    ``,
    `1. Personal und Leistungen`,
    ...byTeam.map(({ tm, list }) => `- ${tm.company}: ${list.reduce((s, t) => s + t.crew, 0)} Arbeitskräfte – ${list.map((t) => `${t.name} ${t.section}${t.status === "blocked" ? " (behindert)" : ""}`).join("; ")}`),
    ``,
    `2. Ereignisse (Bautagebuch)`,
    ...(todays.length ? todays.map((e) => `- ${clock(e.createdAt)} ${e.summary}${e.location ? ` (Ort: ${e.location})` : ""}${e.photos.length ? ` [${e.photos.length} Foto(s)]` : ""}`) : ["- keine Einträge"]),
    ``,
    `2a. Vereinbarte nächste Schritte`,
    ...(todays.some((e) => e.nextSteps?.length)
      ? todays.flatMap((e) => (e.nextSteps ?? []).map((st) => `- ${st.text}${st.who ? ` – ${CONTACTS.find((c) => c.id === st.who)?.name ?? st.who}` : ""}${st.dueDay !== undefined ? ` – bis ${dayDE(st.dueDay)}` : ""}`))
      : ["- keine"]),
    ``,
    `3. Planänderungen und Entscheidungen`,
    ...(dec.length ? dec.map((d) => `- ${clock(d.createdAt)} [${d.kind === "preventive" ? "präventiv" : d.kind === "reactive" ? "reaktiv" : "Änderung"}] ${d.text}`) : ["- keine"]),
    ``,
    `4. Schriftverkehr`,
    ...(docs.length ? docs.map((n) => `- ${n.title} an ${n.addressee} (${n.status === "approved" ? "freigegeben" : "Entwurf"})`) : ["- keiner"]),
    ``,
    `5. Kennzahlen`,
    `- Entscheidungen heute: ${prev} präventiv, ${reac} reaktiv`,
    ``,
    `Aufgestellt: ${PERSONAS[0].name}, Bauleitung`,
    ``,
    DISCLAIMER,
  ];
  return { id: newId("R"), type: "tagesbericht", title: `Bautagesbericht ${dayDE(day)}`, addressee: "Projektakte", body: lines.join("\n"), refs: todays.map((e) => e.id), status: "draft", createdAt: new Date().toISOString(), mode: "report" };
}
