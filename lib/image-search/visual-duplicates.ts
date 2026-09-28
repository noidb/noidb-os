export type VisualCandidate = { id: string; image: Blob; width: number; height: number; detail: boolean };

type Fingerprint = { id: string; bits: bigint; contrast: number; ratio: number };

async function fingerprint(candidate: VisualCandidate): Promise<Fingerprint | null> {
  if (candidate.detail || !candidate.width || !candidate.height) return null;
  const bitmap = await createImageBitmap(candidate.image, { resizeWidth: 17, resizeHeight: 16, resizeQuality: "low" }).catch(() => null);
  if (!bitmap) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 17; canvas.height = 16;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, 17, 16);
    const pixels = context.getImageData(0, 0, 17, 16).data;
    const gray: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) gray.push((pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000);
    const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length;
    const contrast = gray.reduce((sum, value) => sum + Math.abs(value - mean), 0) / gray.length;
    let bits = BigInt(0);
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) bits = (bits << BigInt(1)) | BigInt(gray[y * 17 + x] > gray[y * 17 + x + 1] ? 1 : 0);
    return { id: candidate.id, bits, contrast, ratio: candidate.width / candidate.height };
  } finally { bitmap.close(); }
}

function difference(a: bigint, b: bigint): number {
  let value = a ^ b;
  let count = 0;
  while (value) { value &= value - BigInt(1); count += 1; }
  return count;
}

/** 보수적인 시각적 묶음이다. 원본 파일은 모두 남기고 화면에서만 접는다. */
export async function groupVisuallyIdentical(candidates: VisualCandidate[]): Promise<Record<string, string>> {
  const prints: Fingerprint[] = [];
  for (const candidate of candidates) {
    const result = await fingerprint(candidate);
    if (result) prints.push(result);
  }
  const groups: Record<string, string> = {};
  for (let i = 0; i < prints.length; i += 1) {
    const current = prints[i];
    if (current.contrast < 8) continue;
    for (let j = 0; j < i; j += 1) {
      const previous = prints[j];
      if (previous.contrast < 8 || Math.abs(current.ratio - previous.ratio) > 0.03 || difference(current.bits, previous.bits) > 6) continue;
      const group = groups[previous.id] || `visual:${previous.id}`;
      groups[previous.id] = group;
      groups[current.id] = group;
      break;
    }
  }
  return groups;
}
