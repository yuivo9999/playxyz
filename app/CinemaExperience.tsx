"use client";

import Image from "next/image";
import { useState, useRef } from "react";
import { auditoriums, getAuditoriumById } from "./cinema-data";
import { CinemaScene } from "./CinemaScene";
import {
  Film,
  Ticket,
  CheckCircle,
  Sparkles,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Upload,
  Moon,
  Sun,
  Clapperboard,
  RotateCcw,
  X,
} from "lucide-react";

interface CinemaExperienceProps {
  initialAuditoriumId?: string;
}

const PRESET_VIDEOS = [
  {
    title: "Big Buck Bunny 4K Trailer",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  },
  {
    title: "Sintel Sci-Fi Animation",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  },
  {
    title: "Tears of Steel Open Movie",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  },
];

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function CinemaExperience({ initialAuditoriumId = "auditorium-1" }: CinemaExperienceProps) {
  const [selectedAuditoriumId, setSelectedAuditoriumId] = useState(initialAuditoriumId);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [isBooked, setIsBooked] = useState(false);

  // Video & Audio state
  const [videoUrl, setVideoUrl] = useState(PRESET_VIDEOS[0].url);
  const [videoTitle, setVideoTitle] = useState(PRESET_VIDEOS[0].title);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Cinema Environment Mode ('off' = 关灯, 'on' = 开灯)
  const [lightsMode, setLightsMode] = useState<"off" | "on">("off");
  const [showStartModal, setShowStartModal] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // Local file upload
  const handleLocalVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setVideoTitle(file.name);
      setIsPlaying(false);
      setShowStartModal(true);
    }
  };

  // Start playback with chosen lights mode
  const handleStartPlaybackWithMode = (mode: "off" | "on") => {
    setLightsMode(mode);
    setShowStartModal(false);
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = volume;
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.error("Playback error:", err));
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = volume;
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.error("Play error:", err));
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const nextMuted = !isMuted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      if (newVol > 0 && isMuted) {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    }
  };

  const handleSeek = (newTime: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const toggleLightsMode = () => {
    setLightsMode((prev) => (prev === "off" ? "on" : "off"));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Hidden Audio/Video element for sound & 3D texture */}
      <video
        ref={videoRef}
        src={videoUrl}
        crossOrigin="anonymous"
        playsInline
        preload="auto"
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
          }
        }}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      <input
        type="file"
        ref={fileInputRef}
        accept="video/*"
        onChange={handleLocalVideoUpload}
        className="hidden"
      />

      {/* Start Playback Modal */}
      {showStartModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-6 relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setShowStartModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl flex items-center justify-center mx-auto">
                <Clapperboard className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white">准备开始观影</h3>
              <p className="text-xs text-slate-400 truncate max-w-[300px] mx-auto">{videoTitle}</p>
            </div>

            <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-3 text-center">
              <p className="text-sm font-medium text-slate-200">
                请选择您的 3D 影厅观影环境模式：
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => handleStartPlaybackWithMode("off")}
                  className="flex flex-col items-center justify-center p-4 bg-slate-900 hover:bg-amber-500/20 text-slate-100 hover:text-amber-300 border border-slate-700 hover:border-amber-500/50 rounded-xl transition-all group"
                >
                  <Moon className="w-8 h-8 text-amber-400 mb-2 group-hover:scale-110 transition-transform" />
                  <span className="font-semibold text-sm">🌙 关灯观看</span>
                  <span className="text-[10px] text-slate-400 mt-1">沉浸影院暗光体验</span>
                </button>

                <button
                  onClick={() => handleStartPlaybackWithMode("on")}
                  className="flex flex-col items-center justify-center p-4 bg-slate-900 hover:bg-blue-500/20 text-slate-100 hover:text-blue-300 border border-slate-700 hover:border-blue-500/50 rounded-xl transition-all group"
                >
                  <Sun className="w-8 h-8 text-amber-300 mb-2 group-hover:scale-110 transition-transform" />
                  <span className="font-semibold text-sm">💡 开灯观看</span>
                  <span className="text-[10px] text-slate-400 mt-1">大厅明亮通透视角</span>
                </button>
              </div>
            </div>

            <p className="text-[11px] text-center text-slate-400">
              🔊 音频输出已开启，支持完整声音播放与自由调整音量。
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Film className="w-8 h-8 text-amber-500" />
            3D 虚拟影院体验系统
          </h1>
          <p className="text-slate-400 mt-1">
            支持 3D 影厅全景视角、本地视频/预告片播放、音效调节与开/关灯观影切换。
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
        {/* 3D Viewport & Controls (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold text-white">{auditorium.name}</h2>
              <p className="text-xs text-slate-400">{auditorium.type} • {auditorium.soundSystem}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowStartModal(true)}
                className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs px-3 py-1.5 rounded-lg font-medium hover:bg-amber-500/30 transition-all flex items-center gap-1.5"
              >
                <Clapperboard className="w-3.5 h-3.5" /> 开始观影 (选择开/关灯)
              </button>
            </div>
          </div>

          <CinemaScene
            auditorium={auditorium}
            selectedSeats={selectedSeats}
            onToggleSeat={handleToggleSeat}
            videoElement={videoRef.current}
            videoUrl={videoUrl}
            videoTitle={videoTitle}
            isPlaying={isPlaying}
            lightsMode={lightsMode}
            onToggleLights={toggleLightsMode}
          />

          {/* Seat Legend */}
          <div className="flex items-center justify-between px-2 py-1 text-xs text-slate-400 border-b border-slate-800/60 pb-3">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 bg-blue-600 rounded-sm" /> 可选座位
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 bg-purple-600 rounded-sm" /> VIP专座
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 bg-amber-500 rounded-sm" /> 已选座位
              </div>
            </div>
          </div>

          {/* Video Control & Source Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-amber-500 shrink-0" />
                <span className="text-sm font-semibold text-white truncate max-w-[240px]">
                  {videoTitle}
                </span>
              </div>

              {/* Source Switcher & Upload */}
              <div className="flex items-center gap-2">
                <select
                  value={PRESET_VIDEOS.some((v) => v.url === videoUrl) ? videoUrl : "custom"}
                  onChange={(e) => {
                    const selected = PRESET_VIDEOS.find((v) => v.url === e.target.value);
                    if (selected) {
                      setVideoUrl(selected.url);
                      setVideoTitle(selected.title);
                      setIsPlaying(false);
                      setShowStartModal(true);
                    }
                  }}
                  className="bg-slate-950 text-slate-200 border border-slate-800 rounded-lg text-xs px-2.5 py-1.5 focus:outline-none focus:border-amber-500"
                >
                  <option value="" disabled>选择演示视频</option>
                  {PRESET_VIDEOS.map((v) => (
                    <option key={v.url} value={v.url}>
                      {v.title}
                    </option>
                  ))}
                  {!PRESET_VIDEOS.some((v) => v.url === videoUrl) && (
                    <option value="custom">📁 本地文件: {videoTitle}</option>
                  )}
                </select>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Upload className="w-3.5 h-3.5 text-amber-400" /> 上传本地视频
                </button>
              </div>
            </div>

            {/* Playback Progress Slider */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 font-mono min-w-[36px]">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 accent-amber-500 rounded-lg cursor-pointer"
              />
              <span className="text-xs text-slate-400 font-mono min-w-[36px]">
                {formatTime(duration)}
              </span>
            </div>

            {/* Bottom Controls (Play/Pause, Sound, Lights Toggle) */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 p-2 rounded-lg font-semibold transition-all shadow-md shadow-amber-500/10 flex items-center justify-center"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>

                <button
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.currentTime = 0;
                      setCurrentTime(0);
                    }
                  }}
                  title="重新播放"
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-lg transition-all"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                {/* Volume Controls */}
                <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                  <button onClick={toggleMute} className="text-slate-400 hover:text-white">
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-4 h-4 text-red-400" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-emerald-400" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-20 h-1.5 bg-slate-800 accent-amber-500 rounded-lg cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-400 font-mono w-8">
                    {isMuted ? "0%" : `${Math.round(volume * 100)}%`}
                  </span>
                </div>
              </div>

              {/* Lights Toggle */}
              <button
                onClick={toggleLightsMode}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all flex items-center gap-2 ${
                  lightsMode === "off"
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30"
                    : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                }`}
              >
                {lightsMode === "off" ? (
                  <>
                    <Moon className="w-3.5 h-3.5 text-amber-400" /> 关灯模式
                  </>
                ) : (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-300" /> 开灯模式
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar Info & Checkout */}
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Ticket className="w-5 h-5 text-amber-500" />
              订票与观影详情
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
              <label className="text-xs text-slate-400 font-medium">已选座位 ({selectedSeats.length})</label>
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
                    点击 3D 视图中的蓝色或紫色座位选择...
                  </span>
                )}
              </div>
            </div>

            {/* Pricing */}
            <div className="border-t border-slate-800 pt-4 space-y-2 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>门票价格 ({selectedSeats.length} × $15)</span>
                <span>${calculateTotal()}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>服务费</span>
                <span>$0.00</span>
              </div>
              <div className="flex justify-between text-white font-semibold text-base pt-2 border-t border-slate-800/60">
                <span>总计金额</span>
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
                确认预订
              </button>
            ) : (
              <div className="bg-emerald-950/60 border border-emerald-500/30 p-4 rounded-lg text-center space-y-2">
                <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
                <p className="text-emerald-300 font-medium text-sm">预订成功！</p>
                <p className="text-xs text-emerald-400/70">
                  您的座位 {selectedSeats.join(", ")} 已成功锁票。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

