import "server-only";

import path from "node:path";

import { Font } from "@react-pdf/renderer";

/**
 * Fonts for the generated documents.
 *
 * `next/font` does not apply here at all: that pipeline produces CSS for a
 * browser, and `@react-pdf/renderer` embeds glyph outlines into a PDF from a
 * file on disk. So the two Amiri cuts are committed to the repository under
 * `src/lib/pdf/fonts/` (SIL Open Font License, `OFL.txt` beside them) rather
 * than fetched — a document generator that reached out to a CDN at render time
 * would fail in exactly the environment that matters, a locked-down production
 * host, and would leak which tenant is printing what to a third party.
 *
 * Amiri covers Arabic AND Latin, which is why one family serves both languages
 * here while the app uses two. On a bilingual invoice the alternative is a
 * document whose two halves are set in different type, which reads as two
 * documents stapled together.
 *
 * `process.cwd()` rather than a bundler URL: the font is a runtime asset, and
 * Next traces files referenced this way into the standalone output. See
 * `outputFileTracingIncludes` in `next.config.ts`, which names them explicitly
 * because the path is built rather than imported and the tracer cannot see it.
 */

const FONT_DIRECTORY = path.join(process.cwd(), "src", "lib", "pdf", "fonts");

export const PDF_FONT_FAMILY = "Amiri";

/**
 * Registered ONCE per process.
 *
 * `Font.register` mutates a module-level registry inside the renderer, and
 * registering the same family twice per request leaks memory in a long-running
 * server and is simply wasted work. The guard is a module-scoped boolean rather
 * than a check against the renderer's internals, which are not public API.
 */
let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;

  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: path.join(FONT_DIRECTORY, "Amiri-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIRECTORY, "Amiri-Bold.ttf"), fontWeight: 700 },
    ],
  });

  /**
   * Turn OFF the renderer's hyphenation.
   *
   * Its default callback splits Latin words at guessed boundaries, which is
   * wrong for Arabic (words are not hyphenated) and wrong for the things this
   * document is mostly made of — invoice numbers, asset names, references. A
   * reference broken across two lines with a hyphen inserted is a reference
   * nobody can retype.
   */
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}
