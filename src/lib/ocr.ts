/**
 * OCR struk di browser dengan Tesseract.js (gratis, foto tidak dikirim ke server Saku).
 * Library & data bahasa dimuat saat dipakai saja; worker ditutup setelah selesai.
 */
export async function bacaStruk(file: File, onProgress: (p: number) => void): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["ind", "eng"], undefined, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
