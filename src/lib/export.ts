"use client";

// PDF and Word export of notices and reports, fully client-side.

import type { Notice } from "./types";

const fileName = (n: Notice, ext: string) =>
  `${n.title.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "")}.${ext}`;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// jsPDF's built-in fonts only cover Latin-1/WinAnsi: replace symbols they cannot draw.
const pdfSafe = (s: string) =>
  s
    .replace(/→/g, "->")
    .replace(/≈/g, "ca.")
    .replace(/⚠/g, "!")
    .replace(/◆/g, "*")
    .replace(/✓/g, "OK")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "");

export async function exportPdf(n: Notice) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const left = 20;
  const width = 170;
  let y = 20;
  const status = n.status === "approved" ? "FREIGEGEBEN" : "ENTWURF";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(n.status === "approved" ? 22 : 180, n.status === "approved" ? 101 : 83, n.status === "approved" ? 52 : 9);
  doc.text(status, 190, 12, { align: "right" });
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  for (const raw of pdfSafe(n.body).split("\n")) {
    const isSubject = raw.startsWith("Betreff:") || raw.startsWith("Bautagesbericht –");
    const isHeading = /^\d\. /.test(raw);
    const isDisclaimer = raw.startsWith("ENTWURF –");
    doc.setFont("helvetica", isSubject || isHeading ? "bold" : isDisclaimer ? "italic" : "normal");
    doc.setFontSize(isDisclaimer ? 8.5 : 11);
    const lines = raw === "" ? [""] : doc.splitTextToSize(raw, width);
    for (const line of lines) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, left, y);
      y += raw === "" ? 3.5 : 5.5;
    }
  }
  download(doc.output("blob"), fileName(n, "pdf"));
}

export async function exportDocx(n: Notice) {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const children = [
    new Paragraph({
      children: [new TextRun({ text: n.status === "approved" ? "FREIGEGEBEN" : "ENTWURF", bold: true, size: 18, color: n.status === "approved" ? "166534" : "B45309" })],
    }),
    ...n.body.split("\n").map((raw) => {
      const isSubject = raw.startsWith("Betreff:") || raw.startsWith("Bautagesbericht –");
      const isHeading = /^\d\. /.test(raw);
      const isDisclaimer = raw.startsWith("ENTWURF –");
      return new Paragraph({
        spacing: { after: raw === "" ? 0 : 60 },
        children: [new TextRun({ text: raw, bold: isSubject || isHeading, italics: isDisclaimer, size: isDisclaimer ? 17 : 22, font: "Arial" })],
      });
    }),
  ];
  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  download(blob, fileName(n, "docx"));
}
