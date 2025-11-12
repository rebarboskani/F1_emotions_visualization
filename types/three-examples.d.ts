declare module "three/examples/jsm/controls/OrbitControls" {
  import type { Camera } from "three";
  import { EventDispatcher } from "three";

  export class OrbitControls extends EventDispatcher {
    constructor(object: Camera, domElement: HTMLElement);
    enableDamping: boolean;
    dampingFactor: number;
    update(): void;
    dispose(): void;
  }
}

declare module "three/examples/jsm/postprocessing/Pass" {
  export class Pass {
    enabled: boolean;
    needsSwap: boolean;
    clear: boolean;
    render(
      renderer: unknown,
      writeBuffer: unknown,
      readBuffer: unknown,
      deltaTime?: number,
      maskActive?: boolean
    ): void;
    setSize?(width: number, height: number): void;
    dispose?(): void;
  }
}

declare module "three/examples/jsm/postprocessing/EffectComposer" {
  import type { WebGLRenderer } from "three";
  import type { Pass } from "three/examples/jsm/postprocessing/Pass";

  export class EffectComposer {
    constructor(renderer: WebGLRenderer);
    addPass(pass: Pass): void;
    render(delta?: number): void;
    setSize(width: number, height: number): void;
    passes: Pass[];
  }
}

declare module "three/examples/jsm/postprocessing/RenderPass" {
  import type { Camera, Scene } from "three";
  import type { Pass } from "three/examples/jsm/postprocessing/Pass";

  export class RenderPass extends Pass {
    constructor(scene: Scene, camera: Camera);
  }
}

declare module "three/examples/jsm/postprocessing/UnrealBloomPass" {
  import type { Vector2 } from "three";
  import type { Pass } from "three/examples/jsm/postprocessing/Pass";

  export class UnrealBloomPass extends Pass {
    constructor(resolution: Vector2, strength: number, radius: number, threshold: number);
    threshold: number;
    strength: number;
    radius: number;
  }
}


