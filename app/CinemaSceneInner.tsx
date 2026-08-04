"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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

function createTextTexture(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🎬 3D CINEMA PREVIEW", canvas.width / 2, canvas.height / 2 - 40);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 42px sans-serif";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 20);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function CinemaSceneInner({
  auditorium,
  selectedSeats,
  onToggleSeat,
  videoElement,
  videoUrl,
  videoTitle,
  isPlaying = false,
  lightsMode = "off",
  onToggleLights,
}: CinemaSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onToggleSeatRef = useRef(onToggleSeat);
  onToggleSeatRef.current = onToggleSeat;

  const isLightsOff = lightsMode === "off";

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isLightsOff ? "#030712" : "#0f172a");

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 8, 14);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 2. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 25;

    // 3. Lighting
    const ambientLight = new THREE.AmbientLight(
      isLightsOff ? "#1e1b4b" : "#ffffff",
      isLightsOff ? 0.08 : 0.6
    );
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(
      isLightsOff ? "#312e81" : "#ffffff",
      isLightsOff ? 0.15 : 1.2
    );
    dirLight.position.set(0, 10, 5);
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(
      isLightsOff ? "#3b82f6" : "#38bdf8",
      isLightsOff ? 0.4 : 2.5
    );
    pointLight.position.set(0, 8, -5);
    scene.add(pointLight);

    let extraPointLight: THREE.PointLight | null = null;
    if (isLightsOff) {
      extraPointLight = new THREE.PointLight("#4338ca", 0.6);
      extraPointLight.position.set(0, 2, 2);
      scene.add(extraPointLight);
    }

    // 4. Floor
    const floorGeo = new THREE.PlaneGeometry(30, 25);
    const floorMat = new THREE.MeshStandardMaterial({
      color: isLightsOff ? "#090d16" : "#0f172a",
      roughness: 0.8,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.2, 2);
    scene.add(floor);

    // 5. Screen & Material
    let screenTexture: THREE.Texture;
    let createdVideoTexture: THREE.VideoTexture | null = null;

    if (videoElement && videoUrl) {
      createdVideoTexture = new THREE.VideoTexture(videoElement);
      createdVideoTexture.minFilter = THREE.LinearFilter;
      createdVideoTexture.magFilter = THREE.LinearFilter;
      createdVideoTexture.colorSpace = THREE.SRGBColorSpace;
      createdVideoTexture.format = THREE.RGBAFormat;
      screenTexture = createdVideoTexture;
    } else {
      screenTexture = createTextTexture(videoTitle || auditorium.movieTitle);
    }

    const screenGroup = new THREE.Group();
    screenGroup.position.set(0, 4, -8);

    const frameGeo = new THREE.BoxGeometry(18, 9, 0.3);
    const frameMat = new THREE.MeshStandardMaterial({ color: "#020617", roughness: 0.1 });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    screenGroup.add(frameMesh);

    const screenPlaneGeo = new THREE.PlaneGeometry(17.2, 8.2);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTexture });
    const screenPlaneMesh = new THREE.Mesh(screenPlaneGeo, screenMat);
    screenPlaneMesh.position.set(0, 0, 0.16);
    screenGroup.add(screenPlaneMesh);

    // Glow Light from Screen
    const spotLight = new THREE.SpotLight(
      isPlaying ? "#60a5fa" : "#38bdf8",
      isLightsOff ? (isPlaying ? 8 : 4) : 2,
      25,
      1.2,
      0.8
    );
    spotLight.position.set(0, 0, 0.5);
    spotLight.target.position.set(0, -2, 5);
    screenGroup.add(spotLight);
    screenGroup.add(spotLight.target);

    scene.add(screenGroup);

    // 6. Seats Grid
    const seatsGroup = new THREE.Group();
    const seatClickableMeshes: THREE.Object3D[] = [];
    const rowLabels = ["A", "B", "C", "D", "E", "F", "G", "H"];

    const cushionGeo = new THREE.BoxGeometry(0.8, 0.2, 0.8);
    const backrestGeo = new THREE.BoxGeometry(0.8, 0.7, 0.2);

    for (let r = 0; r < Math.min(auditorium.rows, rowLabels.length); r++) {
      for (let c = 0; c < auditorium.cols; c++) {
        const seatId = `${rowLabels[r]}${c + 1}`;
        const isSelected = selectedSeats.includes(seatId);
        const isVip = r >= 3 && r <= 5 && c >= 3 && c <= auditorium.cols - 4;

        const x = (c - auditorium.cols / 2) * 1.1;
        const z = (r - auditorium.rows / 2) * 1.2 + 2;
        const y = r * 0.35;

        const seatSingleGroup = new THREE.Group();
        seatSingleGroup.position.set(x, y, z);
        seatSingleGroup.userData = { seatId };

        const cushionMat = new THREE.MeshStandardMaterial({
          color: isSelected ? "#f59e0b" : isVip ? "#8b5cf6" : "#3b82f6",
          roughness: 0.4,
          metalness: 0.1,
        });
        const cushion = new THREE.Mesh(cushionGeo, cushionMat);
        cushion.position.set(0, 0, 0);
        cushion.userData = { seatId };
        seatSingleGroup.add(cushion);

        const backrestMat = new THREE.MeshStandardMaterial({
          color: isSelected ? "#d97706" : isVip ? "#7c3aed" : "#2563eb",
          roughness: 0.4,
        });
        const backrest = new THREE.Mesh(backrestGeo, backrestMat);
        backrest.position.set(0, 0.4, -0.3);
        backrest.userData = { seatId };
        seatSingleGroup.add(backrest);

        seatsGroup.add(seatSingleGroup);
        seatClickableMeshes.push(cushion, backrest);
      }
    }
    scene.add(seatsGroup);

    // 7. Raycasting & Click handling
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return; // Ignore drag operations

      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(seatClickableMeshes, true);
      if (intersects.length > 0) {
        const hitSeatId = intersects[0].object.userData?.seatId;
        if (hitSeatId) {
          onToggleSeatRef.current(hitSeatId);
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(seatClickableMeshes, true);
      canvas.style.cursor = intersects.length > 0 ? "pointer" : "default";
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointermove", handlePointerMove);

    // 8. Animation & Render loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const elapsedTime = clock.getElapsedTime();
      seatsGroup.rotation.y = Math.sin(elapsedTime * 0.2) * 0.02;

      if (createdVideoTexture && isPlaying) {
        createdVideoTexture.needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    // 9. Resize Handling
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      if (newWidth > 0 && newHeight > 0) {
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight);
      }
    });
    resizeObserver.observe(container);

    // 10. Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointermove", handlePointerMove);

      controls.dispose();
      renderer.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      frameGeo.dispose();
      frameMat.dispose();
      screenPlaneGeo.dispose();
      screenMat.dispose();
      cushionGeo.dispose();
      backrestGeo.dispose();
      if (createdVideoTexture) createdVideoTexture.dispose();
    };
  }, [
    auditorium,
    selectedSeats,
    videoElement,
    videoUrl,
    videoTitle,
    isPlaying,
    isLightsOff,
  ]);

  return (
    <div
      ref={containerRef}
      className="w-full h-[500px] bg-slate-950 rounded-xl overflow-hidden relative border border-slate-800"
    >
      <canvas ref={canvasRef} className="w-full h-full block" />

      <div className="absolute bottom-4 left-4 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/50 text-xs text-slate-300 flex items-center gap-2 select-none pointer-events-none">
        <span>🖱️ 拖拽旋转 | 滚轮缩放 | 点击座位选座</span>
      </div>

      {onToggleLights && (
        <button
          onClick={onToggleLights}
          className={`absolute top-4 right-4 px-3 py-1.5 rounded-lg border text-xs font-medium backdrop-blur-md transition-all flex items-center gap-2 ${
            isLightsOff
              ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
              : "bg-slate-800/80 text-slate-200 border-slate-700 hover:bg-slate-700/80"
          }`}
        >
          {isLightsOff ? (
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
