import { prepareZXingModule, readBarcodes, ZXING_WASM_VERSION } from "zxing-wasm/reader";

prepareZXingModule({ overrides: { locateFile: () => `/barcode-reader/zxing_reader.wasm?v=${ZXING_WASM_VERSION}` } });

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(event.data.file);
    const options = { formats: ["Code128" as const, "EAN13" as const, "EAN8" as const], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 200 };
    const found = new Map<string, { text: string; x: number; y: number }>();
    // Full-size image plus overlapping tiles recovers small labels in multi-product photographs.
    const tile = 1100;
    const regions = [{ x: 0, y: 0, width: bitmap.width, height: bitmap.height }];
    if (bitmap.width > tile || bitmap.height > tile) {
      for (let y = 0; y < bitmap.height; y += 850) for (let x = 0; x < bitmap.width; x += 850) {
        regions.push({ x, y, width: Math.min(tile, bitmap.width - x), height: Math.min(tile, bitmap.height - y) });
      }
    }
    for (let index = 0; index < regions.length; index++) {
      const region = regions[index];
      const canvas = new OffscreenCanvas(region.width, region.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("사진을 읽을 화면을 준비하지 못했습니다.");
      context.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
      const results = await readBarcodes(context.getImageData(0, 0, region.width, region.height), options);
      for (const result of results) {
        const text = result.text.trim();
        if (!result.isValid || !/^(?:[RS]\d{10,14}|\d{8,14})$/.test(text)) continue;
        if (!found.has(text)) found.set(text, { text, x: result.position.topLeft.x + region.x, y: result.position.topLeft.y + region.y });
      }
      self.postMessage({ progress: Math.round((index + 1) / regions.length * 100) });
    }
    self.postMessage({ barcodes: [...found.values()].sort((a, b) => a.y - b.y || a.x - b.x).map(item => item.text) });
  } catch {
    self.postMessage({ error: "사진을 읽지 못했습니다. JPG·PNG 사진인지 확인해 주세요." });
  } finally {
    bitmap?.close();
  }
};
