export async function compressReceipt(file: File): Promise<{
  fileName: string;
  mimeType: string;
  dataUrl: string;
}> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Attach an image of the receipt");
  }
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  if (dataUrl.length > 900_000) {
    const smaller = canvas.toDataURL("image/jpeg", 0.5);
    if (smaller.length > 900_000) throw new Error("Receipt is too large. Try a smaller photo.");
    return { fileName: file.name.replace(/\.\w+$/, "") + ".jpg", mimeType: "image/jpeg", dataUrl: smaller };
  }
  return { fileName: file.name.replace(/\.\w+$/, "") + ".jpg", mimeType: "image/jpeg", dataUrl };
}
