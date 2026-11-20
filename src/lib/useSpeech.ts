"use client";

// Browser speech-to-text via the Web Speech API (Chrome, Edge, Safari).
// Free and keyless; good enough for the demo. Swap for Whisper later.

import { useCallback, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Recognition = any;

export function useSpeech(lang: "de-DE" | "en-US") {
  // The app renders client-side only, so window is available here.
  const [supported] = useState(() => {
    if (typeof window === "undefined") return false;
    const w = window as any;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  });
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const recRef = useRef<Recognition | null>(null);

  const start = useCallback(() => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const rec: Recognition = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    setFinalText("");
    setInterim("");
    rec.onresult = (e: any) => {
      let fin = "";
      let int = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript + " ";
        else int += r[0].transcript;
      }
      setFinalText(fin.trim());
      setInterim(int);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [lang]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, interim, finalText, start, stop };
}
