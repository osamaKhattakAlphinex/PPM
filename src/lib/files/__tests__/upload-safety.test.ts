import { describe, expect, it } from "vitest";

import {
  ALLOWED_UPLOAD_TYPES,
  extensionFor,
  isAllowedType,
  MAX_UPLOAD_BYTES,
  safeDisplayName,
  sniffType,
  storageKeyFor,
  stripJpegMetadata,
} from "@/lib/domain/files";

/**
 * The four checks that make an upload safe, tested one by one.
 *
 * Each corresponds to a specific way this feature would otherwise go wrong:
 *
 *  1. **Sniffing** — a client's `Content-Type` is a claim, and believing it is
 *     how a script arrives labelled `image/png`.
 *  2. **The allow-list** — SVG is an image and also a document that can carry
 *     script; serving one from the app's origin would be stored XSS.
 *  3. **The filename** — an uploaded name reaches a `Content-Disposition`
 *     header and a rendered page, so control characters and quotes have to go.
 *  4. **EXIF** — a phone writes the coordinates of a customer's plant room into
 *     every photograph, and those must not travel with the file.
 *
 * Pure: no database, no storage, no session.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const bytes = (...values: number[]) => Uint8Array.from(values);

/** A minimal but structurally valid JPEG: SOI, a segment, SOS, data, EOI. */
function jpegWith(segments: number[][]): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, // SOI
    ...segments.flat(),
    0xff, 0xda, 0x00, 0x03, 0x00, // SOS with a 3-byte header
    0x11, 0x22, 0x33, // "image data"
    0xff, 0xd9, // EOI
  ]);
}

/** An APPn segment: marker, 2-byte length, payload. */
function appSegment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

// ---------------------------------------------------------------------------

describe("sniffType — what the file actually is", () => {
  it("recognises each allowed type from its magic bytes", () => {
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf");

    // RIFF....WEBP
    const webp = bytes(
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    );
    expect(sniffType(webp)).toBe("image/webp");

    // ....ftypheic
    const heic = bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
    expect(sniffType(heic)).toBe("image/heic");
  });

  /**
   * The attack the sniffing exists for: a file whose declared type is a lie.
   * `sniffType` reads the bytes, so an HTML document is an HTML document
   * whatever the multipart part called it.
   */
  it("refuses a script dressed as an image", () => {
    const html = new TextEncoder().encode("<svg onload=alert(1)></svg>");
    expect(sniffType(html)).toBeNull();

    const php = new TextEncoder().encode("<?php system($_GET['c']); ?>");
    expect(sniffType(php)).toBeNull();
  });

  /** RIFF alone is a WAV or an AVI, not an image. */
  it("refuses a RIFF container that is not WEBP", () => {
    const wav = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45);
    expect(sniffType(wav)).toBeNull();
  });

  it("refuses an empty or truncated file", () => {
    expect(sniffType(bytes())).toBeNull();
    expect(sniffType(bytes(0xff))).toBeNull();
    expect(sniffType(bytes(0x89, 0x50))).toBeNull();
  });
});

describe("the allow-list", () => {
  it("permits exactly the five documented types", () => {
    expect(Object.keys(ALLOWED_UPLOAD_TYPES).sort()).toEqual([
      "application/pdf",
      "image/heic",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  /** SVG is an image AND a scriptable document. It stays out. */
  it("refuses SVG, HTML and everything else", () => {
    for (const type of [
      "image/svg+xml",
      "text/html",
      "application/javascript",
      "application/x-httpd-php",
      "application/zip",
      "",
    ]) {
      expect(isAllowedType(type), `${type} was allowed`).toBe(false);
    }
  });

  it("caps uploads at ten megabytes", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("safeDisplayName", () => {
  /**
   * The name is reduced to its BASENAME first, so a path is not sanitised into
   * a flattened path — it simply stops being a path. `../../etc/passwd` becomes
   * `passwd`, which is a filename and nothing more.
   */
  it("reduces a path to its last segment", () => {
    expect(safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(safeDisplayName("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
    expect(safeDisplayName("/var/log/syslog")).toBe("syslog");
  });

  /**
   * The name reaches a `Content-Disposition` header. A quote would close the
   * filename parameter and a newline would begin a second header.
   */
  it("strips what would break out of a header", () => {
    expect(safeDisplayName('photo".jpg')).toBe("photo.jpg");
    expect(safeDisplayName("photo\r\nX-Injected: 1.jpg")).toBe("photoX-Injected: 1.jpg");
    // No slash in this one, so the basename step leaves it whole and the
    // character filter is what does the work.
    expect(safeDisplayName("photo`;rm -rf`.jpg")).toBe("photorm -rf.jpg");
  });

  it("refuses to produce a hidden file", () => {
    expect(safeDisplayName(".bashrc").startsWith(".")).toBe(false);
    expect(safeDisplayName("...")).toBe("file");
  });

  it("never returns an empty name", () => {
    expect(safeDisplayName("")).toBe("file");
    expect(safeDisplayName("///")).toBe("file");
  });

  it("caps the length", () => {
    expect(safeDisplayName("a".repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it("leaves an ordinary name alone", () => {
    expect(safeDisplayName("chiller-2 nameplate.jpg")).toBe("chiller-2 nameplate.jpg");
  });
});

describe("storageKeyFor", () => {
  const ORG = "0123456789abcdef01234567";

  it("namespaces the key by tenant", () => {
    const key = storageKeyFor(ORG, "ASSET", "abc-123", "image/jpeg");
    expect(key).toBe(`org/${ORG}/asset/abc-123.jpg`);
  });

  /**
   * The uploaded name contributes nothing to the key, so there is no traversal
   * to defend against and no collision between two people uploading photo.jpg.
   */
  it("takes nothing from the uploaded filename", () => {
    const key = storageKeyFor(ORG, "WORK_ORDER", "generated-name", "application/pdf");
    expect(key).not.toContain("photo");
    expect(key.endsWith(".pdf")).toBe(true);
  });

  it("uses the extension for the sniffed type", () => {
    expect(extensionFor("image/webp")).toBe("webp");
    // Anything unknown would be stored as `.bin` rather than as its claim — but
    // the route refuses unknown types before it gets here.
    expect(extensionFor("application/x-evil")).toBe("bin");
  });
});

describe("stripJpegMetadata", () => {
  it("removes an EXIF (APP1) segment", () => {
    // "Exif\0\0" plus a byte, inside an APP1 segment.
    const exif = appSegment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x2a]);
    const withExif = jpegWith([exif]);
    const stripped = stripJpegMetadata(withExif);

    expect(stripped.length).toBeLessThan(withExif.length);

    // The literal "Exif" marker is gone.
    const text = new TextDecoder("latin1").decode(stripped);
    expect(text).not.toContain("Exif");
  });

  it("removes a JFIF (APP0) segment and a comment", () => {
    const app0 = appSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00]);
    const comment = appSegment(0xfe, [0x68, 0x69]);
    const stripped = stripJpegMetadata(jpegWith([app0, comment]));

    const text = new TextDecoder("latin1").decode(stripped);
    expect(text).not.toContain("JFIF");
  });

  /** The image itself must survive: SOI, SOS and the entropy data. */
  it("keeps the image data intact", () => {
    const stripped = stripJpegMetadata(
      jpegWith([appSegment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00])]),
    );

    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    // The scan data and the end marker are still at the tail.
    expect(Array.from(stripped.slice(-5))).toEqual([0x11, 0x22, 0x33, 0xff, 0xd9]);
  });

  /**
   * A stripper that corrupts a photograph is worse than one that occasionally
   * leaves metadata in, so anything it does not understand comes back
   * unchanged.
   */
  it("returns non-JPEG input untouched", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);
    expect(stripJpegMetadata(png)).toEqual(png);

    const nonsense = bytes(1, 2, 3, 4);
    expect(stripJpegMetadata(nonsense)).toEqual(nonsense);
  });

  it("returns a malformed JPEG untouched rather than truncating it", () => {
    // A segment claiming to be longer than the file.
    const broken = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00]);
    expect(stripJpegMetadata(broken)).toEqual(broken);
  });
});
