"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei/core/OrbitControls.js";
import { Text } from "@react-three/drei/core/Text.js";
import { Float } from "@react-three/drei/core/Float.js";
import * as THREE from "three";
import { Auditorium } from "./cinema-data";

interface CinemaSceneProps {
  auditorium: Auditorium;
  selectedSeats: string[];
  onToggleSeat: (seatId: string) => void;
  videoUrl?: string;
}

function CinemaRoom({ auditorium, selectedSeats, onToggleSeat }: CinemaSceneProps) {
  const meshRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.05;
    }
  });

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
      {/* Ambient & Directional Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[0, 10, 5]} intensity={1.2} />
      <pointLight position={[0, 8, -5]} intensity={2.5} color="#38bdf8" />

      {/* Screen */}
      <group position={[0, 4, -8]}>
        <mesh>
          <boxGeometry args={[18, 9, 0.3]} />
          <meshStandardMaterial color="#020617" roughness={0.1} />
        </mesh>
        <mesh position={[0, 0, 0.16]}>
          <planeGeometry args={[17.2, 8.2]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
        {/* Glow Light from Screen */}
        <spotLight
          position={[0, 0, 0.5]}
          target-position={[0, -2, 5]}
          intensity={3}
          angle={1.2}
          penumbra={0.8}
          color="#38bdf8"
        />
        <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.2}>
          <Text
            position={[0, 0, 0.2]}
            fontSize={0.8}
            color="#f8fafc"
            anchorX="center"
            anchorY="middle"
          >
            {auditorium.movieTitle}
          </Text>
        </Float>
      </group>

      {/* Cinema Floor */}
      <mesh position={[0, -0.2, 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 25]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
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
        <color attach="background" args={["#020617"]} />
        <CinemaRoom {...props} />
        <OrbitControls
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={5}
          maxDistance={25}
        />
      </Canvas>
      <div className="absolute bottom-4 left-4 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/50 text-xs text-slate-300">
        🖱️ Drag to rotate | Scroll to zoom
      </div>
    </div>
  );
}
