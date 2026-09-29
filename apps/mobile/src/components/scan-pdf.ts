import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/**
 * A one-page PDF around one JPEG, for Scan mode's "Save as PDF".
 *
 * Web builds the same page with pdf-lib: US Letter, 24pt margins, the image
 * scaled to fit and centred. The phone has no PDF library installed, and a
 * single JPEG page does not need one: PDF can carry JPEG bytes as they are
 * (`/DCTDecode`), so the whole document is five small objects around the
 * photo's own file. Nothing is re-encoded, so nothing is lost.
 *
 * Returns base64, which is what `fileGeneratedPdf` files into Documents.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 24;

/**
 * Pixel size and channel count from a JPEG's start-of-frame marker.
 *
 * Read from the bytes rather than trusted from the caller, because the PDF
 * has to describe the file it embeds exactly or viewers draw it skewed.
 */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; channels: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Not a JPEG");
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const channels = bytes[i + 9];
      return { width, height, channels };
    }
    i += 2 + length;
  }
  throw new Error("Could not read the JPEG size");
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 without `Buffer` (Hermes has none) and without `btoa` on a huge string. */
export function toBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  let chunk = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    chunk +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") +
      (i + 2 < bytes.length ? B64[n & 63] : "=");
    if (chunk.length >= 8192) {
      out.push(chunk);
      chunk = "";
    }
  }
  out.push(chunk);
  return out.join("");
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** Build the PDF bytes for one JPEG page. Exported for tests. */
export function jpegToPdfBytes(jpeg: Uint8Array): Uint8Array {
  const { width, height, channels } = jpegInfo(jpeg);
  const colorSpace = channels === 1 ? "/DeviceGray" : channels === 4 ? "/DeviceCMYK" : "/DeviceRGB";

  const scale = Math.min((PAGE_W - MARGIN * 2) / width, (PAGE_H - MARGIN * 2) / height);
  const w = width * scale;
  const h = height * scale;
  const x = (PAGE_W - w) / 2;
  const y = (PAGE_H - h) / 2;
  const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;

  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array) => {
    parts.push(chunk);
    length += chunk.length;
  };
  const object = (n: number, body: string) => {
    offsets[n] = length;
    push(ascii(`${n} 0 obj\n${body}\nendobj\n`));
  };

  push(ascii("%PDF-1.4\n%âãÏÓ\n"));
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  );
  offsets[4] = length;
  push(
    ascii(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    ),
  );
  push(jpeg);
  push(ascii("\nendstream\nendobj\n"));
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = length;
  let table = "xref\n0 6\n0000000000 65535 f \n";
  for (let n = 1; n <= 5; n += 1) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(ascii(`${table}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));

  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Read a photo from disk and return the one-page PDF as base64.
 *
 * Re-encoded to JPEG first. A PDF ignores EXIF, so a camera file that relies
 * on an orientation tag would come out sideways; the manipulator bakes the
 * rotation into the pixels, and turns a HEIC from the library into a JPEG.
 */
export async function jpegFileToPdfBase64(uri: string): Promise<string> {
  const rendered = await ImageManipulator.manipulate(uri).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  const jpeg = new Uint8Array(await new File(saved.uri).arrayBuffer());
  return toBase64(jpegToPdfBytes(jpeg));
}
