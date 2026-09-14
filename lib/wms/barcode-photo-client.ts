function readBarcodeLines(file: File, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("사진 읽기를 중단했습니다.", "AbortError")); return; }
    const worker = new Worker(new URL("./barcode-photo.worker.ts", import.meta.url));
    const finish = () => { clearTimeout(timeout); worker.terminate(); signal?.removeEventListener("abort", abort); };
    const abort = () => { finish(); reject(new DOMException("사진 읽기를 중단했습니다.", "AbortError")); };
    const timeout = setTimeout(() => { finish(); reject(new Error("사진 분석 시간이 길어졌습니다. 여러 상품 사진을 나누어 넣어 주세요.")); }, 60_000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ progress?: number; barcodes?: string[]; error?: string }>) => {
      if (typeof event.data.progress === "number") onProgress(event.data.progress);
      if (event.data.barcodes) { finish(); resolve(event.data.barcodes); }
      if (event.data.error) { finish(); reject(new Error(event.data.error)); }
    };
    worker.onerror = () => { finish(); reject(new Error("사진 판독기를 불러오지 못했습니다. 새로고침 후 다시 넣어 주세요.")); };
    worker.postMessage({ file });
  });
}

/** Exact printed identifiers only. Do not invent missing digits or use fuzzy substitutions. */
export function extractPrintedBarcodes(text: string): string[] {
  return [...new Set(text.match(/(?<![A-Z0-9])[RS]\d{12}(?!\d)/g) || [])];
}

function confidentPrintedBarcodes(data: import("tesseract.js").Page): string[] {
  return [...new Set((data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line =>
    line.words.filter(word => word.confidence >= 60).flatMap(word => extractPrintedBarcodes(word.text))
  ))))];
}

function normalisePhoto(bitmap: ImageBitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("사진을 분석할 화면을 준비하지 못했습니다.");
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const grey = Math.round(pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = grey; pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function rotatedPhoto(source: HTMLCanvasElement, degrees: number) {
  if (!degrees) return source;
  const radians = degrees * Math.PI / 180;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(Math.abs(source.width * Math.cos(radians)) + Math.abs(source.height * Math.sin(radians)));
  canvas.height = Math.ceil(Math.abs(source.height * Math.cos(radians)) + Math.abs(source.width * Math.sin(radians)));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2); context.rotate(radians);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

export async function readPhotoBarcodes(file: File, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<{ barcodes: string[]; warning?: string }> {
  const found = new Set<string>();
  let warning: string | undefined;
  try { (await readBarcodeLines(file, percent => onProgress(Math.round(percent * .15)), signal)).forEach(code => found.add(code)); }
  catch { warning = "바코드 선 판독 실패 · 인쇄된 숫자로 확인"; }
  if (signal?.aborted) throw new DOMException("사진 읽기를 중단했습니다.", "AbortError");
  const { createWorker, PSM } = await import("tesseract.js");
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let bitmap: ImageBitmap | undefined;
  let normalised: HTMLCanvasElement | undefined;
  let pass = 0;
  let passCount = 3;
  let timedOut = false;
  let rejectDeadline: (reason: Error) => void = () => {};
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const abort = () => { timedOut = true; void worker?.terminate(); rejectDeadline(new DOMException("사진 읽기를 중단했습니다.", "AbortError")); };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(() => { timedOut = true; void worker?.terminate(); rejectDeadline(new Error("사진 숫자 분석 시간이 길어졌습니다. 가까이 찍은 사진을 추가해 주세요.")); }, 240_000);
  const recognize = async () => {
    // All engine and language files are self-hosted; the user's image never leaves this device.
    worker = await createWorker("eng", 1, {
      workerPath: "/barcode-reader/ocr/worker.min.js", corePath: "/barcode-reader/ocr/core", langPath: "/barcode-reader/ocr/lang", gzip: true,
      logger: event => onProgress(Math.min(99, 15 + Math.round((pass + (event.status === "recognizing text" ? event.progress : 0)) / passCount * 84))),
    });
    if (timedOut) { await worker.terminate(); return; }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: "R0123456789", preserve_interword_spaces: "1", user_defined_dpi: "300" });
    bitmap = await createImageBitmap(file);
    normalised = normalisePhoto(bitmap); bitmap.close(); bitmap = undefined;
    const tiled = normalised.width > 1600 || normalised.height > 1600;
    passCount = tiled ? 15 : 3;
    // Small opposite rotations recover skewed labels in multi-product photos without guessing digits.
    for (const angle of [0, 4, -4]) {
      const canvas = rotatedPhoto(normalised, angle);
      try {
        const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
        confidentPrintedBarcodes(result.data).forEach(code => found.add(code));
      } finally { if (canvas !== normalised) { canvas.width = 1; canvas.height = 1; } }
      pass++;
    }
    if (tiled) {
      // Overlap retains labels on section boundaries. Do not depend on a specific product count/layout.
      const columns = 3, rows = 4;
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const left = Math.max(0, Math.floor((column - .12) * normalised.width / columns));
        const top = Math.max(0, Math.floor((row - .12) * normalised.height / rows));
        const right = Math.min(normalised.width, Math.ceil((column + 1.12) * normalised.width / columns));
        const bottom = Math.min(normalised.height, Math.ceil((row + 1.12) * normalised.height / rows));
        const canvas = document.createElement("canvas"); canvas.width = right - left; canvas.height = bottom - top;
        canvas.getContext("2d")!.drawImage(normalised, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        try {
          const result = await worker.recognize(canvas, { rotateAuto: true }, { text: true, blocks: true });
          confidentPrintedBarcodes(result.data).forEach(code => found.add(code));
        } finally { canvas.width = 1; canvas.height = 1; }
        pass++;
      }
    }
    warning = undefined;
  };
  try { await Promise.race([recognize(), deadline]); }
  catch (cause) { warning = cause instanceof Error ? cause.message : "사진 숫자 분석 실패 · 인식한 개수를 확인해 주세요."; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); bitmap?.close(); if (normalised) { normalised.width = 1; normalised.height = 1; } await worker?.terminate(); }
  if (signal?.aborted) throw new DOMException("사진 읽기를 중단했습니다.", "AbortError");
  onProgress(100);
  return { barcodes: [...found], warning };
}
