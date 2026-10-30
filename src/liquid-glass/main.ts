import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HyperliquidClient } from "../data/hyperliquidClient";
import type { TradeEvent } from "../types";

const mount = document.querySelector<HTMLElement>("#glass-scene");
const status = document.querySelector<HTMLElement>("#stream-status");
const kicker = document.querySelector<HTMLElement>(".glass-kicker");
const disturb = document.querySelector<HTMLButtonElement>("#disturb-field");

if (!mount) throw new Error("Missing glass scene mount");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 12.2);

const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environment, 0.035).texture;
environment.dispose();
pmrem.dispose();

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0xa7bbb7),
  metalness: 0.24,
  roughness: 0.045,
  transmission: 0.58,
  thickness: 2.6,
  ior: 1.42,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  iridescence: 1,
  iridescenceIOR: 1.72,
  iridescenceThicknessRange: [120, 620],
  attenuationColor: new THREE.Color(0x1c3736),
  attenuationDistance: 2.4,
  emissive: new THREE.Color(0x06110f),
  emissiveIntensity: .22,
  transparent: false,
  opacity: 1,
  side: THREE.DoubleSide,
});

const points = [
  new THREE.Vector3(-3.2, .15, .05),
  new THREE.Vector3(-2.15, 1.05, .4),
  new THREE.Vector3(-.35, .82, -.36),
  new THREE.Vector3(1.65, 1.38, .18),
  new THREE.Vector3(3.05, .5, -.08),
  new THREE.Vector3(2.35, -1.05, .36),
  new THREE.Vector3(.4, -.72, -.42),
  new THREE.Vector3(-1.65, -1.42, .22),
];
const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", .5);
const geometry = new THREE.TubeGeometry(curve, 320, .56, 56, true);
const mainGlass = new THREE.Mesh(geometry, glassMaterial);
mainGlass.scale.set(1.08, 1, .82);

const glassGroup = new THREE.Group();
glassGroup.add(mainGlass);
scene.add(glassGroup);

const dropletGeometry = new THREE.IcosahedronGeometry(.56, 7);
const droplets = [
  { position: new THREE.Vector3(3.75, 2.35, -.6), scale: new THREE.Vector3(.55, 1.45, .72), speed: .38 },
  { position: new THREE.Vector3(-3.9, -2.1, .35), scale: new THREE.Vector3(.42, .9, .5), speed: -.31 },
  { position: new THREE.Vector3(4.15, -1.85, -.2), scale: new THREE.Vector3(.32, .62, .38), speed: .46 },
].map((entry) => {
  const mesh = new THREE.Mesh(dropletGeometry, glassMaterial);
  mesh.position.copy(entry.position);
  mesh.scale.copy(entry.scale);
  glassGroup.add(mesh);
  return { ...entry, mesh };
});

const rimLight = new THREE.DirectionalLight(0xd9fff5, 6.5);
rimLight.position.set(-4, 5, 6);
scene.add(rimLight);
const warmLight = new THREE.DirectionalLight(0xff8d58, 4.8);
warmLight.position.set(5, -2, 5);
scene.add(warmLight);
const coolLight = new THREE.PointLight(0x5deac0, 32, 18, 2);
coolLight.position.set(3.2, 2.8, 4.5);
scene.add(coolLight);

const pointerTarget = new THREE.Vector2();
const pointerCurrent = new THREE.Vector2();
let pulse = 0;
let pressure = 0;
let lastTradeAt = 0;

function ingestTrade(trade: TradeEvent): void {
  const weight = THREE.MathUtils.clamp(Math.log10(Math.max(1_000, trade.size)) / 6, .28, 1);
  const side = trade.side === "buy" ? 1 : -1;
  pulse = Math.min(1.2, pulse + weight * .2);
  pressure = THREE.MathUtils.clamp(pressure * .88 + side * weight * .18, -1, 1);
  lastTradeAt = Date.now();
}

const stream = new HyperliquidClient("BTC", {
  onTrade: ingestTrade,
  onBbo: () => undefined,
  onAssetContext: () => undefined,
  onStatus: (next) => {
    if (status) status.textContent = next === "live" ? "BTC public flow live" : next === "error" ? "Stream unavailable" : `${next} to BTC`;
    kicker?.setAttribute("data-state", next === "error" ? "error" : next);
  },
});
stream.connect();

window.addEventListener("pointermove", (event) => {
  pointerTarget.set((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1));
}, { passive: true });

disturb?.addEventListener("click", () => {
  pulse = 1.2;
  pressure = pressure >= 0 ? -.75 : .75;
});

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize, { passive: true });

const clock = new THREE.Clock();
function animate(): void {
  const elapsed = clock.getElapsedTime();
  const speed = reducedMotion.matches ? .08 : 1;
  pointerCurrent.lerp(pointerTarget, reducedMotion.matches ? .02 : .055);
  pulse *= .935;
  pressure *= .992;

  glassGroup.rotation.x = -.16 + pointerCurrent.y * .12;
  glassGroup.rotation.y = elapsed * .035 * speed + pointerCurrent.x * .2;
  glassGroup.rotation.z = Math.sin(elapsed * .16) * .035;
  glassGroup.position.x = window.innerWidth < 760 ? .7 : 1.35;
  glassGroup.position.y = window.innerWidth < 760 ? 1.0 : .68;
  const baseScale = window.innerWidth < 760 ? .72 : 1;
  const pulseScale = 1 + pulse * .035;
  glassGroup.scale.set(baseScale * pulseScale, baseScale * (1 - pulse * .018), baseScale * pulseScale);
  mainGlass.rotation.x = Math.sin(elapsed * .24 * speed) * .055 + pressure * .045;
  mainGlass.rotation.z = Math.cos(elapsed * .19 * speed) * .04;
  glassMaterial.iridescenceIOR = 1.62 + Math.abs(pressure) * .24;

  droplets.forEach(({ mesh, speed: orbitSpeed }, index) => {
    mesh.rotation.x = elapsed * orbitSpeed;
    mesh.rotation.y = elapsed * (orbitSpeed + .16);
    mesh.position.y += Math.sin(elapsed * .52 + index * 1.7) * .0007;
  });

  const activity = THREE.MathUtils.clamp(1 - (Date.now() - lastTradeAt) / 4500, 0, 1);
  warmLight.intensity = 4.2 + Math.max(0, -pressure) * 4.5 + activity * .8;
  coolLight.intensity = 28 + Math.max(0, pressure) * 26 + activity * 4;

  renderer.render(scene, camera);
  document.documentElement.classList.add("webgl-ready");
  window.requestAnimationFrame(animate);
}
animate();

window.addEventListener("pagehide", () => {
  stream.disconnect();
  renderer.dispose();
  geometry.dispose();
  dropletGeometry.dispose();
  glassMaterial.dispose();
}, { once: true });
