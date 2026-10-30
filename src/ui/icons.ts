import {
  ArrowRight,
  ArrowUpRight,
  Info,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Waves,
  createIcons,
} from "lucide";

// Markup opts in with <i data-lucide="name">. Only the icons listed here end
// up in the bundle, so add new ones explicitly.
const ICONS = { ArrowRight, ArrowUpRight, Info, LoaderCircle, Search, SlidersHorizontal, Volume2, VolumeX, Waves };

export function renderIcons(root: Element | Document = document): void {
  createIcons({
    icons: ICONS,
    root,
    attrs: { "stroke-width": 1.75, width: 16, height: 16, "aria-hidden": "true" },
  });
}
