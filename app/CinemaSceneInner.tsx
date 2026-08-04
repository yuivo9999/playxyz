"use client";

import { useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, Float } from "@react-three/drei";
import * as THREE from "three";
import { Auditorium } from "./cinema-data";
import { Sun, Moon } from "lucide-react";

interface CinemaSceneProps {
  auditorium: Auditorium;
  selectedSeats: string[];
  onToggleSeat: (seatId: string) => void;
  videoElement?: HTMLVideoElement | null;
  videoUrl?: string;
  videoTitle?: string;
  isPlaying?: boolean;
  lightsMode?: "off" | "on";
  onToggleLights?: () => void;
}

function CinemaRoom({
  auditorium,
  selectedSeats,
  onToggleSeat,
  videoElement,
  videoUrl,
  videoTitle,
  isPlaying,
  lightsMode = "off",
}: CinemaSceneProps) {
  const meshRef = useRef<THREE.Group>(null);
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);

  useEffect(() => {
    if (videoElement && videoUrl) {
      const texture = new THREE.VideoTexture(videoElement);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.format = THREE.RGBAFormat;
      setVideoTexture(texture);

      return () => {
        texture.dispose();
      };
    } else {
      setVideoTexture(null);
    }
  }, [videoElement, videoUrl]);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.04;
    }
    if (videoTexture && isPlaying) {
      videoTexture.needsUpdate = true;
    }
  });

  const isLightsOff = lightsMode === "off";

  const rowLabels = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const seats: React.ReactNode[] = [];

  for (let r = 0; r < Math.min(auditorium.rows, rowLabels.length); r++) {
    for (let c = 0; c < auditorium.cols; c++) {
      const seatId = `${rowLabels[r]}${c + 1}`;
      const isSelected = selectedSeats.includes(seatId);
      const isVip = r >= 3 && r <= 5 && c >= 3 && c <= auditorium.cols - 4;

      const x = (c - auditorium.cols / 2) * 1.1;
      const z = (r - auditorium.rows / 2) * 1.2 + 2;
      const y = r * 0.35;

      seats.push(
        <group key={seatId} position={[x, y, z]} onClick={(e) => { e.stopPropagation(); onToggleSeat(seatId); }}>
          {/* Seat Cushion */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.8, 0.2, 0.8]} />
            <meshStandardMaterial
              color={isSelected ? "#f59e0b" : isVip ? "#8b5cf6" : "#3b82f6"}
              roughness={0.4}
              metalness={0.1}
            />
          </mesh>
          {/* Backrest */}
          <mesh position={[0, 0.4, -0.3]}>
            <boxGeometry args={[0.8, 0.7, 0.2]} />
            <meshStandardMaterial
              color={isSelected ? "#d97706" : isVip ? "#7c3aed" : "#2563eb"}
              roughness={0.4}
            />
          </mesh>
        </group>
      );
    }
  }

  return (
    <group ref={meshRef}>
      {/* Ambient & Directional Lighting adjusting smoothly to lightsMode */}
      <ambientLight
        intensity={isLightsOff ? 0.08 : 0.6}
        color={isLightsOff ? "#1e1b4b" : "#ffffff"}
      />
      <directionalLight
        position={[0, 10, 5]}
        intensity={isLightsOff ? 0.15 : 1.2}
        color={isLightsOff ? "#312e81" : "#ffffff"}
      />
      <pointLight
        position={[0, 8, -5]}
        intensity={isLightsOff ? 0.4 : 2.5}
        color={isLightsOff ? "#3b82f6" : "#38bdf8"}
      />
      {isLightsOff && (
        <pointLight position={[0, 2, 2]} intensity={0.6} color="#4338ca" />
      )}

      {/* Screen */}
      <group position={[0, 4, -8]}>
        <mesh>
          <boxGeometry args={[18, 9, 0.3]} />
          <meshStandardMaterial color="#020617" roughness={0.1} />
        </mesh>
        <mesh position={[0, 0, 0.16]}>
          <planeGeometry args={[17.2, 8.2]} />
          {videoTexture ? (
            <meshBasicMaterial map={videoTexture} toneMapped={false} />
          ) : (
            <meshBasicMaterial color="#0f172a" />
          )}
        </mesh>
        {/* Glow Light from Screen */}
        <spotLight
          position={[0, 0, 0.5]}
          target-position={[0, -2, 5]}
          intensity={isLightsOff ? (isPlaying ? 8 : 4) : 2}
          angle={1.2}
          penumbra={0.8}
          color={isPlaying ? "#60a5fa" : "#38bdf8"}
        />
        {(!videoTexture || !isPlaying) && (
          <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.2}>
            <Text
              position={[0, 0, 0.2]}
              fontSize={0.8}
              color="#f8fafc"
              anchorX="center"
              anchorY="middle"
            >
              {videoTitle || auditorium.movieTitle}
            </Text>
          </Float>
        )}
      </group>

      {/* Cinema Floor */}
      <mesh position={[0, -0.2, 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 25]} />
        <meshStandardMaterial color={isLightsOff ? "#090d16" : "#0f172a"} roughness={0.8} />
      </mesh>

      {/* Seats */}
      {seats}
    </group>
  );
}

export default function CinemaSceneInner(props: CinemaSceneProps) {
  return (
    <div className="w-full h-[500px] bg-slate-950 rounded-xl overflow-hidden relative border border-slate-800">
      <Canvas camera={{ position: [0, 8, 14], fov: 60 }}>
        <color attach="background" args={[props.lightsMode === "off" ? "#030712" : "#0f172a"]} />
        <CinemaRoom {...props} />
        <OrbitControls
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={5}
          maxDistance={25}
        />
      </Canvas>
      <div className="absolute bottom-4 left-4 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/50 text-xs text-slate-300 flex items-center gap-2">
        <span>🖱️ 拖拽旋转 | 滚轮缩放</span>
      </div>
      {props.onToggleLights && (
        <button
          onClick={props.onToggleLights}
          className={`absolute top-4 right-4 px-3 py-1.5 rounded-lg border text-xs font-medium backdrop-blur-md transition-all flex items-center gap-2 ${
            props.lightsMode === "off"
              ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
              : "bg-slate-800/80 text-slate-200 border-slate-700 hover:bg-slate-700/80"
          }`}
        >
          {props.lightsMode === "off" ? (
            <>
              <Moon className="w-3.5 h-3.5 text-amber-400" /> 关灯模式 (点击开灯)
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-300" /> 开灯模式 (点击关灯)
            </>
          )}
        </button>
      )}
    </div>
  );
}
