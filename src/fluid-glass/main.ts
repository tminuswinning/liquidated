import { DemoFeed } from "../data/demoFeed";
import { HyperliquidClient } from "../data/hyperliquidClient";
import type { ConnectionStatus, Market, TradeEvent } from "../types";
import { IridescentFluidSimulation } from "./IridescentFluidSimulation";
import "./fluid-glass.css";

const canvas = document.getElementById("fluidCanvas");
const marketSelect = document.getElementById("marketSelect");
const statusText = document.getElementById("statusText");
const statusIndicator = document.getElementById("statusIndicator");
const pulseButton = document.getElementById("pulseButton");
const pauseButton = document.getElementById("pauseButton");

if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing fluid canvas");
if (!(marketSelect instanceof HTMLSelectElement)) throw new Error("Missing market selector");
if (!(statusText instanceof HTMLElement)) throw new Error("Missing status text");
if (!(statusIndicator instanceof HTMLElement)) throw new Error("Missing status indicator");
if (!(pulseButton instanceof HTMLButtonElement)) throw new Error("Missing pulse button");
if (!(pauseButton instanceof HTMLButtonElement)) throw new Error("Missing pause button");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const simulation = new IridescentFluidSimulation(canvas, { reducedMotion });
let market = marketSelect.value as Market;
let liveTradeAt = 0;
let demo: DemoFeed | null = null;
let paused = false;
let previousPointer: { x: number; y: number } | null = null;

function setStatus(status: ConnectionStatus): void {
  const labels: Record<ConnectionStatus, string> = {
    connecting: "Connecting",
    live: "Live flow",
    demo: "Demo flow",
    reconnecting: "Reconnecting",
    error: "Connection error",
  };
  // These elements are checked above, but TypeScript does not retain that
  // narrowing inside callbacks declared later in the module.
  statusText!.textContent = labels[status];
  statusIndicator!.dataset.state = status === "live" || status === "demo" ? "live" : status === "error" ? "error" : status;
}

function onTrade(trade: TradeEvent): void {
  if (trade.source === "hyperliquid") {
    liveTradeAt = Date.now();
    demo?.stop();
    demo = null;
    setStatus("live");
  }
  simulation.pushTrade(trade);
}

function startDemo(): void {
  if (demo) return;
  demo = new DemoFeed(market, { onTrade, onBbo: () => undefined });
  demo.start();
  setStatus("demo");
}

const live = new HyperliquidClient(market, {
  onTrade,
  onBbo: () => undefined,
  onAssetContext: () => undefined,
  onStatus: (status) => {
    setStatus(status);
    if (status === "error") startDemo();
  },
});

marketSelect.addEventListener("change", () => {
  market = marketSelect.value as Market;
  simulation.resetMarket();
  live.setMarket(market);
  demo?.setMarket(market);
  setStatus("connecting");
  liveTradeAt = 0;
});

canvas.addEventListener("pointermove", (event) => {
  if (event.isPrimary === false || reducedMotion) return;
  const rect = canvas.getBoundingClientRect();
  const current = { x: event.clientX, y: event.clientY };
  const previous = previousPointer ?? current;
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  previousPointer = current;
  if (Math.hypot(dx, dy) < 3) return;
  simulation.disturb((current.x - rect.left) / rect.width, (current.y - rect.top) / rect.height, dx, dy);
});

canvas.addEventListener("pointerleave", () => {
  previousPointer = null;
});

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  simulation.disturb((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, 1, -0.2);
});

pulseButton.addEventListener("click", () => {
  simulation.disturb(0.42 + Math.random() * 0.16, 0.4 + Math.random() * 0.18, Math.random() - 0.5, Math.random() - 0.5);
});

pauseButton.addEventListener("click", () => {
  paused = !paused;
  simulation.setPaused(paused);
  pauseButton.textContent = paused ? "Resume" : "Pause";
  pauseButton.setAttribute("aria-pressed", String(paused));
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden || paused) return;
  simulation.setPaused(false);
});

window.addEventListener("beforeunload", () => {
  live.disconnect();
  demo?.stop();
  simulation.dispose();
});

simulation.start();
simulation.disturb(0.36, 0.53, 1, -0.25);
window.setTimeout(() => simulation.disturb(0.64, 0.46, -1, 0.2), 420);
live.connect();

window.setTimeout(() => {
  if (Date.now() - liveTradeAt > 5_500) startDemo();
}, 6_000);
