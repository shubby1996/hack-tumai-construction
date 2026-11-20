"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Shows a QR code of the current URL so testers can open the app on their phone. */
export function PhoneQr({ onClose }: { onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const url = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    QRCode.toDataURL(url, { width: 280, margin: 1 }).then(setSrc);
  }, [url]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-xl bg-white p-5 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-stone-900">Open SiteFlow on your phone</p>
        <p className="mt-1 text-xs text-stone-500">Scan with the camera app. Each phone keeps its own demo data.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="QR code" className="mx-auto mt-3 h-56 w-56" /> : <div className="mx-auto mt-3 h-56 w-56 animate-pulse rounded bg-stone-100" />}
        <p className="mt-2 break-all text-xs text-stone-500">{url}</p>
        <button onClick={onClose} className="mt-3 rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium hover:bg-stone-200">
          Close
        </button>
      </div>
    </div>
  );
}
