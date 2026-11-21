# SiteFlow HTML mock (v0.7)

**Speak on site → the app sorts it → the right person gets the job.**

A no-build, clickable copy of the whole app, used to try out UX changes before they go into the Next.js app. Open `mock/index.html` in Chrome or Edge, either by double-clicking it or through a local server (`npx serve .`). It needs internet only for the Tailwind CDN. For the phone layout, use the device toolbar (F12 → Ctrl+Shift+M, 390 × 844).

## Three areas

| Area | What's there |
| --- | --- |
| ☀ **Today** | Record + 📎 Attach · **Needs you (N)**: one list of everything waiting for you (re-plans, plan changes, letters to draft or approve, updates to send, coming-up risks, to-dos, updates from others) · milestone strip · my tasks · 📄 Day report |
| 🎙 **Record** | The big middle button. Speak, stop, and it sorts itself into one confirmation card; typed text is sorted on ↵. All fields sit under *Edit details* |
| 🗺 **Plan** | Timeline · Site, plus ⋯ More: Library (all reports, grouped by who added them), Task list, Site notes, Documents, History, Setup |

Switch person and reset the demo from the avatar (profile menu).

## Demo script (≈ 5 min)

1. **07:00 – Coming up: risks.** As *Max Bauer*, Today › Needs you shows three risks: crane double-booked, slab drawings missing, steel unconfirmed. On *Formwork slab floor 2 A · drawings missing*, tap **📄 Request**. The letter appears as *Approve · Anforderung Unterlagen*: tap **…** to read or edit it, then **✓ Approve**.
2. **10:00 – Problem.** Tap **🎙** (bottom middle), turn **🧪 Demo** on and tap *Excavator idle (DE)*. The card shows: 🔴 Stoppage · Excavation foundation C · since 10:00, the cause, and the next steps *Inform Jonas H.* and *To-do for you, today* (AI). Answer **❓ How long? → 1 day**, then **✓ Save**.
3. **Re-plan.** Back on Today, the card *⚡ Re-plan* shows ◆ +1 d → ok and 👷 −72 h idle. Tap **…** for the actions, then **✓ Approve**.
4. **Letter.** *✍ Letter · Behinderungsanzeige* → **📄 Draft** → *Approve · Behinderungsanzeige*. Tap **…** to edit inline, **✓ Approve**, then PDF in Plan › More › Documents.
5. **11:00 – Change control.** Avatar → *Lena Weber*. Today › My tasks → *Formwork slab floor 2 A* → ▶ **+** (one day) → reason → **✓ Apply & notify**. Avatar → *Mehmet Kaya*: Needs you shows Lena's change, and the milestone strip turns red (◆ Shell floor 2 · +1 d). Plan shows only his tasks plus linked ones (*depends on you* / *you wait on this*).
6. **11:30 – Call from a sub.** Back as *Max*: 🎙 → *Rebar 2 days late* → **✓ Save**. Needs you: *📅 Plan change · Rebar slab floor 2 A* (Delay +2 d) → **✓ Accept**.
7. **Send updates.** Needs you: *✉ Send update · …* cards (action / FYI) → **💬 Send** (WhatsApp). Other channels sit behind **…**.
8. **The speaker's instruction wins.** 🎙 → *Basement floor broken* → the only next step is *Remind you, in 3 months* (YOU) → **✓ Save**.
9. **Minutes.** Plan › ⋯ More › Site notes → **📝** → 🧪 Sample → Split → **✓ Save**. Filter with All · ⚠ Problems · 📝 Notes.
10. **17:00 – Report.** Today › **📄 Day report …** → *Daily report* → *Approve · Bautagesbericht* in Needs you.

## Files

| File | What to edit there |
| --- | --- |
| `index.html` | Design tokens (`ink`, `muted`, `accent`, `ok`, `bad`, `warn`, `sel` …) |
| `data.js` | Seed data: project, teams, people, the 14 tasks, milestones, demo phrases, contacts, sample minutes |
| `app.js` | Every screen (search for `VIEW:`), plus `needsYou()`, which builds the Needs you list |
| `engine.js` | Logic ported from `src/lib`: scheduling, re-plan, extractor, AI fill of next steps, templates, messages |

Differences from the real app: there is no AI model. The rule extractor stands in for it, including the "AI" who and when on next steps. Photos are not analysed, schedule import reads `.csv` only, documents export as print-to-PDF or `.txt`, and voice needs a browser with speech recognition.
