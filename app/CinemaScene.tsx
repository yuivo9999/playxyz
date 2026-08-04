"use client";

import dynamic from "next/dynamic";
import { Auditorium } from "./cinema-data";

interface CinemaSceneProps {
  auditorium: Auditorium;
  selectedSeats: string[];
  onToggleSeat: (seatId: string) => void;
  videoUrl?: string;
}

const CinemaSceneInner = dynamic(() => import("./CinemaSceneInner"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[500px] bg-slate-900 rounded-xl flex items-center justify-center text-slate-400 border border-slate-800">
      Loading 3D Scene...
    </div>
  ),
});

export function CinemaScene(props: CinemaSceneProps) {
  return <CinemaSceneInner {...props} />;
}
