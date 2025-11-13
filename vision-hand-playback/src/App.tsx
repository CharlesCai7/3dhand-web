import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line, Stats } from "@react-three/drei";
import * as THREE from "three";

/**
 * Vision Pro Hand Playback — polished UI
 * - Drag & drop or click to upload JSON
 * - Floating control bar w/ Play/Pause, Speed, Loop, Axes, Fit
 * - Keyboard: Space, ←/→ step, Home/End, L toggle loop, A toggle axes
 * - Sticky HUD with time + duration, responsive 16:9 stage
 */

// ===============================
// Types
// ===============================
type Joint = {
  name: string;
  px: number; py: number; pz: number;
  ox?: number; oy?: number; oz?: number; ow?: number;
};
type Frame = { time: number; joints: Joint[] };
type Recording = { startedAt?: number; frames: Frame[] };

// ===============================
// Skeleton topology
// ===============================
const BONE_PAIRS: [string, string][] = [
  ["leftforearmArm", "leftforearmWrist"],
  ["leftforearmWrist", "leftWrist"],
  ["leftWrist", "leftThumbKnuckle"],
  ["leftThumbKnuckle", "leftThumbIntermediateBase"],
  ["leftThumbIntermediateBase", "leftThumbIntermediateTip"],
  ["leftThumbIntermediateTip", "leftThumbTip"],

  ["leftWrist", "leftindexFingerMetacarpal"],
  ["leftindexFingerMetacarpal", "leftIndexFingerKnuckle"],
  ["leftIndexFingerKnuckle", "leftIndexFingerIntermediateBase"],
  ["leftIndexFingerIntermediateBase", "leftIndexFingerIntermediateTip"],
  ["leftIndexFingerIntermediateTip", "leftIndexFingerTip"],

  ["leftWrist", "leftmiddleFingerMetacarpal"],
  ["leftmiddleFingerMetacarpal", "leftMiddleFingerKnuckle"],
  ["leftMiddleFingerKnuckle", "leftMiddleFingerIntermediateBase"],
  ["leftMiddleFingerIntermediateBase", "leftMiddleFingerIntermediateTip"],
  ["leftMiddleFingerIntermediateTip", "leftMiddleFingerTip"],

  ["leftWrist", "leftringFingerMetacarpal"],
  ["leftringFingerMetacarpal", "leftRingFingerKnuckle"],
  ["leftRingFingerKnuckle", "leftRingFingerIntermediateBase"],
  ["leftRingFingerIntermediateBase", "leftRingFingerIntermediateTip"],
  ["leftRingFingerIntermediateTip", "leftRingFingerTip"],

  ["leftWrist", "leftlittleFingerMetacarpal"],
  ["leftlittleFingerMetacarpal", "leftLittleFingerKnuckle"],
  ["leftLittleFingerKnuckle", "leftLittleFingerIntermediateBase"],
  ["leftLittleFingerIntermediateBase", "leftLittleFingerIntermediateTip"],
  ["leftLittleFingerIntermediateTip", "leftLittleFingerTip"],

  // Right hand
  ["rightforearmArm", "rightforearmWrist"],
  ["rightforearmWrist", "rightWrist"],
  ["rightWrist", "rightThumbKnuckle"],
  ["rightThumbKnuckle", "rightThumbIntermediateBase"],
  ["rightThumbIntermediateBase", "rightThumbIntermediateTip"],
  ["rightThumbIntermediateTip", "rightThumbTip"],

  ["rightWrist", "rightindexFingerMetacarpal"],
  ["rightindexFingerMetacarpal", "rightIndexFingerKnuckle"],
  ["rightIndexFingerKnuckle", "rightIndexFingerIntermediateBase"],
  ["rightIndexFingerIntermediateBase", "rightIndexFingerIntermediateTip"],
  ["rightIndexFingerIntermediateTip", "rightIndexFingerTip"],

  ["rightWrist", "rightmiddleFingerMetacarpal"],
  ["rightmiddleFingerMetacarpal", "rightMiddleFingerKnuckle"],
  ["rightMiddleFingerKnuckle", "rightMiddleFingerIntermediateBase"],
  ["rightMiddleFingerIntermediateBase", "rightMiddleFingerIntermediateTip"],
  ["rightMiddleFingerIntermediateTip", "rightMiddleFingerTip"],

  ["rightWrist", "rightringFingerMetacarpal"],
  ["rightringFingerMetacarpal", "rightRingFingerKnuckle"],
  ["rightRingFingerKnuckle", "rightRingFingerIntermediateBase"],
  ["rightRingFingerIntermediateBase", "rightRingFingerIntermediateTip"],
  ["rightRingFingerIntermediateTip", "rightRingFingerTip"],

  ["rightWrist", "rightlittleFingerMetacarpal"],
  ["rightlittleFingerMetacarpal", "rightLittleFingerKnuckle"],
  ["rightLittleFingerKnuckle", "rightLittleFingerIntermediateBase"],
  ["rightLittleFingerIntermediateBase", "rightLittleFingerIntermediateTip"],
  ["rightLittleFingerIntermediateTip", "rightLittleFingerTip"],
];

// ===============================
// Math + helpers
// ===============================
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function indexJoints(joints: Joint[]): Record<string, Joint> {
  const map: Record<string, Joint> = {};
  for (const j of joints) map[j.name] = j;
  return map;
}
function interpJoint(a: Joint, b: Joint, t: number): Joint {
  return {
    name: a.name,
    px: lerp(a.px, b.px, t),
    py: lerp(a.py, b.py, t),
    pz: lerp(a.pz, b.pz, t),
    ox: a.ox, oy: a.oy, oz: a.oz, ow: a.ow
  };
}
function interpolateFrame(frames: Frame[], t: number): Frame {
  if (frames.length === 0) return { time: 0, joints: [] };
  if (t <= frames[0].time) return frames[0];
  if (t >= frames[frames.length - 1].time) return frames[frames.length - 1];
  let lo = 0, hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].time <= t) lo = mid; else hi = mid;
  }
  const f0 = frames[lo], f1 = frames[hi];
  const dt = (t - f0.time) / Math.max(1e-9, f1.time - f0.time);
  const map0 = indexJoints(f0.joints), map1 = indexJoints(f1.joints);
  const names = new Set([...Object.keys(map0), ...Object.keys(map1)]);
  const joints: Joint[] = [];
  names.forEach((n) => {
    const a = map0[n]; const b = map1[n] ?? a;
    if (!a) return; joints.push(interpJoint(a, b, dt));
  });
  return { time: t, joints };
}
function jointsToVec3(joints: Joint[]): Record<string, THREE.Vector3> {
  const map: Record<string, THREE.Vector3> = {};
  for (const j of joints) map[j.name] = new THREE.Vector3(j.px, j.py, j.pz);
  return map;
}
function getDuration(frames: Frame[]) {
  return frames.length ? frames[frames.length - 1].time - frames[0].time : 0;
}
function fmtTime(t: number) {
  if (!isFinite(t)) return "0.00s";
  return `${t.toFixed(2)}s`;
}

// ===============================
// 3D Scene
// ===============================
function HandsScene({
  currentFrame,
  axes = false
}: {
  currentFrame: Frame | null; axes?: boolean;
}) {
  const ptsGeom = useMemo(() => new THREE.SphereGeometry(0.01, 16, 16), []);
  const matLeft = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ff6f61" }), []);
  const matRight = useMemo(() => new THREE.MeshStandardMaterial({ color: "#61a8ff" }), []);
  const vecMap = useMemo(() => currentFrame ? jointsToVec3(currentFrame.joints) : {}, [currentFrame]);

  const boneLines = useMemo(() => {
    if (!currentFrame) return [] as [THREE.Vector3, THREE.Vector3][];
    const lines: [THREE.Vector3, THREE.Vector3][] = [];
    for (const [a, b] of BONE_PAIRS) {
      const va = vecMap[a]; const vb = vecMap[b];
      if (va && vb) lines.push([va.clone(), vb.clone()]);
    }
    return lines;
  }, [currentFrame, vecMap]);

  const center = useMemo(() => {
    const cands = ["leftWrist", "rightWrist", "leftforearmWrist", "rightforearmWrist"]
      .map(n => vecMap[n]).filter(Boolean) as THREE.Vector3[];
    if (!cands.length) return new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const v of cands) c.add(v);
    c.multiplyScalar(1 / cands.length);
    return c;
  }, [vecMap]);

  return (
    <group>
      {axes && <axesHelper args={[0.3]} />}
      {boneLines.map((seg, i) => (
        <Line key={i} points={[[seg[0].x, seg[0].y, seg[0].z], [seg[1].x, seg[1].y, seg[1].z]]} lineWidth={1} color="#8b8b8b" />
      ))}
      {currentFrame?.joints.map((j) => (
        <mesh key={j.name} geometry={ptsGeom} position={[j.px, j.py, j.pz]}
          material={j.name.startsWith("left") ? matLeft : matRight} />
      ))}
      <ambientLight intensity={0.7} />
      <directionalLight position={[1, 2, 2]} intensity={0.6} />
      <OrbitControls target={[center.x, center.y, center.z]} enableDamping makeDefault />
    </group>
  );
}

function CanvasTicker({
  running, speed, duration, loop, onTick
}: {
  running: boolean; speed: number; duration: number; loop: boolean; onTick: (dt: number) => void;
}) {
  useFrame((_, delta) => { if (running && duration > 0) onTick(delta * speed); });
  return null;
}

// ===============================
// UI Controls
// ===============================
function IconButton({
  onClick, title, children, disabled
}: React.PropsWithChildren<{ onClick?: () => void; title?: string; disabled?: boolean }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`px-3.5 h-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 active:bg-white/15
        text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Slider({
  value, min, max, step, onChange
}: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; }) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step ?? 0.01}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="accent-white/80 w-full"
    />
  );
}

// ===============================
// Main Component
// ===============================
export default function HandPlayback() {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [axes, setAxes] = useState(false);
  const [isPlaying, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);

  const frames = recording?.frames ?? [];
  const duration = useMemo(() => getDuration(frames), [frames]);
  const currentFrame = useMemo(() => (frames.length ? interpolateFrame(frames, time) : null), [frames, time]);

  // file handling
  const onFile = useCallback((file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        const frames = Array.isArray(raw) ? raw :
          Array.isArray(raw?.frames) ? raw.frames :
          Array.isArray(raw?.data?.frames) ? raw.data.frames : [];
        if (!frames.length) throw new Error("No frames array found.");
        const t0 = frames[0].time ?? 0;
        frames.forEach((f: any) => f.time -= t0);
        setRecording({ frames });
        setTime(0); setPlaying(true);
      } catch (err: any) {
        setError(err.message || "Failed to parse JSON");
      }
    };
    reader.readAsText(file);
  }, []);
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
  };

  // drag + drop
  const dropRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const onDrop = (e: DragEvent) => {
      prevent(e);
      const f = e.dataTransfer?.files?.[0];
      if (f) onFile(f);
      el.classList.remove("ring-2");
    };
    const onEnter = (e: DragEvent) => { prevent(e); el.classList.add("ring-2"); };
    const onLeave = (e: DragEvent) => { prevent(e); el.classList.remove("ring-2"); };

    el.addEventListener("dragover", prevent);
    el.addEventListener("drop", onDrop);
    el.addEventListener("dragenter", onEnter);
    el.addEventListener("dragleave", onLeave);
    return () => {
      el.removeEventListener("dragover", prevent);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("dragenter", onEnter);
      el.removeEventListener("dragleave", onLeave);
    };
  }, [onFile]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); setPlaying(p => !p); }
      if (e.code === "ArrowRight") setTime(t => clamp(t + 0.033, 0, duration || 0));
      if (e.code === "ArrowLeft") setTime(t => clamp(t - 0.033, 0, duration || 0));
      if (e.code === "Home") setTime(0);
      if (e.code === "End") setTime(duration || 0);
      if (e.key.toLowerCase() === "l") setLoop(v => !v);
      if (e.key.toLowerCase() === "a") setAxes(v => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration]);

  // viewport fit helper
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const fitView = useCallback(() => {
    if (!currentFrame || !cameraRef.current) return;
    const vs = currentFrame.joints.map(j => new THREE.Vector3(j.px, j.py, j.pz));
    if (!vs.length) return;
    const box = new THREE.Box3().setFromPoints(vs);
    const size = new THREE.Vector3(); const center = new THREE.Vector3();
    box.getSize(size); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 2.2;
    cameraRef.current.position.set(center.x + dist * 0.35, center.y + dist * 0.8, center.z + dist * 0.6);
    cameraRef.current.lookAt(center);
  }, [currentFrame]);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-zinc-950 to-neutral-900 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-black/40 bg-black/30 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <h1 className="text-lg sm:text-xl font-semibold tracking-tight">Vision Pro Hand Playback</h1>
          <div className="ml-auto flex items-center gap-2">
            <label className="relative cursor-pointer">
              <input type="file" className="sr-only" accept=".json" onChange={onInput} />
              <span className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-sm">
                Upload JSON
              </span>
            </label>
            <IconButton title="Toggle axes (A)" onClick={() => setAxes(a => !a)}>{axes ? "Hide Axes" : "Show Axes"}</IconButton>
            <IconButton title="Fit view" onClick={fitView}>Fit</IconButton>
          </div>
        </div>
      </header>

      {/* Stage */}
      <section className="max-w-6xl mx-auto px-10 py-4">
        {/* Drop zone + stage frame */}
        <div
          ref={dropRef}
          className="group relative rounded-2xl overflow-hidden border border-white/10 bg-gradient-to-b from-white/[0.03] to-white/[0.01] shadow-2xl ring-white/20"
        >
          {/* a big stage */}
          <div className="relative w-full" style={{ paddingTop: "86.25%" }}>
            {/* R3F Canvas fills absolute area */}
            <div className="relative h-full" style={{ position: "absolute", top: 100, left: 100, right: 100, bottom: 100 }}>
              <Canvas camera={{ position: [0.2, 1.2, 0.6], fov: 45 }} onCreated={({ camera }) => (cameraRef.current = camera as THREE.PerspectiveCamera)}>
                <CanvasTicker
                  running={isPlaying}
                  speed={speed}
                  duration={duration}
                  loop={loop}
                  onTick={(dt) => setTime((t) => {
                    if (duration <= 0) return 0;
                    let nt = t + dt;
                    if (nt > duration) nt = loop ? (nt % duration) : duration;
                    return nt;
                  })}
                />
                <HandsScene currentFrame={currentFrame} axes={axes} />
                <Stats className="!left-auto !right-2 !top-2" />
              </Canvas>
            </div>

            {/* Empty state overlay */}
            {!frames.length && (
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <div className="text-3xl font-semibold mb-2">Drop a recording</div>
                  <p className="text-sm text-zinc-300">Drag & drop a JSON file here, or use <span className="underline">Upload JSON</span> above.</p>
                </div>
              </div>
            )}

            {/* HUD (top-left) */}
            <div className="absolute left-3 top-3 px-3 py-1.5 rounded-lg border border-white/10 bg-black/40 text-xs font-mono">
              {duration ? `${fmtTime(time)} / ${fmtTime(duration)}` : "No file loaded"}
            </div>

            {/* HUD (top-right) */}
            <div className="absolute right-3 top-3 px-3 py-1.5 rounded-lg border border-white/10 bg-black/40 text-xs">
              {isPlaying ? "Playing" : "Paused"} · {speed.toFixed(1)}× · {loop ? "Loop" : "No loop"}
            </div>
          </div>

          {/* Control bar */}
          <div className="absolute left-0 right-0 bottom-0 p-3 sm:p-4 bg-gradient-to-t from-black/70 via-black/40 to-transparent">
            <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-3 sm:p-4">
              {/* Transport row */}
              <div className="flex items-center gap-2">
                <IconButton title="Play/Pause (Space)" onClick={() => setPlaying(p => !p)} disabled={!frames.length}>
                  {isPlaying ? "Pause" : "Play"}
                </IconButton>
                <div className="hidden sm:block text-xs text-zinc-300 ml-1">
                  ⌨ Space · ←/→ step · Home/End · L loop · A axes
                </div>
                <div className="ml-auto flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    Speed
                    <input
                      type="range"
                      min={0.1}
                      max={3}
                      step={0.1}
                      value={speed}
                      onChange={e => setSpeed(parseFloat(e.target.value))}
                      className="accent-white/80"
                    />
                    <span className="tabular-nums">{speed.toFixed(1)}×</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />
                    Loop
                  </label>
                </div>
              </div>

              {/* Timeline */}
              <div className="mt-3">
                <Slider
                  value={Math.min(duration || 0, time)}
                  min={0}
                  max={Math.max(0.0001, duration)}
                  step={0.001}
                  onChange={(v) => setTime(v)}
                />
                <div className="mt-1 flex justify-between text-[10px] text-zinc-400 font-mono">
                  <span>0.00s</span>
                  <span>{fmtTime(duration * 0.25)}</span>
                  <span>{fmtTime(duration * 0.5)}</span>
                  <span>{fmtTime(duration * 0.75)}</span>
                  <span>{fmtTime(duration)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Tips */}
        <p className="mt-4 text-xs text-zinc-400">
          Tip: Space to play/pause · ← / → step · Home/End jump · L to toggle loop · A to toggle axes. Works with large JSON recordings.
        </p>
      </section>
    </div>
  );
}
