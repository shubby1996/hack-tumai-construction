"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { channelLink } from "@/lib/messages";
import { clock } from "@/lib/dates";
import type { OutMessage } from "@/lib/types";
import { Badge, Button, Card, inputCls } from "./ui";

/** Ready-to-send messages for people who don't use the app. The site manager sends them from his phone. */
export function Outbox({ toast }: { toast: (m: string) => void }) {
  const { messages, contacts } = useStore();
  const [show, setShow] = useState<"draft" | "sent">("draft");
  const list = messages.filter((m) => m.status === show);
  const drafts = messages.filter((m) => m.status === "draft").length;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#e8e6e3] bg-white p-3 text-sm text-[#4b4c4e]">
        Subcontractors, the client and suppliers don’t use this app. SiteFlow prepares a personal message for each of them – <b>action</b> for whoever has to do
        something, <b>FYI</b> for whoever is only affected. Check the text, then send it via WhatsApp, SMS or email from your phone.
      </div>
      <div className="flex gap-2">
        {(["draft", "sent"] as const).map((k) => (
          <button key={k} onClick={() => setShow(k)} className={`rounded-full px-3 py-1 text-sm ${show === k ? "bg-[#1e1f21] text-white" : "bg-[#efedec] text-[#4b4c4e]"}`}>
            {k === "draft" ? `To send (${drafts})` : `Sent (${messages.length - drafts})`}
          </button>
        ))}
      </div>
      {list.length === 0 && (
        <Card>
          <p className="text-sm text-[#6d6e6f]">{show === "draft" ? "Nothing to send. Messages appear here when a log or a plan change affects someone outside the app." : "Nothing sent yet."}</p>
        </Card>
      )}
      {list.map((m) => (
        <MessageCard key={m.id} m={m} contact={contacts.find((c) => c.id === m.to)} toast={toast} />
      ))}
    </div>
  );
}

function MessageCard({ m, contact, toast }: { m: OutMessage; contact?: ReturnType<typeof useStore.getState>["contacts"][number]; toast: (msg: string) => void }) {
  const update = useStore((s) => s.updateMessage);
  const sent = useStore((s) => s.markMessageSent);
  const del = useStore((s) => s.deleteMessage);
  const [edit, setEdit] = useState(false);
  const open = (channel: "whatsapp" | "sms" | "email") => {
    window.open(channelLink(channel, contact?.phone, contact?.email, m.subject, m.body), "_blank", "noopener");
    sent(m.id, channel);
    toast(`Opened ${channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "Messages" : "Mail"} – marked as sent`);
  };
  return (
    <div data-testid="message">
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-[#1e1f21]">To {contact?.name ?? m.to}</p>
        <span className="text-xs text-[#6d6e6f]">
          {contact?.role} · {contact?.company}
        </span>
        <Badge tone={m.purpose === "action" ? "red" : "blue"}>{m.purpose === "action" ? "action needed" : "FYI"}</Badge>
        <span className="ml-auto text-xs text-[#6d6e6f]">
          {m.status === "sent" ? `sent ${clock(m.sentAt!)} via ${m.channel}` : `prepared ${clock(m.createdAt)}`}
        </span>
      </div>
      <p className="mt-1 text-xs font-medium text-[#4b4c4e]">{m.subject}</p>
      {edit ? (
        <textarea className={`${inputCls} mt-2 min-h-40 font-mono text-xs`} value={m.body} onChange={(e) => update(m.id, e.target.value)} />
      ) : (
        <p className="mt-2 whitespace-pre-line rounded-lg bg-[#f9f8f8] p-2 text-sm text-[#1e1f21]">{m.body}</p>
      )}
      {m.status === "draft" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {contact?.phone && (
            <Button variant="primary" onClick={() => open("whatsapp")}>
              WhatsApp
            </Button>
          )}
          {contact?.phone && <Button onClick={() => open("sms")}>SMS</Button>}
          {contact?.email && <Button onClick={() => open("email")}>Email</Button>}
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(m.body);
              } catch {}
              sent(m.id, "copy");
              toast("Copied – marked as sent");
            }}
          >
            Copy
          </Button>
          <Button variant="ghost" onClick={() => setEdit(!edit)}>
            {edit ? "Done" : "Edit"}
          </Button>
          <Button variant="ghost" onClick={() => del(m.id)}>
            Discard
          </Button>
        </div>
      )}
    </Card>
    </div>
  );
}
