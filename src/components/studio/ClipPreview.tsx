"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

/** Plays only [start, end] of the source with the hook + caption overlaid like the final 9:16 render. */
export function ClipPreview({ src, start, end, hook, caption }: { src: string; start: number; end: number; hook: string; caption: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(start);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => {
      setT(v.currentTime);
      if (v.currentTime >= end) {
        v.pause();
        v.currentTime = start;
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [start, end]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (playing) v.pause();
    else {
      if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
      void v.play();
    }
  };

  const pct = Math.min(100, Math.max(0, ((t - start) / Math.max(1, end - start)) * 100));
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-xl bg-black">
      <video
        ref={ref}
        src={`${src}#t=${start},${end}`}
        preload="metadata"
        playsInline
        className="h-full w-full object-cover"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="pointer-events-none absolute inset-x-0 top-[8%] bg-brand/90 px-2 py-2 text-center text-xs font-extrabold uppercase leading-tight text-white">{hook}</div>
      {caption && (
        <div className="pointer-events-none absolute inset-x-2 bottom-[14%] rounded bg-brand/85 px-2 py-1 text-center text-[10px] font-bold leading-snug text-white line-clamp-4">{caption}</div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-[4%] text-center font-serif text-[9px] text-white">A Cup of Compassion</div>
      <button type="button" onClick={toggle} className="absolute inset-0 grid place-items-center" aria-label={playing ? "Pause" : "Play clip"}>
        {!playing && (
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-brand">
            <Play className="h-5 w-5" />
          </span>
        )}
        {playing && <Pause className="h-0 w-0" />}
      </button>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/30">
        <div className="h-full bg-white" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
