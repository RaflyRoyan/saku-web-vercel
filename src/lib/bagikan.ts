/**
 * Bagikan gambar lewat share sheet HP (pilih WhatsApp → kontak). Browser tanpa dukungan share file → unduh PNG.
 * Dibatalkan pengguna (AbortError) dianggap selesai.
 */
export async function bagikanGambar(blob: Blob, namaFile: string, teks: string): Promise<"share" | "unduh"> {
  const file = new File([blob], namaFile, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: teks });
      return "share";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "share";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = namaFile;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "unduh";
}
