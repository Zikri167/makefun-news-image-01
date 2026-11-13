import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const source = join(dirname(fileURLToPath(import.meta.url)), "entry.png");
  const image = await readFile(source);

  if (image.length < 1024) throw new Error("The source image is smaller than 1024 bytes and may be truncated.");
  if (image.length === 0) throw new Error("The source image is empty.");
  if (image.length > 1_048_576) throw new Error("The source image exceeds 1 MiB.");
  if (image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
    throw new Error("The source does not begin with a JPEG signature.");
  }
  if (image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
    throw new Error("The JPEG is missing its FF D9 end marker.");
  }

  let width = 0;
  let height = 0;
  let cursor = 2;
  while (cursor < image.length) {
    if (image[cursor] !== 0xff) {
      cursor++;
      continue;
    }
    while (cursor < image.length && image[cursor] === 0xff) cursor++;
    if (cursor >= image.length) break;

    const marker = image[cursor++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 2 > image.length) break;

    const segmentLength = image.readUInt16BE(cursor);
    if (segmentLength < 2 || cursor + segmentLength > image.length) break;
    const frameMarker = marker === 0xc0 || marker === 0xc1 || marker === 0xc2;
    if (frameMarker) {
      if (segmentLength < 7) break;
      height = image.readUInt16BE(cursor + 3);
      width = image.readUInt16BE(cursor + 5);
      break;
    }
    cursor += segmentLength;
  }

  if (width === 0 || height === 0) {
    throw new Error("No supported JPEG SOF0, SOF1, or SOF2 frame was found.");
  }
  if (width > 1024 || height > 1024) {
    throw new Error("The JPEG dimensions exceed 1024 pixels.");
  }

  const destination = join(process.env.MAKEFUN_OUTPUT_DIR || "/output", "entry.png");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, image);
  const digest = createHash("sha256").update(image).digest("hex");
  process.stdout.write(
    `${destination} | ${image.length} bytes | ${width}x${height} | sha256 ${digest}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
