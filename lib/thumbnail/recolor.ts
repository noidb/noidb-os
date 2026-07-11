/**
 * Pixel-based metal color shift. Preserves every product pixel position
 * (silhouette / structure identical). No generative redraw.
 */

import { loadImageElement } from "./compose";

export type ColorPreset = "로즈골드" | "골드" | "실버" | string;

type Hsl = { h: number; s: number; l: number };

function rgbToHsl(r: number, g: number, b: number): Hsl {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255),
  ];
}

function presetTarget(option: string): Hsl {
  const n = option.trim().toLowerCase();
  if (n.includes("로즈")) return { h: 18, s: 0.42, l: 0.62 };
  if (n.includes("실버") || n.includes("silver")) return { h: 210, s: 0.06, l: 0.72 };
  if (n.includes("블랙") || n.includes("black")) return { h: 0, s: 0.02, l: 0.22 };
  if (n.includes("골드") || n.includes("gold")) return { h: 42, s: 0.55, l: 0.58 };
  return { h: 40, s: 0.35, l: 0.55 };
}

function isNearWhite(r: number, g: number, b: number, a: number) {
  if (a < 12) return true;
  return r > 248 && g > 248 && b > 248;
}

function isLikelyMetalOrProduct(r: number, g: number, b: number) {
  const { s, l } = rgbToHsl(r, g, b);
  if (l < 0.08 || l > 0.96) return false;
  // Keep shadows / dark edges; recolor midtones preferentially
  return s > 0.04 || (l > 0.2 && l < 0.88);
}

/**
 * Apply metal color preset to non-background pixels only.
 * Output is always 1000×1000 JPG on white (caller should pass composed thumb).
 */
export async function applyMetalColorPreset(
  sourceDataUrl: string,
  option: string
): Promise<string> {
  const img = await loadImageElement(sourceDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const target = presetTarget(option);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (isNearWhite(r, g, b, a)) continue;
    if (!isLikelyMetalOrProduct(r, g, b)) continue;

    const src = rgbToHsl(r, g, b);
    // Keep luminance structure of original pixel so engraving / links stay
    const mix = Math.min(0.85, 0.35 + src.s * 0.5);
    const newH = target.h;
    const newS = target.s * (0.55 + src.s * 0.45);
    const newL = src.l * (1 - mix * 0.35) + target.l * mix * 0.35;
    const [nr, ng, nb] = hslToRgb(newH, Math.min(1, newS), Math.min(0.92, Math.max(0.08, newL)));
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }

  ctx.putImageData(imageData, 0, 0);

  if (canvas.width === 1000 && canvas.height === 1000) {
    return canvas.toDataURL("image/jpeg", 0.96);
  }

  const out = document.createElement("canvas");
  out.width = 1000;
  out.height = 1000;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("캔버스를 만들 수 없습니다.");
  octx.fillStyle = "#FFFFFF";
  octx.fillRect(0, 0, 1000, 1000);
  octx.drawImage(canvas, 0, 0, 1000, 1000);
  return out.toDataURL("image/jpeg", 0.96);
}
