// Core domain types for the shared two-week site plan.

export type TeamId = "earthworks" | "formwork" | "rebar" | "concrete";

export type PersonaId = "site-manager" | TeamId;

export interface Persona {
  id: PersonaId;
  name: string;
  role: string;
  company: string;
  team?: TeamId;
}

export interface Team {
  id: TeamId;
  name: string; // trade, e.g. "Earthworks"
  company: string; // subcontractor company
  color: string; // tailwind-friendly hex for bars
}

export type ReadinessKey =
  | "predecessor"
  | "material"
  | "crew"
  | "equipment"
  | "permit"
  | "drawings";

export interface ReadinessItem {
  state: "open" | "cleared";
  note?: string; // what exactly is missing
  owner?: string; // who must clear it (e.g. "Client", "Steel supplier")
  dueDay?: number; // working-day index by which it must be cleared
}

export type TaskStatus = "planned" | "in-progress" | "blocked" | "done";

export interface Task {
  id: string;
  name: string;
  team: TeamId;
  section: string; // e.g. "A", "B", "C"
  plannedStart: number; // working-day index in the two-week window (0..9)
  duration: number; // working days
  crew: number; // workers
  predecessors: string[];
  milestone?: string; // milestone id this task completes
  status: TaskStatus;
  delayDays: number; // extra days caused by stoppages (added to duration)
  minDuration?: number; // shortest duration if an extra crew is added (crashing)
  readiness: Partial<Record<ReadinessKey, ReadinessItem>>;
}

export interface Milestone {
  id: string;
  name: string;
  targetDay: number; // must finish by end of this working day
}

export type EntryType =
  | "stoppage"
  | "delivery"
  | "defect"
  | "incident"
  | "meeting"
  | "attendance"
  | "progress"
  | "instruction"
  | "note";

export interface EntryFields {
  taskId?: string;
  cause?: string;
  responsibleParty?: string;
  startTime?: string;
  estimatedDelayDays?: number;
  material?: string;
  quantity?: string;
  location?: string;
  severity?: string;
  participants?: string;
  decisions?: string;
  openItems?: string;
  [key: string]: string | number | undefined;
}

// ---- New unified log format (alongside the older type/fields) ----

export type NextStepKind = "task" | "notify" | "contact" | "remind" | "other";

export interface NextStep {
  id: string;
  kind: NextStepKind;
  text: string; // what should happen
  who?: string; // contact id (persona id or external contact id)
  dueDay?: number; // working-day index
  source: "ai" | "user" | "rules"; // user = stated by the speaker (overrides AI)
}

export interface Contact {
  id: string; // persona ids for the team, plus external contacts
  name: string;
  role: string;
  company: string;
  phone?: string; // for WhatsApp / SMS
  email?: string;
  team?: TeamId;
  usesApp: boolean; // subcontractors do not use the app in reality
}

export interface Todo {
  id: string;
  createdAt: string;
  text: string;
  owner?: string; // contact id
  dueDay?: number;
  entryId?: string;
  kind: "task" | "remind" | "other";
  status: "open" | "done";
}

export interface OutMessage {
  id: string;
  createdAt: string;
  to: string; // contact id
  subject: string;
  body: string;
  purpose: "action" | "fyi";
  entryId?: string;
  status: "draft" | "sent";
  sentAt?: string;
  channel?: "whatsapp" | "sms" | "email" | "copy";
}

export interface ProposedChange {
  id: string;
  createdAt: string;
  entryId: string;
  taskId: string;
  days: number; // delay in working days
  mode: "shift" | "extend"; // shift start (not started yet) or extend duration (already running)
  reason: string;
  reportedBy: PersonaId;
  status: "pending" | "accepted" | "rejected";
  decidedAt?: string;
}

export interface DiaryEntry {
  id: string;
  createdAt: string; // ISO timestamp
  day: number; // working-day index
  author: PersonaId;
  type: EntryType;
  transcript: string; // original words
  summary: string; // cleaned one-liner
  fields: EntryFields;
  photos: string[]; // data URLs (downscaled)
  photoNotes?: string[]; // what the vision model saw on each photo
  // unified log format
  location?: string;
  state?: string; // current state, one or two sentences
  nextSteps?: NextStep[];
  source?: "voice" | "text" | "photo" | "minutes";
  engine: "open" | "claude" | "rules";
  model?: string;
}

export type NoticeType =
  | "behinderung" // obstruction / delay notice, § 6 Abs. 1 VOB/B
  | "mehrkosten" // additional cost notice, § 2 Abs. 5/6 VOB/B
  | "bedenken" // notice of concern, § 4 Abs. 3 VOB/B
  | "maengel" // defect notice, § 4 Abs. 7 VOB/B
  | "anforderung" // request for documents / clearance, § 3 Abs. 1 VOB/B
  | "tagesbericht"; // daily site report

export interface Notice {
  id: string;
  type: NoticeType;
  title: string;
  addressee: string;
  body: string; // editable plain text
  refs: string[]; // diary entry ids / task ids it is based on
  status: "draft" | "approved";
  createdAt: string;
  approvedAt?: string;
  mode: "preventive" | "reactive" | "report";
}

export interface Notification {
  id: string;
  createdAt: string;
  to: PersonaId[];
  text: string;
  kind: "change" | "replan" | "alert" | "notice";
  from?: PersonaId; // who triggered it
  readBy: PersonaId[];
}

export interface Decision {
  id: string;
  createdAt: string;
  day: number;
  by: PersonaId;
  kind: "preventive" | "reactive" | "change";
  text: string;
}

export interface ChangeRecord {
  id: string;
  createdAt: string;
  by: PersonaId;
  taskId: string;
  before: Partial<Task>;
  after: Partial<Task>;
  reason: string;
  affectedTaskIds: string[];
  notified: PersonaId[];
}

export interface Settings {
  maxExtraCrewsPerDay: number;
  maxOvertimeHoursPerDay: number;
  hoursPerDay: number;
  preventiveHorizonDays: number;
  maxAlerts: number;
}
