import { SEED_TASKS, PROJECT } from "../src/lib/seed";
import { schedule, milestoneSlips, preventiveScan, proposeReplan, applyActions, withDelay, computeImpact } from "../src/lib/engine";
const s = schedule(SEED_TASKS);
console.log("schedule", Object.entries(s).map(([k,v])=>`${k}:${v.es}-${v.ef}`).join(" "));
console.log("slips", milestoneSlips(SEED_TASKS, s).map(x=>`${x.milestone.id}:${x.slip}`));
console.log("alerts", preventiveScan(SEED_TASKS, PROJECT.today).map(a=>`${a.taskId}/${a.key} due ${a.dueDay} slack ${a.slack}`));
const p = proposeReplan(SEED_TASKS, "E1", 1, PROJECT.today, 10);
console.log("impact", p.impact.changedTaskIds, p.impact.affectedTeams, p.impact.slipsAfter.map(x=>`${x.milestone.id}:${x.slip}`));
for (const a of p.actions) console.log(" -", a.kind, a.taskId, a.fromDay, "->", a.toDay, a.reason);
console.log(p.explanation.join("\n"));
const after = applyActions(withDelay(SEED_TASKS,"E1",1), p.actions);
const s2 = schedule(after);
console.log("after", Object.entries(s2).map(([k,v])=>`${k}:${v.es}-${v.ef}`).join(" "));
// foreman change: F4 +1
const ch = after.map(t=>t.id==="F4"?{...t, plannedStart: t.plannedStart+1}:t);
const imp = computeImpact(after, ch, "F4");
console.log("F4 change", imp.changedTaskIds, imp.notify, imp.slipsAfter.map(x=>`${x.milestone.id}:${x.slip}`));
