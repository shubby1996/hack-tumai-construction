// SiteFlow mock – seed data. Edit freely: everything the screens show starts here.
// Mirrors src/lib/seed.ts. After editing, click "Reset demo" in the sidebar (state is kept in localStorage).

window.SF = window.SF || {};

SF.PROJECT = {
  name: "Wohnanlage Lindenhof, Haus 2",
  address: "Lindenstraße 12, 91052 Erlangen",
  contractor: "Hauptbau GmbH",
  client: "Lindenhof Wohnbau GmbH & Co. KG",
  contractBasis: "VOB/B",
  planStart: "2026-11-23", // Monday, working-day index 0
  today: 1, // demo day (Tuesday 24 Nov 2026)
};

SF.TEAMS = [
  { id: "earthworks", name: "Earthworks", company: "Erdbau Huber GmbH", color: "#b45309" },
  { id: "formwork", name: "Formwork", company: "Schalungsbau Weber GmbH", color: "#2563eb" },
  { id: "rebar", name: "Rebar", company: "Bewehrung Kraus GmbH", color: "#7c3aed" },
  { id: "concrete", name: "Concrete", company: "Betonbau Schmid GmbH", color: "#0f766e" },
];

SF.PERSONAS = [
  { id: "site-manager", name: "Max Bauer", role: "Site manager (Bauleiter)", company: "Hauptbau GmbH" },
  { id: "earthworks", name: "Jonas Huber", role: "Foreman, Earthworks", company: "Erdbau Huber GmbH", team: "earthworks" },
  { id: "formwork", name: "Lena Weber", role: "Foreman, Formwork", company: "Schalungsbau Weber GmbH", team: "formwork" },
  { id: "rebar", name: "Mehmet Kaya", role: "Foreman, Rebar", company: "Bewehrung Kraus GmbH", team: "rebar" },
  { id: "concrete", name: "Piotr Nowak", role: "Foreman, Concrete", company: "Betonbau Schmid GmbH", team: "concrete" },
];

SF.MILESTONES = [
  { id: "M1", name: "Foundation section C complete", targetDay: 5 },
  { id: "M2", name: "Shell floor 2, section A complete", targetDay: 9 },
];

SF.SETTINGS = { maxExtraCrewsPerDay: 1, maxOvertimeHoursPerDay: 2, hoursPerDay: 8, preventiveHorizonDays: 5, maxAlerts: 3 };

const ready = () => ({
  predecessor: { state: "cleared" },
  material: { state: "cleared" },
  crew: { state: "cleared" },
  equipment: { state: "cleared" },
  permit: { state: "cleared" },
  drawings: { state: "cleared" },
});

SF.SEED_TASKS = [
  { id: "E1", name: "Excavation foundation", team: "earthworks", section: "C", plannedStart: 0, duration: 2, crew: 4, predecessors: [], status: "in-progress", delayDays: 0, readiness: ready() },
  { id: "E2", name: "Backfill basement walls", team: "earthworks", section: "A", plannedStart: 4, duration: 1, crew: 4, predecessors: [], status: "planned", delayDays: 0, readiness: ready() },
  { id: "E3", name: "Gravel base site road", team: "earthworks", section: "", plannedStart: 6, duration: 1, crew: 3, predecessors: [], status: "planned", delayDays: 0, readiness: ready() },

  { id: "F1", name: "Formwork walls floor 2", team: "formwork", section: "A", plannedStart: 0, duration: 2, crew: 6, predecessors: [], status: "in-progress", delayDays: 0, readiness: ready() },
  { id: "F2", name: "Formwork foundation", team: "formwork", section: "C", plannedStart: 2, duration: 2, minDuration: 1, crew: 6, predecessors: ["E1"], status: "planned", delayDays: 0, readiness: ready() },
  { id: "F3", name: "Formwork walls floor 2", team: "formwork", section: "B", plannedStart: 4, duration: 2, crew: 6, predecessors: ["F1"], status: "planned", delayDays: 0, readiness: ready() },
  { id: "F4", name: "Formwork slab floor 2", team: "formwork", section: "A", plannedStart: 5, duration: 2, crew: 6, predecessors: ["C1"], status: "planned", delayDays: 0,
    readiness: { ...ready(), drawings: { state: "open", note: "Revised slab drawings (stairwell opening) not yet received from the client", owner: "Client", dueDay: 3 } } },

  { id: "R1", name: "Rebar walls floor 2", team: "rebar", section: "A", plannedStart: 2, duration: 1, crew: 4, predecessors: ["F1"], status: "planned", delayDays: 0, readiness: ready() },
  { id: "R2", name: "Rebar foundation", team: "rebar", section: "C", plannedStart: 4, duration: 1, crew: 4, predecessors: ["F2"], status: "planned", delayDays: 0,
    readiness: { ...ready(), material: { state: "open", note: "Rebar steel for section C (6.2 t) – delivery not confirmed by the supplier", owner: "Steel supplier (Stahlhandel Müller)", dueDay: 3 } } },
  { id: "R3", name: "Rebar slab floor 2", team: "rebar", section: "A", plannedStart: 7, duration: 2, crew: 4, predecessors: ["F4"], status: "planned", delayDays: 0, readiness: ready() },

  { id: "C1", name: "Pour walls floor 2", team: "concrete", section: "A", plannedStart: 3, duration: 1, crew: 5, predecessors: ["R1"], status: "planned", delayDays: 0,
    readiness: { ...ready(), equipment: { state: "open", note: "Crane slot on Thursday is double-booked with formwork", owner: "Site manager", dueDay: 2 } } },
  { id: "C2", name: "Pour foundation", team: "concrete", section: "C", plannedStart: 5, duration: 1, crew: 5, predecessors: ["R2"], milestone: "M1", status: "planned", delayDays: 0, readiness: ready() },
  { id: "C3", name: "Pour walls floor 2", team: "concrete", section: "B", plannedStart: 7, duration: 1, crew: 5, predecessors: ["F3"], status: "planned", delayDays: 0, readiness: ready() },
  { id: "C4", name: "Pour slab floor 2", team: "concrete", section: "A", plannedStart: 9, duration: 1, crew: 5, predecessors: ["R3"], milestone: "M2", status: "planned", delayDays: 0, readiness: ready() },
];

SF.SAMPLE_PHRASES = [
  { label: "Excavator idle (DE)", persona: "earthworks", text: "Bagger steht seit 10 Uhr in Abschnitt C, der Leitungsplan vom Bauherrn fehlt, Versorgungsleitung nicht markiert." },
  { label: "Excavator idle (EN)", persona: "earthworks", text: "Excavator idle since 10 am in section C, the utility plan from the client is missing." },
  { label: "Wrong steel delivered", persona: "rebar", text: "Stahllieferung für Abschnitt C angekommen, 2 Tonnen falscher Durchmesser, 12 statt 16 Millimeter." },
  { label: "Crack in wall", persona: "site-manager", text: "Riss in der Wand Abschnitt A, zweites Obergeschoss, Nacharbeit durch Betonbau Schmid nötig." },
  { label: "Walls done", persona: "formwork", text: "Schalung Wände zweites OG Abschnitt A fertig." },
  { label: "Rebar 2 days late", persona: "site-manager", text: "Herr Kaya von Bewehrung Kraus ruft an: Bewehrung Decke zweites OG Abschnitt A kommt 2 Tage später, Stahl fehlt noch." },
  { label: "Basement floor broken", persona: "site-manager", text: "Im Keller ist der Boden an der Treppe gebrochen. Erst in drei Monaten erneut ansprechen, vorher nichts tun." },
];

SF.CONTACTS = [
  { id: "site-manager", name: "Max Bauer", role: "Site manager (Bauleiter)", company: "Hauptbau GmbH", email: "m.bauer@hauptbau.example", usesApp: true },
  { id: "earthworks", name: "Jonas Huber", role: "Foreman, Earthworks", company: "Erdbau Huber GmbH", team: "earthworks", phone: "+4915100000001", email: "j.huber@erdbau-huber.example", usesApp: false },
  { id: "formwork", name: "Lena Weber", role: "Foreman, Formwork", company: "Schalungsbau Weber GmbH", team: "formwork", phone: "+4915100000002", email: "l.weber@schalungsbau-weber.example", usesApp: false },
  { id: "rebar", name: "Mehmet Kaya", role: "Foreman, Rebar", company: "Bewehrung Kraus GmbH", team: "rebar", phone: "+4915100000003", email: "m.kaya@bewehrung-kraus.example", usesApp: false },
  { id: "concrete", name: "Piotr Nowak", role: "Foreman, Concrete", company: "Betonbau Schmid GmbH", team: "concrete", phone: "+4915100000004", email: "p.nowak@betonbau-schmid.example", usesApp: false },
  { id: "client", name: "Dr. Sabine Roth", role: "Client representative (Bauherr)", company: "Lindenhof Wohnbau GmbH & Co. KG", email: "s.roth@lindenhof-wohnbau.example", usesApp: false },
  { id: "supplier", name: "Stahlhandel Müller", role: "Steel supplier", company: "Stahlhandel Müller GmbH", phone: "+4915100000005", email: "dispo@stahl-mueller.example", usesApp: false },
  { id: "claims", name: "Thomas Lang", role: "Claims manager (Nachtragsmanager)", company: "Hauptbau GmbH", email: "t.lang@hauptbau.example", usesApp: true },
  { id: "planning", name: "Arbeitsvorbereitung", role: "Planning department", company: "Hauptbau GmbH", email: "av@hauptbau.example", usesApp: true },
];

SF.SITE_DOCUMENTS = [
  { name: "Bauzeitenplan_Haus2_KW48-49.xlsx", kind: "Schedule", note: "Imported → 14 tasks, 4 teams, 2 milestones" },
  { name: "Lageplan_und_Grundrisse_Haus2.pdf", kind: "Site map / plans", pages: 38, note: "Sections A–C, floors basement–3" },
  { name: "Bauvertrag_VOB-B_Hauptbau.pdf", kind: "Contract", pages: 64, note: "Contract basis VOB/B, notice periods" },
  { name: "Baubeschreibung_Haus2.pdf", kind: "Specification", pages: 112, note: "Materials, e.g. rebar Ø 16 mm in foundations" },
  { name: "Protokoll_Baubesprechung_17-11.pdf", kind: "Meeting minutes", pages: 6, note: "Open items carried over" },
  { name: "Nachunternehmerliste.xlsx", kind: "Contacts", note: "Subcontractors, foremen, phone numbers" },
];

SF.SAMPLE_MINUTES = `Baubesprechung 24.11.2026, Haus 2 – Teilnehmer: Bauherr (Dr. Roth), Hauptbau (Bauer), Schalungsbau Weber, Bewehrung Kraus
1. Bauherr liefert die überarbeiteten Deckenpläne (Treppenhausöffnung) bis Donnerstag.
2. Schalungsbau Weber stellt für Abschnitt B eine zusätzliche Kolonne ab Mittwoch.
3. Bewehrung Kraus: Stahllieferung für Abschnitt C muss bis Donnerstag bestätigt werden, Herr Kaya klärt mit Stahlhandel Müller.
4. Kranbelegung Donnerstag: Betonage hat Vorrang vor Schalung, Bauleitung stimmt mit Weber ab.
5. Nächste Baubesprechung: Dienstag, 01.12.2026.`;
