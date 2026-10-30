import type { CoreMarket, Market } from "../types";

export interface MarketConfig {
  market: Market;
  minPrintSize: number;
  largePrintSize: number;
  clusterSize: number;
  priceDecimals: number;
  basePrice: number;
}

export const MARKET_CONFIG: Record<CoreMarket, MarketConfig> = {
  BTC: {
    market: "BTC",
    minPrintSize: 150_000,
    largePrintSize: 750_000,
    clusterSize: 1_500_000,
    priceDecimals: 1,
    basePrice: 68_000,
  },
  ETH: {
    market: "ETH",
    minPrintSize: 75_000,
    largePrintSize: 350_000,
    clusterSize: 850_000,
    priceDecimals: 2,
    basePrice: 3_800,
  },
  SOL: {
    market: "SOL",
    minPrintSize: 35_000,
    largePrintSize: 150_000,
    clusterSize: 400_000,
    priceDecimals: 3,
    basePrice: 170,
  },
  HYPE: {
    market: "HYPE",
    minPrintSize: 20_000,
    largePrintSize: 90_000,
    clusterSize: 240_000,
    priceDecimals: 3,
    basePrice: 30,
  },
};

export const MARKETS = Object.keys(MARKET_CONFIG) as CoreMarket[];

export function isCoreMarket(market: Market): market is CoreMarket {
  return market in MARKET_CONFIG;
}

// ── Every Hyperliquid perp ─────────────────────────────────────────────────

const INFO_URL = "https://api.hyperliquid.xyz/info";
// Daily notional the BTC thresholds were tuned against; other markets scale
// their print thresholds by the square root of their volume relative to it.
const REFERENCE_VOLUME = 5_000_000_000;

export interface PerpMarket {
  /** API coin name, e.g. "BTC" or "xyz:TSLA". */
  name: string;
  /** Display symbol without the dex prefix. */
  symbol: string;
  /** HIP-3 dex name, empty for the main Hyperliquid dex. */
  dex: string;
  dayVolume: number;
  markPrice: number;
  szDecimals: number;
}

let perpMarkets: PerpMarket[] = [];
const perpByName = new Map<string, PerpMarket>();
const derivedConfig = new Map<string, MarketConfig>();

export function listPerpMarkets(): PerpMarket[] {
  return perpMarkets;
}

export function getPerpMarket(market: Market): PerpMarket | undefined {
  return perpByName.get(market);
}

export function getMarketConfig(market: Market): MarketConfig {
  if (isCoreMarket(market)) return MARKET_CONFIG[market];
  let config = derivedConfig.get(market);
  if (!config) {
    config = deriveMarketConfig(market, perpByName.get(market));
    // Only cache real data; a placeholder is re-derived once the list loads.
    if (perpByName.has(market)) derivedConfig.set(market, config);
  }
  return config;
}

function deriveMarketConfig(market: Market, perp: PerpMarket | undefined): MarketConfig {
  const volume = Math.max(perp?.dayVolume ?? 0, 50_000);
  const largePrintSize = Math.min(750_000, Math.max(5_000, 750_000 * Math.sqrt(volume / REFERENCE_VOLUME)));
  const price = perp?.markPrice ?? 1;
  return {
    market,
    minPrintSize: largePrintSize / 5,
    largePrintSize,
    clusterSize: largePrintSize * 2,
    priceDecimals: perpPriceDecimals(price, perp?.szDecimals ?? 2),
    basePrice: price,
  };
}

// Hyperliquid perp prices carry at most 5 significant figures and at most
// (6 - szDecimals) decimals.
export function perpPriceDecimals(price: number, szDecimals: number): number {
  if (!(price > 0)) return 2;
  const sigFigDecimals = 4 - Math.floor(Math.log10(price));
  return Math.max(0, Math.min(6 - szDecimals, sigFigDecimals));
}

interface MetaResponse {
  universe: { name: string; szDecimals: number; isDelisted?: boolean }[];
}

interface AssetCtxResponse {
  dayNtlVlm?: string;
  markPx?: string | null;
}

async function postInfo<T>(body: object): Promise<T> {
  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Hyperliquid info ${response.status}`);
  return (await response.json()) as T;
}

async function loadDex(dex: string): Promise<PerpMarket[]> {
  const [meta, contexts] = await postInfo<[MetaResponse, AssetCtxResponse[]]>(
    dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" },
  );
  return meta.universe.flatMap((asset, index) => {
    const context = contexts[index];
    const markPrice = Number(context?.markPx);
    if (asset.isDelisted || !(markPrice > 0)) return [];
    return {
      name: asset.name,
      symbol: dex && asset.name.startsWith(`${dex}:`) ? asset.name.slice(dex.length + 1) : asset.name,
      dex,
      dayVolume: Number(context?.dayNtlVlm) || 0,
      markPrice,
      szDecimals: asset.szDecimals,
    };
  });
}

/** Load every active perp across the main dex and all HIP-3 dexes. */
export async function loadPerpMarkets(): Promise<PerpMarket[]> {
  const dexes = await postInfo<({ name: string } | null)[]>({ type: "perpDexs" }).catch(() => [null]);
  const names = dexes.map((dex) => dex?.name ?? "");
  const results = await Promise.allSettled(names.map(loadDex));
  const markets = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (markets.length === 0) throw new Error("No Hyperliquid perps loaded");

  markets.sort((a, b) => b.dayVolume - a.dayVolume);
  perpMarkets = markets;
  perpByName.clear();
  derivedConfig.clear();
  for (const market of markets) perpByName.set(market.name, market);
  return markets;
}
