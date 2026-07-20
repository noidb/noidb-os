function loadSourceImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

/**
 * 쿠팡 등록용 이미지 규격으로 변환합니다.
 * 원본 비율을 유지하고 잘라내거나 찌그러뜨리지 않으며, 남는 공간은 흰색으로 채웁니다.
 * 1000px JPEG는 최악의 경우에도 20MB 제한보다 충분히 작습니다.
 */
export async function normalizeCoupangImage(dataUrl: string, size = 1000) {
  const image = await loadSourceImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지 변환 캔버스를 만들 수 없습니다.");

  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, size, size);
  const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const x = Math.round((size - width) / 2);
  const y = Math.round((size - height) / 2);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);

  return canvas.toDataURL("image/jpeg", 0.94);
}
