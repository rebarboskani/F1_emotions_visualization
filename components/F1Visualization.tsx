"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type EnhancedOrbitControls = OrbitControls & {
  enabled: boolean;
  target: THREE.Vector3;
};

type CinematicShot = {
  startTime: number;
  duration: number;
  shotType: "close-orbit" | "medium-pan" | "wide-orbit" | "top-down" | "zoom-in" | "zoom-out" | "static-center" | "perspective-sweep";
  baseAngle: number;
  orbitSpeed: number;
  panAmplitude: number;
  panSpeed: number;
  radius: number;
  radiusDrift: number;
  radiusDriftSpeed: number;
  height: number;
  heightDrift: number;
  heightDriftSpeed: number;
  focusZ: number;
  targetRingIndex: number | null;
  targetAngle: number;
  zoomBias: number;
};

type ThreeContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  orbitControls: EnhancedOrbitControls;
  container: HTMLDivElement;
  softTexture: THREE.Texture;
  ringDatas: RingData[];
  animationId: number;
  lastTime: number;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
};

const NUM_PARTICLES_PER_RING = 20000;
const NUM_SPARKS_PER_RING = 2000;
const PARTICLE_SIZE = 0.005;
const SPARK_SIZE = 0.015;
const CINEMATIC_SHOT_DURATION = 10;

type CinematicTrack = {
  title: string;
  src: string;
};

const CINEMATIC_TRACKS: CinematicTrack[] = [
  {
    title: "Dreams — Hayden Folker",
    src: encodeURI("/Hayden Folker_Dreams.mp3"),
  },
  {
    title: "Afterlife — Galaxytones",
    src: encodeURI("/Galaxytones_AFTERLIFE.mp3"),
  },
];

function applyCinematicCameraPose(
  context: ThreeContext,
  shot: CinematicShot,
  elapsed: number
) {
  const angle =
    shot.baseAngle +
    shot.orbitSpeed * elapsed +
    shot.panAmplitude * Math.sin(elapsed * shot.panSpeed);
  const radius =
    shot.radius + shot.radiusDrift * Math.sin(elapsed * shot.radiusDriftSpeed);
  const height =
    shot.height + shot.heightDrift * Math.sin(elapsed * shot.heightDriftSpeed);
  const zoomFactor = 1 + shot.zoomBias * Math.sin(elapsed * 0.2);

  const camX = Math.cos(angle) * radius * zoomFactor;
  const camY = Math.sin(angle) * radius * zoomFactor;
  const camZ = height;

  let targetX = 0;
  let targetY = 0;
  let targetZ = shot.focusZ;

  if (
    shot.targetRingIndex !== null &&
    context.ringDatas[shot.targetRingIndex]
  ) {
    const ring = context.ringDatas[shot.targetRingIndex];
    const focusAngle = shot.targetAngle;
    const focusRadius = ring.baseRadius;
    targetX = Math.cos(focusAngle) * focusRadius;
    targetY = Math.sin(focusAngle) * focusRadius;
  }

  context.camera.position.set(camX, camY, camZ);
  context.camera.lookAt(targetX, targetY, targetZ);
}

function createCinematicShot(
  context: ThreeContext,
  startTime: number
): CinematicShot {
  const hasRings = context.ringDatas.length > 0;
  const preferCloseUp = hasRings && Math.random() < 0.75;
  const roll = Math.random();
  let shotType: CinematicShot["shotType"];
  if (roll < 0.2) {
    shotType = "close-orbit";
  } else if (roll < 0.35) {
    shotType = "medium-pan";
  } else if (roll < 0.5) {
    shotType = "wide-orbit";
  } else if (roll < 0.65) {
    shotType = "top-down";
  } else if (roll < 0.78) {
    shotType = "zoom-in";
  } else if (roll < 0.9) {
    shotType = "zoom-out";
  } else if (roll < 0.95) {
    shotType = "static-center";
  } else {
    shotType = "perspective-sweep";
  }

  let targetRingIndex: number | null = null;
  let radius = 5;
  let height = 2;
  let focusZ = (Math.random() - 0.5) * 0.6;
  let targetAngle = Math.random() * Math.PI * 2;

  switch (shotType) {
    case "close-orbit":
    case "zoom-in":
    case "zoom-out":
      if (preferCloseUp) {
        targetRingIndex = Math.floor(Math.random() * context.ringDatas.length);
        const ring = context.ringDatas[targetRingIndex];
        const closeOffset = 0.2 + Math.random() * 0.5;
        radius = Math.max(1, ring.baseRadius + closeOffset);
        height = 0.2 + Math.random() * 0.7;
        focusZ = (Math.random() - 0.5) * 0.3;
      } else {
        radius = 4 + Math.random() * 2;
        height = 1.2 + Math.random() * 1;
      }
      break;
    case "medium-pan":
    case "static-center":
      radius = 4 + Math.random() * 2;
      height = 1.5 + Math.random() * 1.5;
      targetRingIndex =
        Math.random() < 0.5 && hasRings
          ? Math.floor(Math.random() * context.ringDatas.length)
          : null;
      break;
    case "wide-orbit":
    case "perspective-sweep":
      radius = 6 + Math.random() * 4;
      height = 2 + Math.random() * 2.5;
      break;
    case "top-down":
      radius = 0.01;
      height = 5 + Math.random() * 3;
      focusZ = 0;
      break;
  }

  if (shotType === "top-down") {
    targetRingIndex = null;
    targetAngle = 0;
  } else if (targetRingIndex === null && shotType !== "static-center") {
    targetAngle = Math.random() * Math.PI * 2;
  }

  let orbitSpeed = 0;
  let panAmplitude = 0.01 + Math.random() * 0.02;
  let panSpeed = 0.1 + Math.random() * 0.15;
  let radiusDrift = 0.02 + Math.random() * 0.05;
  let radiusDriftSpeed = 0.08 + Math.random() * 0.12;
  let heightDrift = 0.02 + Math.random() * 0.05;
  let heightDriftSpeed = 0.08 + Math.random() * 0.12;
  let zoomBias = 0;
  let duration = CINEMATIC_SHOT_DURATION;

  switch (shotType) {
    case "close-orbit":
      orbitSpeed = 0.018 + Math.random() * 0.015;
      panAmplitude = 0.04 + Math.random() * 0.06;
      radiusDrift = 0.05 + Math.random() * 0.08;
      heightDrift = 0.04 + Math.random() * 0.06;
      zoomBias = 0.08 + Math.random() * 0.12;
      break;
    case "medium-pan":
      orbitSpeed = 0;
      panAmplitude = 0.05 + Math.random() * 0.08;
      panSpeed = 0.08 + Math.random() * 0.12;
      radiusDrift = 0.03 + Math.random() * 0.05;
      heightDrift = 0.02 + Math.random() * 0.04;
      break;
    case "wide-orbit":
      orbitSpeed = 0.02 + Math.random() * 0.02;
      panAmplitude = 0.07 + Math.random() * 0.1;
      radiusDrift = 0.1 + Math.random() * 0.15;
      heightDrift = 0.06 + Math.random() * 0.1;
      break;
    case "top-down":
      orbitSpeed = 0.01 + Math.random() * 0.015;
      panAmplitude = 0.02 + Math.random() * 0.04;
      heightDrift = 0.1 + Math.random() * 0.15;
      panSpeed = 0.12 + Math.random() * 0.2;
      duration = CINEMATIC_SHOT_DURATION * 0.8;
      break;
    case "zoom-in":
      orbitSpeed = 0.01 + Math.random() * 0.015;
      panAmplitude = 0.03 + Math.random() * 0.05;
      radiusDrift = 0.18 + Math.random() * 0.25;
      radiusDriftSpeed = 0.05 + Math.random() * 0.08;
      zoomBias = -0.2 - Math.random() * 0.2;
      break;
    case "zoom-out":
      orbitSpeed = 0.012 + Math.random() * 0.015;
      panAmplitude = 0.04 + Math.random() * 0.06;
      radiusDrift = 0.2 + Math.random() * 0.3;
      radiusDriftSpeed = 0.05 + Math.random() * 0.08;
      zoomBias = 0.18 + Math.random() * 0.25;
      break;
    case "static-center":
      orbitSpeed = 0;
      panAmplitude = 0.015 + Math.random() * 0.03;
      radiusDrift = 0.01 + Math.random() * 0.02;
      heightDrift = 0.01 + Math.random() * 0.02;
      duration = CINEMATIC_SHOT_DURATION * 0.9;
      targetRingIndex = null;
      targetAngle = 0;
      radius = 3.5 + Math.random() * 1.5;
      height = 1.5 + Math.random() * 1.5;
      break;
    case "perspective-sweep":
      orbitSpeed = 0.025 + Math.random() * 0.03;
      panAmplitude = 0.06 + Math.random() * 0.1;
      panSpeed = 0.12 + Math.random() * 0.2;
      radiusDrift = 0.12 + Math.random() * 0.2;
      heightDrift = 0.08 + Math.random() * 0.12;
      zoomBias = 0.08 + Math.random() * 0.15;
      break;
  }

  return {
    startTime,
    duration,
    shotType,
    baseAngle: Math.random() * Math.PI * 2,
    orbitSpeed,
    panAmplitude,
    panSpeed,
    radius,
    radiusDrift,
    radiusDriftSpeed,
    height,
    heightDrift,
    heightDriftSpeed,
    focusZ,
    targetRingIndex,
    targetAngle,
    zoomBias,
  };
}

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
    const baseRadius = 0.5 + index * 0.3;
    const color = new THREE.Color(driver.color);
    const group = new THREE.Group();
      group.userData.driver = driver.driver;

    const mainPositions = new Float32Array(NUM_PARTICLES_PER_RING * 3);
    const mainColors = new Float32Array(NUM_PARTICLES_PER_RING * 3);
    const mainOffsets = new Float32Array(NUM_PARTICLES_PER_RING);

    for (let j = 0; j < NUM_PARTICLES_PER_RING; j += 1) {
      const theta =
        (j / NUM_PARTICLES_PER_RING) * Math.PI * 2 + Math.random() * 0.01;
      const offsetSeed = (Math.random() - 0.5) * 2 * 0.4;
      mainOffsets[j] = offsetSeed;
      const r = baseRadius + offsetSeed * 0.1;

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
    mainGeometry.setAttribute(
      "offsetSeed",
      new THREE.BufferAttribute(mainOffsets, 1)
    );

    const mainMaterial = new THREE.PointsMaterial({
      size: PARTICLE_SIZE,
      map: softTexture,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mainPoints = new THREE.Points(mainGeometry, mainMaterial);
    group.add(mainPoints);

    const sparkPositions = new Float32Array(NUM_SPARKS_PER_RING * 3);
    const sparkColors = new Float32Array(NUM_SPARKS_PER_RING * 3);
    const sparkOffsets = new Float32Array(NUM_SPARKS_PER_RING);

    for (let j = 0; j < NUM_SPARKS_PER_RING; j += 1) {
      const theta = Math.random() * Math.PI * 2;
      const offsetSeed = (Math.random() - 0.5) * 2 * 0.4;
      sparkOffsets[j] = offsetSeed;
      const r = baseRadius + offsetSeed * 0.15;
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
    sparkGeometry.setAttribute(
      "offsetSeed",
      new THREE.BufferAttribute(sparkOffsets, 1)
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
  const cinematicModeRef = useRef(false);
  const cinematicTimeRef = useRef(0);
  const cinematicShotRef = useRef<CinematicShot | null>(null);
  const pendingShotResetRef = useRef(false);
  const manualCameraStateRef = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioFadeIntervalRef = useRef<number | null>(null);
  const audioVolumeRef = useRef(0.6);
  const lastTrackRef = useRef<string | null>(null);
  const [selectedLap, setSelectedLap] = useState<number>(
    data.available_laps[0] ?? 0
  );
  const [hoveredDriver, setHoveredDriver] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [badgeHidden, setBadgeHidden] = useState(false);
  const [cinematicMode, setCinematicMode] = useState(false);
  const [cinematicHudVisible, setCinematicHudVisible] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<CinematicTrack | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0.6);

  const availableLaps = data.available_laps;

  const clearAudioFade = useCallback(() => {
    if (audioFadeIntervalRef.current !== null) {
      window.clearInterval(audioFadeIntervalRef.current);
      audioFadeIntervalRef.current = null;
    }
  }, []);

  const fadeAudioTo = useCallback(
    (targetVolume: number, duration = 2000, onComplete?: () => void) => {
      const audio = audioRef.current;
      if (!audio) {
        if (onComplete) onComplete();
        return;
      }
      const activeAudio = audio;
      clearAudioFade();
      const steps = Math.max(1, Math.round(duration / 50));
      const stepDuration = duration / steps;
      const startVolume = activeAudio.volume;
      let currentStep = 0;
      audioFadeIntervalRef.current = window.setInterval(() => {
        currentStep += 1;
        const progress = Math.min(currentStep / steps, 1);
        const nextVolume =
          startVolume + (targetVolume - startVolume) * progress;
        activeAudio.volume = Math.max(0, Math.min(1, nextVolume));
        if (progress >= 1) {
          clearAudioFade();
          if (onComplete) {
            onComplete();
          }
        }
      }, stepDuration);
    },
    [clearAudioFade]
  );

  useEffect(() => {
    audioVolumeRef.current = audioVolume;
    if (audioRef.current && audioFadeIntervalRef.current === null) {
      audioRef.current.volume = audioVolume;
    }
  }, [audioVolume]);

  const currentLapDrivers = useMemo<DriverEmotionEntry[]>(() => {
    const lapKey = String(selectedLap);
    const lapData = data.lap_data[lapKey];
    if (!lapData) {
      return [];
    }
    return lapData.drivers;
  }, [data.lap_data, selectedLap]);

  const advanceLapForCinematic = () => {
    if (availableLaps.length === 0) {
      return;
    }
    setSelectedLap((prev) => {
      if (availableLaps.length === 0) {
        return prev;
      }
      const currentIndex = availableLaps.indexOf(prev);
      const nextIndex =
        currentIndex === -1
          ? 0
          : (currentIndex + 1) % availableLaps.length;
      return availableLaps[nextIndex];
    });
  };

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

    const orbitControls = new OrbitControls(
      camera,
      renderer.domElement
    ) as EnhancedOrbitControls;
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;

    const softTexture = createSoftTexture();
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = raycaster.params.Points ?? {};
    raycaster.params.Points.threshold = 0.08;
    const pointer = new THREE.Vector2();

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
      raycaster,
      pointer,
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

    const pickDriverAtPointer = (
      clientX: number,
      clientY: number
    ): string | null => {
      const { renderer: ctxRenderer, camera: ctxCamera, ringDatas } = context;
      const rect = ctxRenderer.domElement.getBoundingClientRect();
      context.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      context.pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
      context.raycaster.setFromCamera(context.pointer, ctxCamera);
      const groups = ringDatas.map((ring) => ring.group);
      const intersects = context.raycaster.intersectObjects(groups, true);
      if (intersects.length === 0) {
        return null;
      }

      for (const intersect of intersects) {
        let current: THREE.Object3D | null = intersect.object;
        while (current) {
          if (typeof current.userData?.driver === "string") {
            return current.userData.driver;
          }
          current = current.parent;
        }
      }

      return null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const driverMatch = pickDriverAtPointer(event.clientX, event.clientY);
      if (driverMatch) {
        const rootRect = context.container.getBoundingClientRect();
        setHoverPosition({
          x: event.clientX - rootRect.left,
          y: event.clientY - rootRect.top,
        });
        setHoveredDriver(driverMatch);
      } else {
        setHoveredDriver(null);
        setHoverPosition(null);
      }
    };

    const handlePointerLeave = () => {
      setHoveredDriver(null);
      setHoverPosition(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const driverMatch = pickDriverAtPointer(event.clientX, event.clientY);
      if (driverMatch) {
        setBadgeHidden((prev) => !prev);
      }
    };

    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);

    const animate = (time: number) => {
      const seconds = time / 1000;
      const delta = seconds - context.lastTime;
      context.lastTime = seconds;

      context.ringDatas.forEach((ringData, index) => {
        const group = ringData.group;
        const controls = ringControlsRef.current[index];
        if (!controls) return;

        const orbitFactor = controls.orbitSpeed * 0.6;
        group.rotation.z += delta * orbitFactor;

        const wobble = controls.wobbleAmp * 0.2 * Math.sin(seconds + index);
        group.rotation.x = wobble;

        const positionAttribute = ringData.mainGeometry.getAttribute(
          "position"
        ) as THREE.BufferAttribute;
        const offsetAttribute = ringData.mainGeometry.getAttribute(
          "offsetSeed"
        ) as THREE.BufferAttribute | undefined;
        const count = positionAttribute.count;
        const positions = positionAttribute.array as Float32Array;
        const offsets = offsetAttribute
          ? (offsetAttribute.array as Float32Array)
          : null;

        for (let i = 0; i < count; i += 1) {
          const theta = (i / count) * Math.PI * 2;
          const offset = offsets ? offsets[i] : 0;

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

        const sparkPositionAttribute = ringData.sparkGeometry.getAttribute(
          "position"
        ) as THREE.BufferAttribute | undefined;
        const sparkOffsetAttribute = ringData.sparkGeometry.getAttribute(
          "offsetSeed"
        ) as THREE.BufferAttribute | undefined;

        if (sparkPositionAttribute) {
          const sparkCount = sparkPositionAttribute.count;
          const sparkPositions = sparkPositionAttribute.array as Float32Array;
          const sparkOffsets = sparkOffsetAttribute
            ? (sparkOffsetAttribute.array as Float32Array)
            : null;

          for (let i = 0; i < sparkCount; i += 1) {
            const theta = (i / sparkCount) * Math.PI * 2;
            const offset = sparkOffsets ? sparkOffsets[i] : 0;

            const sparkThickness = controls.thickness * 0.15;
            let r = ringData.baseRadius + offset * sparkThickness;

            const shake =
              controls.shakeIntensity * 0.08 * Math.sin(seconds * 12 + i);
            r *= 1 + shake;

            const osc =
              controls.oscillationAmp *
              0.25 *
              Math.sin(theta * 7 + seconds * 4 + index);

            sparkPositions[i * 3] = r * Math.cos(theta);
            sparkPositions[i * 3 + 1] = r * Math.sin(theta);
            sparkPositions[i * 3 + 2] = osc;
          }

          sparkPositionAttribute.needsUpdate = true;
        }
      });

      const isCinematic = cinematicModeRef.current;
      if (isCinematic) {
        cinematicTimeRef.current += delta;
        let shot = cinematicShotRef.current;
        if (!shot && !pendingShotResetRef.current) {
          shot = createCinematicShot(context, cinematicTimeRef.current);
          cinematicShotRef.current = shot;
        }
        if (shot) {
          const shotElapsed = cinematicTimeRef.current - shot.startTime;
          if (shotElapsed >= shot.duration) {
            pendingShotResetRef.current = true;
            cinematicShotRef.current = null;
            advanceLapForCinematic();
          } else {
            applyCinematicCameraPose(context, shot, shotElapsed);
          }
        }
      }

      context.orbitControls.update();
      context.composer.render();
      context.animationId = requestAnimationFrame(animate);
    };

    context.animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(context.animationId);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener(
        "pointerleave",
        handlePointerLeave
      );
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);

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
    cinematicModeRef.current = cinematicMode;
    const context = contextRef.current;
    if (context) {
      context.orbitControls.enabled = !cinematicMode;
      if (cinematicMode) {
        cinematicTimeRef.current = 0;
        manualCameraStateRef.current = {
          position: context.camera.position.clone(),
          target: context.orbitControls.target.clone(),
        };
        cinematicShotRef.current = createCinematicShot(context, 0);
        pendingShotResetRef.current = false;
        applyCinematicCameraPose(context, cinematicShotRef.current, 0);
      } else {
        cinematicTimeRef.current = 0;
        cinematicShotRef.current = null;
        pendingShotResetRef.current = false;
        if (manualCameraStateRef.current) {
          const { position, target } = manualCameraStateRef.current;
          context.camera.position.copy(position);
          context.orbitControls.target.copy(target);
          context.camera.lookAt(target);
          manualCameraStateRef.current = null;
        }
        context.orbitControls.update();
      }
    }
    setCinematicHudVisible(!cinematicMode);
  }, [cinematicMode]);

  useEffect(() => {
    if (!cinematicMode) {
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const margin = 220;
      const verticalMargin = 200;
      const viewportWidth = window.innerWidth;
      const isNearCorner =
        event.clientX >= viewportWidth - margin && event.clientY <= verticalMargin;
      setCinematicHudVisible(isNearCorner);
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [cinematicMode]);

  useEffect(() => {
    const finalizeStop = () => {
      clearAudioFade();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
        audioRef.current = null;
      }
      setIsAudioPlaying(false);
      setCurrentTrack(null);
    };

    const stopAudio = (withFade: boolean) => {
      if (!audioRef.current) {
        finalizeStop();
        return;
      }
      if (withFade) {
        fadeAudioTo(0, 800, finalizeStop);
      } else {
        finalizeStop();
      }
    };

    const startAudio = async () => {
      if (CINEMATIC_TRACKS.length === 0) {
        return;
      }
      let track =
        CINEMATIC_TRACKS[
          Math.floor(Math.random() * CINEMATIC_TRACKS.length)
        ];
      if (
        CINEMATIC_TRACKS.length > 1 &&
        track.src === lastTrackRef.current
      ) {
        track =
          CINEMATIC_TRACKS.filter(
            (candidate) => candidate.src !== lastTrackRef.current
          )[0] ?? track;
      }

      stopAudio(false);

      const audio = new Audio(track.src);
      audio.loop = true;
      audio.volume = 0;
      audioRef.current = audio;
      lastTrackRef.current = track.src;
      setCurrentTrack(track);
      try {
        await audio.play();
        setIsAudioPlaying(true);
        fadeAudioTo(audioVolumeRef.current, 2000);
      } catch (error) {
        console.warn("Unable to start cinematic audio", error);
        setIsAudioPlaying(false);
      }
    };

    if (cinematicMode) {
      startAudio();
    } else {
      stopAudio(true);
    }

    return () => {
      stopAudio(false);
    };
  }, [cinematicMode, fadeAudioTo, clearAudioFade]);

  useEffect(() => {
    const context = contextRef.current;
    if (!context) {
      return;
    }

    createRings(context, ringControlsRef, currentLapDrivers);
    if (cinematicModeRef.current) {
      if (pendingShotResetRef.current || !cinematicShotRef.current) {
        cinematicShotRef.current = createCinematicShot(
          context,
          cinematicTimeRef.current
        );
        pendingShotResetRef.current = false;
      }
    }
  }, [currentLapDrivers, selectedLap]);

  const handleLapChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = Number.parseInt(event.target.value, 10);
    if (Number.isNaN(value)) return;
    setSelectedLap(value);
  };

  const handleAudioPlayPause = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      audio.play();
      setIsAudioPlaying(true);
      fadeAudioTo(audioVolumeRef.current, 600);
    } else {
      fadeAudioTo(0, 400, () => {
        audio.pause();
        setIsAudioPlaying(false);
      });
    }
  };

  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value);
    setAudioVolume(value);
    if (audioRef.current && audioFadeIntervalRef.current === null) {
      audioRef.current.volume = value;
    }
  };

  const handleCinematicToggle = () => {
    setCinematicMode((prev) => {
      const next = !prev;
      if (!next) {
        setBadgeHidden(false);
        setCinematicHudVisible(false);
      } else {
        setCinematicHudVisible(false);
      }
      return next;
    });
  };

  const rootClassName = `${styles.root} ${
    cinematicMode ? styles.cinematic : ""
  }`;
  const cinematicSwitchClass = `${styles.cinematicSwitch} ${
    cinematicMode && !cinematicHudVisible ? styles.cinematicSwitchHidden : ""
  }`;

  return (
    <div className={rootClassName}>
      <div ref={containerRef} className={styles.canvasContainer} />

      <div className={cinematicSwitchClass}>
        <button
          type="button"
          className={`${styles.cinematicToggle} ${
            cinematicMode ? styles.cinematicActive : ""
          }`}
          onClick={handleCinematicToggle}
        >
          {cinematicMode ? "Exit Cinematic Mode" : "Enter Cinematic Mode"}
        </button>
        {cinematicMode && currentTrack && (
          <div className={styles.audioControls}>
            <div className={styles.audioTrackInfo}>
              <span className={styles.audioLabel}>Now Playing</span>
              <span className={styles.audioTitle}>{currentTrack.title}</span>
            </div>
            <div className={styles.audioControlRow}>
              <button
                type="button"
                className={styles.audioPlayButton}
                onClick={handleAudioPlayPause}
              >
                {isAudioPlaying ? "Pause" : "Play"}
              </button>
              <div className={styles.audioVolume}>
                <span>Vol</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={audioVolume}
                  onChange={handleVolumeChange}
                />
              </div>
            </div>
          </div>
        )}
      </div>

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

      {hoveredDriver && hoverPosition && !badgeHidden && (
        <SelectionBadge driver={hoveredDriver} position={hoverPosition} />
      )}

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

type SelectionBadgeProps = {
  driver: string;
  position: {
    x: number;
    y: number;
  };
};

function SelectionBadge({ driver, position }: SelectionBadgeProps) {
  const code = driver.slice(0, 3).toUpperCase();
  const offset = 16;
  const left = position.x + offset;
  const top = position.y + offset;

  return (
    <div
      className={styles.selectionBadge}
      style={{ left, top }}
    >
      <span className={styles.selectionLabel}></span>
      <span className={styles.selectionCode}>{code}</span>
    </div>
  );
}


