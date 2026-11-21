// Ready-to-send messages for people who do NOT use the app (subcontractors, client, supplier).
// The site manager reviews each one and sends it via WhatsApp, SMS or email from his phone.
// Messages are personalised: "action" for whoever has to do something, "fyi" for whoever is only affected.

import { computeImpact, schedule } from "./engine";
import { dayDE } from "./dates";
import { CONTACTS, PERSONAS, PROJECT } from "./seed";
import type { Contact, DiaryEntry, NextStep, OutMessage, Task, Todo } from "./types";

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();

export const contactById = (id?: string, list: Contact[] = CONTACTS) => list.find((c) => c.id === id);
const first = (name: string) => (name.includes(" ") && !name.startsWith("Dr.") ? name.split(" ")[0] : name);
const signature = () => `\n\nViele Grüße\n${PERSONAS[0].name}, Bauleitung ${PROJECT.contractor}\n${PROJECT.name}`;

function draft(to: string, purpose: OutMessage["purpose"], subject: string, body: string, entryId?: string): OutMessage {
  return { id: uid("M"), createdAt: now(), to, subject, body, purpose, entryId, status: "draft" };
}

/** Turn the next steps of a saved log into to-dos (site team) and message drafts (external people). */
export function applyNextSteps(entry: DiaryEntry, contacts: Contact[] = CONTACTS): { todos: Todo[]; messages: OutMessage[] } {
  const steps = entry.nextSteps ?? [];
  const todos: Todo[] = [];
  const messages: OutMessage[] = [];
  const where = entry.location ? ` (${entry.location})` : "";
  for (const st of steps) {
    const c = contactById(st.who, contacts);
    const external = c && !c.usesApp;
    if (st.kind === "task" || st.kind === "remind" || st.kind === "other") {
      todos.push({ id: uid("T"), createdAt: now(), text: st.text, owner: st.who ?? "site-manager", dueDay: st.dueDay, entryId: entry.id, kind: st.kind === "remind" ? "remind" : st.kind === "task" ? "task" : "other", status: "open" });
      // A task for an external party also needs to reach them, unless a notify/contact step already does.
      if (st.kind === "task" && external && !steps.some((o) => o !== st && (o.kind === "notify" || o.kind === "contact") && o.who === st.who)) {
        messages.push(draft(c.id, "action", `Bitte erledigen: ${st.text}`, `Hallo ${first(c.name)},\n\nbitte folgendes erledigen${st.dueDay !== undefined ? ` bis ${dayDE(st.dueDay)}` : ""}${where}:\n„${st.source === "user" ? st.text : entry.transcript}“\n\nBitte kurz bestätigen.${signature()}`, entry.id));
      }
    }
    // No message to the site manager himself, nor back to whoever reported it.
    if ((st.kind === "notify" || st.kind === "contact") && c && c.id !== "site-manager" && c.id !== entry.author) {
      const hasTask = steps.some((o) => o.kind === "task" && o.who === st.who);
      const action = st.kind === "contact" || hasTask;
      if (external) {
        // Messages are written in German from the original words; the English step text is for the app.
        const said = st.source === "user" ? st.text : entry.transcript;
        messages.push(
          draft(
            c.id,
            action ? "action" : "fyi",
            action ? `Bitte um Rückmeldung: ${entry.location ?? entry.summary.slice(0, 50)}` : `Zur Info: ${entry.location ?? entry.summary.slice(0, 50)}`,
            `Hallo ${first(c.name)},\n\n${action ? "wir brauchen eure Unterstützung" : "zur Info"}${where}:\n„${said}“${entry.photos.length ? `\n(${entry.photos.length} Foto(s) in der Baudokumentation)` : ""}\n\n${action ? "Bitte kurz Rückmeldung, wie und bis wann ihr das löst." : "Kein Handlungsbedarf, nur damit ihr Bescheid wisst."}${signature()}`,
            entry.id
          )
        );
      } else {
        // People who use the app (claims manager, planning) get a to-do instead of a message.
        todos.push({ id: uid("T"), createdAt: now(), text: st.text, owner: c.id, dueDay: st.dueDay, entryId: entry.id, kind: "other", status: "open" });
      }
    }
  }
  return { todos, messages };
}

/** After an accepted plan change: action for the team whose task moved, FYI for teams whose tasks shift as a consequence. */
export function changeMessages(before: Task[], after: Task[], taskId: string, reason: string, contacts: Contact[] = CONTACTS): OutMessage[] {
  const impact = computeImpact(before, after, taskId);
  const sched = schedule(after);
  const src = after.find((t) => t.id === taskId)!;
  const out: OutMessage[] = [];
  const srcContact = contactById(src.team, contacts);
  if (srcContact && !srcContact.usesApp) {
    out.push(
      draft(
        srcContact.id,
        "action",
        `Terminänderung bestätigt: ${src.name} ${src.section}`,
        `Hallo ${first(srcContact.name)},\n\nwir haben die Verschiebung übernommen: ${src.name}, Abschnitt ${src.section} läuft jetzt ${dayDE(sched[src.id].es)} bis ${dayDE(sched[src.id].ef)}.\nGrund: ${reason}\n\nBitte haltet diesen Termin ein und meldet euch sofort, falls sich weiter etwas verschiebt.${signature()}`
      )
    );
  }
  const byTeam = new Map<string, Task[]>();
  impact.changedTaskIds.forEach((id) => {
    const t = after.find((x) => x.id === id)!;
    if (t.team !== src.team) byTeam.set(t.team, [...(byTeam.get(t.team) ?? []), t]);
  });
  for (const [team, list] of byTeam) {
    const c = contactById(team, contacts);
    if (!c || c.usesApp) continue;
    out.push(
      draft(
        c.id,
        "fyi",
        `Zur Info: neue Termine für ${list.map((t) => `${t.name} ${t.section}`).join(", ")}`,
        `Hallo ${first(c.name)},\n\nzur Info: wegen einer Verschiebung bei ${src.name} ${src.section} ändern sich eure Termine:\n${list.map((t) => `- ${t.name}, Abschnitt ${t.section}: ${dayDE(sched[t.id].es)} bis ${dayDE(sched[t.id].ef)}`).join("\n")}\n\nKein Grund zur Eile – bitte Personal und Material entsprechend einplanen.${signature()}`
      )
    );
  }
  return out;
}

export function channelLink(channel: "whatsapp" | "sms" | "email", phone: string | undefined, email: string | undefined, subject: string, body: string) {
  const text = encodeURIComponent(body);
  if (channel === "whatsapp") return `https://wa.me/${(phone ?? "").replace(/[^\d]/g, "")}?text=${text}`;
  if (channel === "sms") return `sms:${phone ?? ""}?&body=${text}`;
  return `mailto:${email ?? ""}?subject=${encodeURIComponent(subject)}&body=${text}`;
}

export type { NextStep };
