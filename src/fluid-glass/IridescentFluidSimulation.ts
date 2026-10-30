import * as THREE from "three";
import { GPUComputationRenderer, type Variable } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import type { TradeEvent } from "../types";
import { clamp } from "../utils/format";
import HeightmapFragment from "./shaders/heightmap.glsl?raw";
import SurfaceFragment from "./shaders/surface.frag.glsl?raw";
import SurfaceVertex from "./shaders/surface.vert.glsl?raw";

const MAX_DROPS = 18;
const LONG_AXIS = 384;
const MAX_QUEUE = 72;

interface FluidDrop {
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  radius: number;
  amplitude: number;
  charge: number;
}

interface FluidOptions {
  reducedMotion?: boolean;
}

export class IridescentFluidSimulation {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private gpuCompute!: GPUComputationRenderer;
  private heightmapVariable!: Variable;
  private fboWidth = LONG_AXIS;
  private fboHeight = LONG_AXIS / 2;
  private geomWidth = 1;
  private geomHeight = 1;
  private frame = 0;
  private lastFrame = performance.now();
  private lastImpulse = performance.now();
  private elapsed = 0;
  private paused = false;
  private dominance = 0;
  private impulse = 0;
  private priceLow: number | null = null;
  private priceHigh: number | null = null;
  private queue: FluidDrop[] = [];
  private readonly reducedMotion: boolean;
  private readonly dropPositions = Array.from({ length: MAX_DROPS }, () => new THREE.Vector2());
  private readonly dropDirections = Array.from({ length: MAX_DROPS }, () => new THREE.Vector2(1, 0));
  private readonly dropRadii = new Float32Array(MAX_DROPS);
  private readonly dropAmplitudes = new Float32Array(MAX_DROPS);
  private readonly dropCharges = new Float32Array(MAX_DROPS);
  private readonly onResize = () => this.resize();

  constructor(canvas: HTMLCanvasElement, options: FluidOptions = {}) {
    this.canvas = canvas;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setClearColor(0x060709, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        heightmap: { value: null },
        time: { value: 0 },
        dominance: { value: 0 },
        impulse: { value: 0 },
        viewport: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: SurfaceVertex,
      fragmentShader: SurfaceFragment,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 2, 2), this.material);
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
    this.camera.position.z = 20;
    this.camera.lookAt(0, 0, 0);

    window.addEventListener("resize", this.onResize);
    this.resize();
  }

  start(): void {
    if (this.frame || this.paused) return;
    this.lastFrame = performance.now();
    this.frame = window.requestAnimationFrame(this.render);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      window.cancelAnimationFrame(this.frame);
      this.frame = 0;
      return;
    }
    this.start();
  }

  resetMarket(): void {
    this.priceLow = null;
    this.priceHigh = null;
    this.queue.length = 0;
    this.dominance = 0;
  }

  pushTrade(trade: TradeEvent): void {
    this.trackPrice(trade.price);
    const normalizedSize = clamp(Math.log(Math.max(trade.size, 1_000) / 1_000) / Math.log(1_000), 0, 1);
    const side = trade.side === "buy" ? 1 : -1;
    const sidePosition = THREE.MathUtils.lerp(0.34, 0.075, normalizedSize);
    const x = side * sidePosition * this.geomWidth;
    const pricePosition = this.pricePosition(trade.price);
    const y = pricePosition * this.geomHeight * 0.72 + (Math.random() - 0.5) * this.geomHeight * 0.12;
    const radiusScale = Math.min(this.geomWidth, this.geomHeight) / 760;

    this.enqueue({
      x,
      y,
      directionX: -side,
      directionY: (Math.random() - 0.5) * 0.75,
      radius: THREE.MathUtils.lerp(22, 138, normalizedSize) * clamp(radiusScale, 0.55, 1.25),
      amplitude: THREE.MathUtils.lerp(0.22, 1.65, normalizedSize),
      charge: side * THREE.MathUtils.lerp(0.12, 1.05, normalizedSize),
    });

    this.dominance = clamp(this.dominance * 0.9 + side * THREE.MathUtils.lerp(0.018, 0.13, normalizedSize), -1, 1);
    this.impulse = clamp(this.impulse + THREE.MathUtils.lerp(0.06, 0.42, normalizedSize), 0, 1);
  }

  disturb(normalizedX = 0.5, normalizedY = 0.5, velocityX = 1, velocityY = 0): void {
    const radiusScale = Math.min(this.geomWidth, this.geomHeight) / 760;
    this.enqueue({
      x: (clamp(normalizedX, 0, 1) - 0.5) * this.geomWidth,
      y: (0.5 - clamp(normalizedY, 0, 1)) * this.geomHeight,
      directionX: velocityX,
      directionY: -velocityY,
      radius: 72 * clamp(radiusScale, 0.62, 1.35),
      amplitude: this.reducedMotion ? 0.42 : 1.18,
      charge: 0,
    });
    this.impulse = clamp(this.impulse + 0.24, 0, 1);
  }

  dispose(): void {
    window.cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.onResize);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.gpuCompute?.dispose?.();
  }

  private readonly render = (now: number): void => {
    if (this.paused) return;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.06);
    this.lastFrame = now;
    this.elapsed += dt;
    this.dominance *= Math.exp(-dt / 4.4);
    this.impulse *= Math.exp(-dt / 1.15);

    if (!this.reducedMotion && now - this.lastImpulse > 2_600 && this.queue.length === 0) {
      const angle = this.elapsed * 0.47;
      this.enqueue({
        x: Math.sin(angle) * this.geomWidth * 0.22,
        y: Math.cos(angle * 1.31) * this.geomHeight * 0.2,
        directionX: Math.cos(angle),
        directionY: Math.sin(angle),
        radius: Math.min(this.geomWidth, this.geomHeight) * 0.14,
        amplitude: 0.34,
        charge: 0,
      });
    }

    const drops = this.queue.splice(0, MAX_DROPS);
    for (let index = 0; index < drops.length; index += 1) {
      const drop = drops[index];
      this.dropPositions[index].set(drop.x, drop.y);
      this.dropDirections[index].set(drop.directionX, drop.directionY).normalize();
      this.dropRadii[index] = drop.radius;
      this.dropAmplitudes[index] = drop.amplitude;
      this.dropCharges[index] = drop.charge;
    }

    const uniforms = this.heightmapVariable.material.uniforms;
    uniforms.dropCount.value = drops.length;
    uniforms.viscosity.value = this.reducedMotion ? 0.979 : 0.9915;
    uniforms.chargeDecay.value = 0.986;
    this.gpuCompute.compute();

    this.material.uniforms.heightmap.value = this.gpuCompute.getCurrentRenderTarget(this.heightmapVariable).texture;
    this.material.uniforms.time.value = this.elapsed;
    this.material.uniforms.dominance.value = this.dominance;
    this.material.uniforms.impulse.value = this.impulse;
    this.renderer.render(this.scene, this.camera);
    this.frame = window.requestAnimationFrame(this.render);
  };

  private enqueue(drop: FluidDrop): void {
    this.queue.push(drop);
    this.lastImpulse = performance.now();
    if (this.queue.length > MAX_QUEUE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE);
    }
  }

  private trackPrice(price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    if (this.priceLow === null || this.priceHigh === null) {
      this.priceLow = price * 0.999;
      this.priceHigh = price * 1.001;
      return;
    }
    this.priceLow += (price - this.priceLow) * (price < this.priceLow ? 0.5 : 0.0015);
    this.priceHigh += (price - this.priceHigh) * (price > this.priceHigh ? 0.5 : 0.0015);
  }

  private pricePosition(price: number): number {
    if (this.priceLow === null || this.priceHigh === null) return 0;
    const span = this.priceHigh - this.priceLow;
    if (span <= 0) return 0;
    return clamp((price - this.priceLow) / span, 0, 1) - 0.5;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(2, rect.width || window.innerWidth);
    const height = Math.max(2, rect.height || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.45);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);

    this.geomWidth = width;
    this.geomHeight = height;
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();

    const aspect = width / height;
    const nextWidth = aspect >= 1 ? LONG_AXIS : this.snapDimension(LONG_AXIS * aspect);
    const nextHeight = aspect >= 1 ? this.snapDimension(LONG_AXIS / aspect) : LONG_AXIS;
    const shouldRebuild = nextWidth !== this.fboWidth || nextHeight !== this.fboHeight || !this.heightmapVariable;
    this.fboWidth = nextWidth;
    this.fboHeight = nextHeight;

    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(width, height, Math.min(this.fboWidth, 256), Math.min(this.fboHeight, 256));
    this.mesh.updateMatrix();

    this.material.defines.FBO_WIDTH = this.fboWidth.toFixed(1);
    this.material.defines.FBO_HEIGHT = this.fboHeight.toFixed(1);
    this.material.uniforms.viewport.value.set(width, height);
    this.material.needsUpdate = true;

    if (shouldRebuild) this.buildCompute();
  }

  private snapDimension(value: number): number {
    return 2 ** Math.round(Math.log2(clamp(value, 128, LONG_AXIS)));
  }

  private buildCompute(): void {
    this.gpuCompute?.dispose?.();
    this.gpuCompute = new GPUComputationRenderer(this.fboWidth, this.fboHeight, this.renderer);
    if (!this.renderer.capabilities.isWebGL2) {
      this.gpuCompute.setDataType(THREE.HalfFloatType);
    }

    const initial = this.gpuCompute.createTexture();
    this.seedTexture(initial);
    this.heightmapVariable = this.gpuCompute.addVariable("heightmap", HeightmapFragment, initial);
    this.gpuCompute.setVariableDependencies(this.heightmapVariable, [this.heightmapVariable]);

    const material = this.heightmapVariable.material;
    material.uniforms.dropCount = { value: 0 };
    material.uniforms.dropPos = { value: this.dropPositions };
    material.uniforms.dropDirection = { value: this.dropDirections };
    material.uniforms.dropRadius = { value: this.dropRadii };
    material.uniforms.dropAmplitude = { value: this.dropAmplitudes };
    material.uniforms.dropCharge = { value: this.dropCharges };
    material.uniforms.viscosity = { value: 0.9915 };
    material.uniforms.chargeDecay = { value: 0.986 };
    material.defines.GEOM_WIDTH = this.geomWidth.toFixed(1);
    material.defines.GEOM_HEIGHT = this.geomHeight.toFixed(1);

    const error = this.gpuCompute.init();
    if (error) throw new Error(error);
  }

  private seedTexture(texture: THREE.DataTexture): void {
    const pixels = texture.image.data as Float32Array;
    let offset = 0;
    for (let y = 0; y < this.fboHeight; y += 1) {
      for (let x = 0; x < this.fboWidth; x += 1) {
        const u = x / this.fboWidth;
        const v = y / this.fboHeight;
        const envelope = Math.exp(-Math.pow((u - 0.5) * 1.45, 2) - Math.pow((v - 0.5) * 1.2, 2));
        const waves = Math.sin(u * 13.0 + v * 7.0) * 0.12 + Math.cos(u * 6.0 - v * 15.0) * 0.08;
        const height = waves * envelope;
        pixels[offset] = height;
        pixels[offset + 1] = height * 0.985;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 0;
        offset += 4;
      }
    }
  }
}
