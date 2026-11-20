"use client";

import { useStore } from "@/lib/store";
import { TaskEditor, canEdit } from "./TaskEditor";
import { CheckCircle } from "./ui";

/** Right-hand task detail panel (full screen on phones). */
export function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { tasks, persona, changes } = useStore();
  const changeTask = useStore((s) => s.changeTask);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const done = task.status === "done";
  const editable = canEdit(persona, task);
  const history = changes.filter((c) => c.taskId === task.id).slice(0, 5);

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/20 lg:bg-transparent" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-[#e8e6e3] bg-white shadow-2xl sm:w-[520px]">
        <div className="flex items-center gap-2 border-b border-[#e8e6e3] px-4 py-3">
          <button
            disabled={!editable}
            onClick={() => changeTask(task.id, { status: done ? "planned" : "done" }, done ? "Marked incomplete" : "Marked complete")}
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${done ? "border-[#58a182] bg-[#d8f2e4] text-[#0f6b3e]" : "border-[#cfcbcb] text-[#1e1f21] hover:bg-[#f5f4f3]"} disabled:opacity-50`}
          >
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${done ? "border-[#58a182] bg-[#58a182] text-white" : "border-[#9ca0a5]"}`}>{done ? "✓" : ""}</span>
            {done ? "Completed" : "Mark complete"}
          </button>
          <span className="ml-auto text-xs text-[#6d6e6f]">{task.id}</span>
          <button onClick={onClose} className="rounded-md p-1.5 text-[#6d6e6f] hover:bg-[#f5f4f3]" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-24 pt-4">
          <div className="mb-4 flex items-start gap-3">
            <CheckCircle done={done} disabled={!editable} onClick={() => changeTask(task.id, { status: done ? "planned" : "done" }, done ? "Marked incomplete" : "Marked complete")} />
            <h2 className={`-mt-1 text-2xl font-medium text-[#1e1f21] ${done ? "text-[#6d6e6f] line-through" : ""}`}>
              {task.name} {task.section}
            </h2>
          </div>
          <TaskEditor key={`${task.id}-${task.plannedStart}-${task.duration}-${task.status}`} task={task} />
          {history.length > 0 && (
            <div className="mt-6 border-t border-[#e8e6e3] pt-4">
              <p className="mb-2 text-sm font-medium text-[#1e1f21]">Activity</p>
              <ul className="space-y-1.5 text-xs text-[#6d6e6f]">
                {history.map((c) => (
                  <li key={c.id}>
                    {new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · changed {JSON.stringify(c.after)}
                    {c.reason ? ` – “${c.reason}”` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
