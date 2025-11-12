"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";

import styles from "@/app/page.module.css";
import type {
  DriverEmotionEntry,
  F1EmotionsResponse,
} from "@/types/emotions";

type RingControls = {
  orbitSpeed: number;
  thickness: number;
  oscillationAmp: number;
  shakeIntensity: number;
  wobbleAmp: number;
};

type RingData = {
  group: THREE.Group;
  mainGeometry: THREE.BufferGeometry;
  mainMaterial: THREE.PointsMaterial;
  sparkGeometry: THREE.BufferGeometry;
  sparkMaterial: THREE.PointsMaterial;
  baseRadius: number;
  color: THREE.Color;
  driver: string;
  position: number;
};

type ThreeContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  orbitControls: OrbitControls;
  container: HTMLDivElement;
  softTexture: THREE.Texture;
  ringDatas: RingData[];
  animationId: number;
  lastTime: number;
};

const NUM_PARTICLES_PER_RING = 20000;
const NUM_SPARKS_PER_RING = 2000;
const PARTICLE_SIZE = 0.005;
const SPARK_SIZE = 0.015;

function createSoftTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create 2D context for particle texture.");
  }
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function disposeRing(scene: THREE.Scene, ringData: RingData) {
  scene.remove(ringData.group);
  ringData.mainGeometry.dispose();
  ringData.mainMaterial.dispose();
  ringData.sparkGeometry.dispose();
  ringData.sparkMaterial.dispose();
}

function applyEmotionData(rings: RingControls[], drivers: DriverEmotionEntry[]) {
  drivers.forEach((driver, index) => {
    const target = rings[index];
    if (!target) return;
    target.orbitSpeed = driver.emotions.frustration;
    target.thickness = driver.emotions.pressure;
    target.oscillationAmp = driver.emotions.confidence;
    target.shakeIntensity = driver.emotions.risk_taking;
    target.wobbleAmp = driver.emotions.aggressiveness;
  });
}

function createRings(
  context: ThreeContext,
  ringsControl: MutableRefObject<RingControls[]>,
  drivers: DriverEmotionEntry[]
) {
  context.ringDatas.forEach((ring) => disposeRing(context.scene, ring));
  context.ringDatas = [];
  ringsControl.current = [];

  if (drivers.length === 0) {
    return;
  }

  const { scene, softTexture } = context;

  drivers.forEach((driver, index) => {
    const baseRadius = 1 + index * 0.3;
    const color = new THREE.Color(driver.color);
    const group = new THREE.Group();

    const mainPositions = new Float32Array(NUM_PARTICLES_PER_RING * 3);
    const mainColors = new Float32Array(NUM_PARTICLES_PER_RING * 3);

    for (let j = 0; j < NUM_PARTICLES_PER_RING; j += 1) {
      const theta =
        (j / NUM_PARTICLES_PER_RING) * Math.PI * 2 + Math.random() * 0.01;
      const r = baseRadius + (Math.random() - 0.5) * 0.2;

      mainPositions[j * 3] = r * Math.cos(theta);
      mainPositions[j * 3 + 1] = r * Math.sin(theta);
      mainPositions[j * 3 + 2] = 0;

      const variedColor = color.clone();
      const hueOffset = 0;
      const saturationOffset = 0;
      const lightnessOffset = (Math.random() - 0.5) * 0.1;
      variedColor.offsetHSL(hueOffset, saturationOffset, lightnessOffset);
      mainColors[j * 3] = variedColor.r;
      mainColors[j * 3 + 1] = variedColor.g;
      mainColors[j * 3 + 2] = variedColor.b;
    }

    const mainGeometry = new THREE.BufferGeometry();
    mainGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(mainPositions, 3)
    );
    mainGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(mainColors, 3)
    );

    const mainMaterial = new THREE.PointsMaterial({
      size: PARTICLE_SIZE,
      map: softTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mainPoints = new THREE.Points(mainGeometry, mainMaterial);
    group.add(mainPoints);

    const sparkPositions = new Float32Array(NUM_SPARKS_PER_RING * 3);
    const sparkColors = new Float32Array(NUM_SPARKS_PER_RING * 3);

    for (let j = 0; j < NUM_SPARKS_PER_RING; j += 1) {
      const theta = Math.random() * Math.PI * 2;
      const r = baseRadius + (Math.random() - 0.5) * 0.3;
      sparkPositions[j * 3] = r * Math.cos(theta);
      sparkPositions[j * 3 + 1] = r * Math.sin(theta);
      sparkPositions[j * 3 + 2] = 0;

      sparkColors[j * 3] = color.r;
      sparkColors[j * 3 + 1] = color.g;
      sparkColors[j * 3 + 2] = color.b;
    }

    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(sparkPositions, 3)
    );
    sparkGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(sparkColors, 3)
    );

    const sparkMaterial = new THREE.PointsMaterial({
      size: SPARK_SIZE,
      map: softTexture,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
    group.add(sparkPoints);

    scene.add(group);

    context.ringDatas.push({
      group,
      mainGeometry,
      mainMaterial,
      sparkGeometry,
      sparkMaterial,
      baseRadius,
      color,
      driver: driver.driver,
      position: driver.position,
    });

    ringsControl.current.push({
      orbitSpeed: 0.5,
      thickness: 0.5,
      oscillationAmp: 0.5,
      shakeIntensity: 0.5,
      wobbleAmp: 0.5,
    });
  });

  applyEmotionData(ringsControl.current, drivers);
}

type VisualizationProps = {
  data: F1EmotionsResponse;
};

export default function F1Visualization({ data }: VisualizationProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef<ThreeContext | null>(null);
  const ringControlsRef = useRef<RingControls[]>([]);
  const [selectedLap, setSelectedLap] = useState<number>(
    data.available_laps[0] ?? 0
  );

  const availableLaps = data.available_laps;

  const currentLapDrivers = useMemo<DriverEmotionEntry[]>(() => {
    const lapKey = String(selectedLap);
    const lapData = data.lap_data[lapKey];
    if (!lapData) {
      return [];
    }
    return lapData.drivers;
  }, [data.lap_data, selectedLap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || contextRef.current) {
      return;
    }

    const scene = new THREE.Scene();
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 0, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000);
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 1.0;

    container.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      1.5,
      0.4,
      0.85
    );
    bloomPass.threshold = 0.1;
    bloomPass.strength = 1.2;
    bloomPass.radius = 0.5;
    composer.addPass(bloomPass);

    const orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;

    const softTexture = createSoftTexture();

    const context: ThreeContext = {
      scene,
      camera,
      renderer,
      composer,
      bloomPass,
      orbitControls,
      container,
      softTexture,
      ringDatas: [],
      animationId: 0,
      lastTime: 0,
    };

    contextRef.current = context;

    const handleResize = () => {
      const newWidth = container.clientWidth || window.innerWidth;
      const newHeight = container.clientHeight || window.innerHeight;
      context.camera.aspect = newWidth / newHeight;
      context.camera.updateProjectionMatrix();
      context.renderer.setSize(newWidth, newHeight);
      context.composer.setSize(newWidth, newHeight);
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    const animate = (time: number) => {
      const seconds = time / 1000;
      const delta = seconds - context.lastTime;
      context.lastTime = seconds;

      context.ringDatas.forEach((ringData, index) => {
        const group = ringData.group;
        const controls = ringControlsRef.current[index];
        if (!controls) return;

        const orbitFactor = controls.orbitSpeed * 2;
        group.rotation.z += delta * orbitFactor;

        const wobble = controls.wobbleAmp * 0.2 * Math.sin(seconds + index);
        group.rotation.x = wobble;

        const positionAttribute = ringData.mainGeometry.getAttribute(
          "position"
        ) as THREE.BufferAttribute;
        const count = positionAttribute.count;
        const positions = positionAttribute.array as Float32Array;

        for (let i = 0; i < count; i += 1) {
          const theta = (i / count) * Math.PI * 2;
          const offset = (Math.random() - 0.5) * 2;

          const thick = controls.thickness * 0.3;
          let r = ringData.baseRadius + offset * thick;

          const shake =
            controls.shakeIntensity * 0.1 * Math.sin(seconds * 10 + i);
          r *= 1 + shake;

          const osc =
            controls.oscillationAmp * 0.3 * Math.sin(theta * 5 + seconds * 3 + index);

          positions[i * 3] = r * Math.cos(theta);
          positions[i * 3 + 1] = r * Math.sin(theta);
          positions[i * 3 + 2] = osc;
        }

        positionAttribute.needsUpdate = true;
      });

      context.orbitControls.update();
      context.composer.render();
      context.animationId = requestAnimationFrame(animate);
    };

    context.animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(context.animationId);
      window.removeEventListener("resize", handleResize);

      context.ringDatas.forEach((ring) => disposeRing(context.scene, ring));
      context.ringDatas = [];

      context.softTexture.dispose();
      context.renderer.dispose();
      context.composer.passes.forEach((pass) => {
        if ("dispose" in pass && typeof pass.dispose === "function") {
          pass.dispose();
        }
      });
      context.orbitControls.dispose();

      if (context.renderer.domElement.parentNode) {
        context.renderer.domElement.parentNode.removeChild(
          context.renderer.domElement
        );
      }

      contextRef.current = null;
    };
  }, []);

  useEffect(() => {
    const context = contextRef.current;
    if (!context) {
      return;
    }

    createRings(context, ringControlsRef, currentLapDrivers);
  }, [currentLapDrivers, selectedLap]);

  const handleLapChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = Number.parseInt(event.target.value, 10);
    if (Number.isNaN(value)) return;
    setSelectedLap(value);
  };

  return (
    <div className={styles.root}>
      <div ref={containerRef} className={styles.canvasContainer} />

      <div className={styles.controls}>
        <div className={styles.lapSelector}>
          <label htmlFor="lap-select">Select Lap:</label>
          <div className={styles.lapSelectWrapper}>
            <select
              id="lap-select"
              className={styles.lapSelect}
              value={selectedLap}
              onChange={handleLapChange}
            >
              {availableLaps.map((lap) => (
                <option key={lap} value={lap}>
                  {`Lap ${lap}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.infoPanel}>
          <h3>Driver Emotions</h3>
          <div className={styles.driverInfo}>
            {currentLapDrivers.map((driver, index) => (
              <div key={driver.driver} className={styles.driverCard}>
                <div className={styles.driverName}>
                  {driver.driver} - P{driver.position} (Ring {index + 1})
                </div>
                <EmotionRow
                  label="Frustration"
                  value={driver.emotions.frustration}
                  className={styles.frustration}
                />
                <EmotionRow
                  label="Pressure"
                  value={driver.emotions.pressure}
                  className={styles.pressure}
                />
                <EmotionRow
                  label="Confidence"
                  value={driver.emotions.confidence}
                  className={styles.confidence}
                />
                <EmotionRow
                  label="Risk-taking"
                  value={driver.emotions.risk_taking}
                  className={styles.risk}
                />
                <EmotionRow
                  label="Aggressiveness"
                  value={driver.emotions.aggressiveness}
                  className={styles.aggressiveness}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {availableLaps.length === 0 && (
        <div className={styles.error}>
          Failed to load data. Ensure the emotions dataset is available.
        </div>
      )}
      {availableLaps.length > 0 && (
        <div className={styles.status}>
          {currentLapDrivers.length > 0
            ? `Displaying Lap ${selectedLap} - ${currentLapDrivers.length} drivers`
            : `No data available for Lap ${selectedLap}`}
        </div>
      )}
    </div>
  );
}

type EmotionRowProps = {
  label: string;
  value: number;
  className: string;
};

function EmotionRow({ label, value, className }: EmotionRowProps) {
  const percentage = Number.isFinite(value) ? value * 100 : 0;
  const clamped = Math.max(0, Math.min(100, percentage));

  return (
    <div className={styles.emotionBar}>
      <span className={styles.emotionLabel}>{label}:</span>
      <span className={styles.emotionValue}>{clamped.toFixed(1)}%</span>
      <div className={styles.emotionVisual}>
        <div
          className={`${styles.emotionFill} ${className}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}


