"use client";

import Image from "next/image";
import { useState } from "react";
import { auditoriums, getAuditoriumById } from "./cinema-data";
import { CinemaScene } from "./CinemaScene";
import { Film, Ticket, CheckCircle, Sparkles } from "lucide-react";

interface CinemaExperienceProps {
  initialAuditoriumId?: string;
}

export function CinemaExperience({ initialAuditoriumId = "auditorium-1" }: CinemaExperienceProps) {
  const [selectedAuditoriumId, setSelectedAuditoriumId] = useState(initialAuditoriumId);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [isBooked, setIsBooked] = useState(false);

  const auditorium = getAuditoriumById(selectedAuditoriumId) || auditoriums[0];

  const handleToggleSeat = (seatId: string) => {
    setSelectedSeats((prev) =>
      prev.includes(seatId)
        ? prev.filter((id) => id !== seatId)
        : [...prev, seatId]
    );
  };

  const handleBooking = () => {
    if (selectedSeats.length === 0) return;
    setIsBooked(true);
  };

  const calculateTotal = () => {
    return selectedSeats.length * 15;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Film className="w-8 h-8 text-amber-500" />
            3D Virtual Cinema Experience
          </h1>
          <p className="text-slate-400 mt-1">
            Explore auditoriums, select 3D seating, and book movie tickets in real-time.
          </p>
        </div>

        {/* Auditorium Selector */}
        <div className="flex flex-wrap gap-2">
          {auditoriums.map((aud) => (
            <button
              key={aud.id}
              onClick={() => {
                setSelectedAuditoriumId(aud.id);
                setSelectedSeats([]);
                setIsBooked(false);
              }}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                selectedAuditoriumId === aud.id
                  ? "bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20"
                  : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              {aud.name.split(" - ")[1] || aud.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 3D Viewport (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">{auditorium.name}</h2>
              <p className="text-xs text-slate-400">{auditorium.type} • {auditorium.soundSystem}</p>
            </div>
            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs px-3 py-1 rounded-full font-medium">
              Now Showing: {auditorium.movieTitle}
            </span>
          </div>

          <CinemaScene
            auditorium={auditorium}
            selectedSeats={selectedSeats}
            onToggleSeat={handleToggleSeat}
          />

          {/* Seat Legend */}
          <div className="flex items-center justify-center gap-6 py-2 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 bg-blue-600 rounded-sm" /> Available
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 bg-purple-600 rounded-sm" /> VIP
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 bg-amber-500 rounded-sm" /> Selected
            </div>
          </div>
        </div>

        {/* Sidebar Info & Checkout */}
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Ticket className="w-5 h-5 text-amber-500" />
              Reservation Details
            </h3>

            {/* Movie Card */}
            <div className="flex gap-4 items-center bg-slate-950 p-3 rounded-lg border border-slate-800">
              <Image
                src={auditorium.moviePoster}
                alt={auditorium.movieTitle}
                width={64}
                height={80}
                referrerPolicy="no-referrer"
                className="w-16 h-20 object-cover rounded-md"
              />
              <div>
                <h4 className="font-semibold text-white text-sm">{auditorium.movieTitle}</h4>
                <p className="text-xs text-slate-400 mt-1">{auditorium.screenSize}</p>
                <div className="flex gap-1.5 mt-2">
                  {auditorium.showtimes.map((st) => (
                    <span key={st} className="bg-slate-800 text-slate-300 text-[10px] px-2 py-0.5 rounded">
                      {st}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Selected Seats summary */}
            <div className="space-y-2">
              <label className="text-xs text-slate-400 font-medium">Selected Seats ({selectedSeats.length})</label>
              <div className="flex flex-wrap gap-1.5 min-h-[40px] p-2 bg-slate-950 rounded-lg border border-slate-800">
                {selectedSeats.length > 0 ? (
                  selectedSeats.map((seat) => (
                    <span
                      key={seat}
                      className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs px-2 py-0.5 rounded"
                    >
                      {seat}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-600 self-center px-1">
                    Click seats in 3D view to select...
                  </span>
                )}
              </div>
            </div>

            {/* Pricing */}
            <div className="border-t border-slate-800 pt-4 space-y-2 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Tickets ({selectedSeats.length} × $15)</span>
                <span>${calculateTotal()}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Booking Fee</span>
                <span>$0.00</span>
              </div>
              <div className="flex justify-between text-white font-semibold text-base pt-2 border-t border-slate-800/60">
                <span>Total Amount</span>
                <span className="text-amber-400">${calculateTotal()}</span>
              </div>
            </div>

            {/* Action Button */}
            {!isBooked ? (
              <button
                onClick={handleBooking}
                disabled={selectedSeats.length === 0}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:hover:bg-amber-500 text-slate-950 font-semibold py-3 px-4 rounded-lg transition-all shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Confirm Booking
              </button>
            ) : (
              <div className="bg-emerald-950/60 border border-emerald-500/30 p-4 rounded-lg text-center space-y-2">
                <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
                <p className="text-emerald-300 font-medium text-sm">Booking Confirmed!</p>
                <p className="text-xs text-emerald-400/70">
                  Your tickets for {selectedSeats.join(", ")} have been reserved.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
