// Client-side image compression — runs in the browser BEFORE upload so the
// big original never leaves the device (saves bandwidth + storage). Resizes
// to a sensible max edge and re-encodes. Photos → WebP (small, allowed by the
// storage policy for photo kinds). ID documents → JPEG, light compression, so
// text stays legible. PDFs / SVG / GIF and non-images pass through untouched.
//
// Never throws — on any failure it returns the original file, so a flaky
// canvas can't block an upload.

type Preset = { maxEdge: number; quality: number; mime: "image/webp" | "image/jpeg" } | null;

// Keyed by the upload "kind" string (see lib/storage.ts UploadKind). null = skip.
const PRESETS: Record<string, Preset> = {
  // Avatars — shown small, so 512px is plenty sharp.
  user_photo: { maxEdge: 512, quality: 0.82, mime: "image/webp" },
  rider_photo: { maxEdge: 512, quality: 0.82, mime: "image/webp" },
  // Subject photos — a bit larger for detail.
  horse_photo: { maxEdge: 1280, quality: 0.82, mime: "image/webp" },
  asset_photo: { maxEdge: 1280, quality: 0.82, mime: "image/webp" },
  // ID documents / invoices — keep legible. Light resize, high quality, JPEG
  // (their storage policy doesn't allow webp). PDFs skip this entirely.
  rider_aadhaar: { maxEdge: 2200, quality: 0.9, mime: "image/jpeg" },
  rider_indemnity: { maxEdge: 2200, quality: 0.9, mime: "image/jpeg" },
  staff_aadhaar: { maxEdge: 2200, quality: 0.9, mime: "image/jpeg" },
  staff_police_verification: { maxEdge: 2200, quality: 0.9, mime: "image/jpeg" },
  expense_invoice: { maxEdge: 2200, quality: 0.9, mime: "image/jpeg" },
  generic: { maxEdge: 1600, quality: 0.85, mime: "image/jpeg" },
};

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap honours EXIF orientation with imageOrientation:"from-image"
  // (so portrait phone photos don't come out sideways). Fall back to <img>.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as any);
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dims(w: number, h: number, maxEdge: number): { w: number; h: number } {
  if (w <= maxEdge && h <= maxEdge) return { w, h };
  const scale = maxEdge / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export async function compressForKind(file: File, kind: string): Promise<File> {
  const preset = PRESETS[kind];
  if (!preset) return file;
  // Only raster photos. Skip PDFs, SVG (vector), GIF (animation), and anything odd.
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;

  try {
    const src = await loadBitmap(file);
    const sw = (src as any).width as number;
    const sh = (src as any).height as number;
    if (!sw || !sh) return file;
    const { w, h } = dims(sw, sh, preset.maxEdge);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // White matte so transparent PNGs don't get a black background once flattened.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
    if ("close" in src && typeof (src as ImageBitmap).close === "function") (src as ImageBitmap).close();

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, preset.mime, preset.quality));
    if (!blob) return file;
    // Don't bother if compression didn't actually help (already-tiny files).
    if (blob.size >= file.size) return file;

    const ext = preset.mime === "image/webp" ? "webp" : "jpg";
    const base = file.name.replace(/\.[^.]+$/, "") || "upload";
    return new File([blob], `${base}.${ext}`, { type: preset.mime });
  } catch {
    return file;
  }
}
