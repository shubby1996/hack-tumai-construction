// Synthetic demo site: one residential building, shell construction,
// a two-week lookahead plan with four subcontractor teams.
// All names and figures are fictional.

import type { Milestone, Persona, Settings, Task, Team } from "./types";

export const PROJECT = {
  name: "Wohnanlage Lindenhof, Haus 2",
  address: "Lindenstraße 12, 91052 Erlangen",
  contractor: "Hauptbau GmbH",
  client: "Lindenhof Wohnbau GmbH & Co. KG",
  contractBasis: "VOB/B",
  planStart: "2026-11-23", // Monday, working-day index 0
  today: 1, // the demo day (Tuesday 24 Nov 2026)
};

export const TEAMS: Team[] = [
  { id: "earthworks", name: "Earthworks", company: "Erdbau Huber GmbH", color: "#b45309" },
  { id: "formwork", name: "Formwork", company: "Schalungsbau Weber GmbH", color: "#2563eb" },
  { id: "rebar", name: "Rebar", company: "Bewehrung Kraus GmbH", color: "#7c3aed" },
  { id: "concrete", name: "Concrete", company: "Betonbau Schmid GmbH", color: "#0f766e" },
];

export const PERSONAS: Persona[] = [
  { id: "site-manager", name: "Max Bauer", role: "Site manager (Bauleiter)", company: "Hauptbau GmbH" },
  { id: "earthworks", name: "Jonas Huber", role: "Foreman, Earthworks", company: "Erdbau Huber GmbH", team: "earthworks" },
  { id: "formwork", name: "Lena Weber", role: "Foreman, Formwork", company: "Schalungsbau Weber GmbH", team: "formwork" },
  { id: "rebar", name: "Mehmet Kaya", role: "Foreman, Rebar", company: "Bewehrung Kraus GmbH", team: "rebar" },
  { id: "concrete", name: "Piotr Nowak", role: "Foreman, Concrete", company: "Betonbau Schmid GmbH", team: "concrete" },
];

export const MILESTONES: Milestone[] = [
  { id: "M1", name: "Foundation section C complete", targetDay: 5 },
  { id: "M2", name: "Shell floor 2, section A complete", targetDay: 9 },
];

export const SETTINGS: Settings = {
  maxExtraCrewsPerDay: 1,
  maxOvertimeHoursPerDay: 2,
  hoursPerDay: 8,
  preventiveHorizonDays: 5,
  maxAlerts: 3,
};

const ready = () => ({
  predecessor: { state: "cleared" as const },
  material: { state: "cleared" as const },
  crew: { state: "cleared" as const },
  equipment: { state: "cleared" as const },
  permit: { state: "cleared" as const },
  drawings: { state: "cleared" as const },
});

export const SEED_TASKS: Task[] = [
  // Earthworks
  { id: "E1", name: "Excavation foundation", team: "earthworks", section: "C", plannedStart: 0, duration: 2, crew: 4, predecessors: [], status: "in-progress", delayDays: 0, readiness: ready() },
  { id: "E2", name: "Backfill basement walls", team: "earthworks", section: "A", plannedStart: 4, duration: 1, crew: 4, predecessors: [], status: "planned", delayDays: 0, readiness: ready() },
  { id: "E3", name: "Gravel base site road", team: "earthworks", section: "", plannedStart: 6, duration: 1, crew: 3, predecessors: [], status: "planned", delayDays: 0, readiness: ready() },

  // Formwork
  { id: "F1", name: "Formwork walls floor 2", team: "formwork", section: "A", plannedStart: 0, duration: 2, crew: 6, predecessors: [], status: "in-progress", delayDays: 0, readiness: ready() },
  { id: "F2", name: "Formwork foundation", team: "formwork", section: "C", plannedStart: 2, duration: 2, minDuration: 1, crew: 6, predecessors: ["E1"], status: "planned", delayDays: 0, readiness: ready() },
  { id: "F3", name: "Formwork walls floor 2", team: "formwork", section: "B", plannedStart: 4, duration: 2, crew: 6, predecessors: ["F1"], status: "planned", delayDays: 0, readiness: ready() },
  {
    id: "F4", name: "Formwork slab floor 2", team: "formwork", section: "A", plannedStart: 5, duration: 2, crew: 6, predecessors: ["C1"], status: "planned", delayDays: 0,
    readiness: { ...ready(), drawings: { state: "open", note: "Revised slab drawings (stairwell opening) not yet received from the client", owner: "Client", dueDay: 3 } },
  },

  // Rebar
  { id: "R1", name: "Rebar walls floor 2", team: "rebar", section: "A", plannedStart: 2, duration: 1, crew: 4, predecessors: ["F1"], status: "planned", delayDays: 0, readiness: ready() },
  {
    id: "R2", name: "Rebar foundation", team: "rebar", section: "C", plannedStart: 4, duration: 1, crew: 4, predecessors: ["F2"], status: "planned", delayDays: 0,
    readiness: { ...ready(), material: { state: "open", note: "Rebar steel for section C (6.2 t) – delivery not confirmed by the supplier", owner: "Steel supplier (Stahlhandel Müller)", dueDay: 3 } },
  },
  { id: "R3", name: "Rebar slab floor 2", team: "rebar", section: "A", plannedStart: 7, duration: 2, crew: 4, predecessors: ["F4"], status: "planned", delayDays: 0, readiness: ready() },

  // Concrete
  {
    id: "C1", name: "Pour walls floor 2", team: "concrete", section: "A", plannedStart: 3, duration: 1, crew: 5, predecessors: ["R1"], status: "planned", delayDays: 0,
    readiness: { ...ready(), equipment: { state: "open", note: "Crane slot on Thursday is double-booked with formwork", owner: "Site manager", dueDay: 2 } },
  },
  { id: "C2", name: "Pour foundation", team: "concrete", section: "C", plannedStart: 5, duration: 1, crew: 5, predecessors: ["R2"], milestone: "M1", status: "planned", delayDays: 0, readiness: ready() },
  { id: "C3", name: "Pour walls floor 2", team: "concrete", section: "B", plannedStart: 7, duration: 1, crew: 5, predecessors: ["F3"], status: "planned", delayDays: 0, readiness: ready() },
  { id: "C4", name: "Pour slab floor 2", team: "concrete", section: "A", plannedStart: 9, duration: 1, crew: 5, predecessors: ["R3"], milestone: "M2", status: "planned", delayDays: 0, readiness: ready() },
];

// Sample dictations for a reliable live demo (German and English).
export const SAMPLE_PHRASES: { label: string; persona: string; text: string }[] = [
  { label: "Excavator idle (DE)", persona: "earthworks", text: "Bagger steht seit 10 Uhr in Abschnitt C, der Leitungsplan vom Bauherrn fehlt, Versorgungsleitung nicht markiert." },
  { label: "Excavator idle (EN)", persona: "earthworks", text: "Excavator idle since 10 am in section C, the utility plan from the client is missing." },
  { label: "Wrong steel delivered", persona: "rebar", text: "Stahllieferung für Abschnitt C angekommen, 2 Tonnen falscher Durchmesser, 12 statt 16 Millimeter." },
  { label: "Crack in wall", persona: "site-manager", text: "Riss in der Wand Abschnitt A, zweites Obergeschoss, Nacharbeit durch Betonbau Schmid nötig." },
  { label: "Walls done", persona: "formwork", text: "Schalung Wände zweites OG Abschnitt A fertig." },
];
