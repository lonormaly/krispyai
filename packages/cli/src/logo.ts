// krispy logo <file> — remove a logo's background LOCALLY (no cloud, no key) and print a
// ready-to-paste transparent-PNG data URI. The tenant pastes it as `theme.avatar` in their
// tenant config (dashboard, or a `POST /api/tenant/config` body) — the widget renders the
// data URI in both the header and the launcher badge.
//
// Approach: corner chroma-key — the offline/keyless floor and the same pre-pass the cloud
// dashboard runs client-side before its AI segmentation. Sample the 4 corners; if they agree
// on one background color, flood-fill from the corners and punch that region to alpha. If the
// corners already look transparent (SVG / transparent PNG) we leave it alone; if they disagree
// (photographic / busy background) we keep the original unprocessed — background removal never
// blocks. sharp (already in the workspace, org-standard for image ops) does the decode/resize/
// encode for every accepted format; it's lazy-loaded so the CLI core stays dep-free at import.
//
// ponytail: corners-only chroma-key is the documented floor. Upgrade path is local ONNX
// segmentation (modnet via @xenova/transformers) the day it's worth a 100s-of-MB model
// download; until then this is dependency-light and handles logos-on-a-flat-background well.

const OUT_PX = 144; // 2× the 72px launcher icon — crisp on retina, still ~5–30KB as PNG
const TOLERANCE = 32; // max per-channel diff (0–255) for a pixel to count as "the background"
const CLEAR_ALPHA = 24; // corners below this alpha are already transparent → nothing to remove

// Two RGB pixels count as the same color if every channel is within TOLERANCE.
function near(buf: Buffer, a: number, b: number): boolean {
  return (
    Math.abs(buf[a]! - buf[b]!) <= TOLERANCE &&
    Math.abs(buf[a + 1]! - buf[b + 1]!) <= TOLERANCE &&
    Math.abs(buf[a + 2]! - buf[b + 2]!) <= TOLERANCE
  );
}

// Remove <file>'s background via corner chroma-key and return a `data:image/png;base64,…` URI.
// Exported for the test — asserts it emits a data URI for a fixture.
export async function logoToDataUri(file: string): Promise<string> {
  const { default: sharp } = await import("sharp");
  // Decode (png/jpg/webp/svg), fit inside OUT_PX without enlarging, force an alpha channel,
  // then read raw RGBA so we can edit pixels directly.
  const { data, info } = await sharp(file)
    .resize(OUT_PX, OUT_PX, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const px = Buffer.from(data); // mutable copy of the RGBA pixels
  const corners = [
    0, // top-left
    (width - 1) * 4, // top-right
    (height - 1) * width * 4, // bottom-left
    (height * width - 1) * 4, // bottom-right
  ];

  const alreadyTransparent = corners.every((c) => px[c + 3]! < CLEAR_ALPHA);
  // Only chroma-key when the corners agree on one opaque background color. Already-transparent
  // (SVG / transparent PNG) → pass through untouched; corners disagree → keep original.
  const uniformBg = !alreadyTransparent && corners.every((c) => near(px, corners[0]!, c));

  if (uniformBg) {
    // Flood-fill from every corner: only background *connected to an edge* is cleared, so a
    // patch of the same color inside the logo isn't punched out.
    const bg = corners[0]!;
    const seen = new Uint8Array(width * height);
    const stack = corners.map((c) => c / 4);
    while (stack.length) {
      const p = stack.pop()!;
      if (seen[p]) continue;
      seen[p] = 1;
      const idx = p * 4;
      if (!near(px, bg, idx)) continue;
      px[idx + 3] = 0; // transparent
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < width - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - width);
      if (y < height - 1) stack.push(p + width);
    }
  }

  const png = await sharp(px, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

export async function logo(file: string | undefined): Promise<number> {
  if (!file) {
    console.error("usage: krispy logo <file>   (png | jpg | webp | svg)");
    return 1;
  }
  let uri: string;
  try {
    uri = await logoToDataUri(file);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  // The data URI is the only thing on stdout, so `krispy logo … | pbcopy` just works. The
  // paste hint goes to stderr so it never pollutes a pipe.
  console.error(
    `✓ background removed (${(uri.length / 1024).toFixed(1)}KB) — paste this as theme.avatar in your tenant config:`,
  );
  console.log(uri);
  return 0;
}
