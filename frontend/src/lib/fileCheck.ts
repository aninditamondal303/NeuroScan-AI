// Client-side pre-checks. They give fast feedback; the backend repeats every
// check and is the authority.

import type { Problem } from "../api/client.ts";

export type SniffedFormat = "JPEG" | "PNG" | "WEBP" | "DICOM" | "NIFTI" | "GZIP" | "OTHER_IMAGE" | "UNKNOWN";

export const ACCEPT_ATTRIBUTE = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MIN_SIDE = 64;
export const DEFAULT_MAX_SIDE = 8192;

export function sniffBytes(bytes: Uint8Array): SniffedFormat {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPEG";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return "PNG";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "WEBP";
  if (bytes.length >= 132 && ascii(128, 132) === "DICM") return "DICOM";
  if (bytes.length >= 348 && (ascii(344, 347) === "n+1" || ascii(344, 347) === "ni1") && bytes[347] === 0) return "NIFTI";
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return "GZIP";
  if (ascii(0, 2) === "BM" || ascii(0, 3) === "GIF" || ascii(0, 4) === "II*\0" || ascii(0, 4) === "MM\0*") return "OTHER_IMAGE";
  return "UNKNOWN";
}

const problem = (code: string, message: string, hint?: string): Problem => ({ kind: "http", code, message, hint });

export function checkHeader(format: SniffedFormat, size: number, maxBytes: number): Problem | null {
  if (size === 0) return problem("empty_file", "The selected file is empty.", "Choose an image file.");
  if (size > maxBytes) {
    return problem("file_too_large", `The file is ${formatBytesMb(size)}; the limit is ${formatBytesMb(maxBytes)}.`, "Export the slice at a smaller size.");
  }
  switch (format) {
    case "JPEG":
    case "PNG":
    case "WEBP":
      return null;
    case "DICOM":
    case "NIFTI":
    case "GZIP":
      return problem(
        "volumetric_format_not_supported",
        "DICOM and NIfTI files are not supported. The model analyses single 2D slices.",
        "Export one slice from your viewer as PNG or JPEG and upload that image.",
      );
    case "OTHER_IMAGE":
      return problem("unsupported_format", "This image format is not supported.", "Convert the slice to PNG, JPEG or WebP.");
    default:
      return problem("unrecognised_file", "This file is not a PNG, JPEG or WebP image.", "Renaming a file does not change its format.");
  }
}

export function checkDimensions(width: number, height: number, minSide: number, maxSide: number): Problem | null {
  if (Math.min(width, height) < minSide) {
    return problem("image_too_small", `The image is ${width} × ${height} pixels; at least ${minSide} pixels per side is needed.`, "Export the slice at a higher resolution.");
  }
  if (Math.max(width, height) > maxSide) {
    return problem("dimensions_too_large", `The image is ${width} × ${height} pixels, above the ${maxSide}-pixel limit.`, "Export a smaller copy of the slice.");
  }
  return null;
}

function formatBytesMb(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;
}
