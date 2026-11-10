/**
 * Fetch the bundled music beds.
 *
 *   pnpm music
 *
 * The audio is not committed. Five beds is twenty-odd megabytes, git keeps
 * binaries forever, and every clone would pay for them — so the repo carries
 * the manifest and this script, and the files are fetched on request.
 *
 * Only CC0 sources are listed. Not "free to use", not "no attribution needed":
 * public domain, so that anyone publishing a video made with this owes nobody
 * anything. Archive.org's licence field is self-reported and demonstrably
 * unreliable for music — a search for CC0 audio returns commercial bands — so
 * the artist is the thing being trusted here, not the metadata. HoliznaCC0
 * releases everything under CC0 as a matter of stated practice.
 *
 * Each source is a long ambient piece. Only the first few megabytes are
 * fetched, by byte range, and trimmed into a short bed: the renderer loops
 * music to length anyway, so a ninety-second file is as useful as a twenty
 * minute one and a fiftieth of the download.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { musicDir } from "../packages/core/src/music.ts";

const run = promisify(execFile);

interface Source {
  /** Becomes the file name, and the label in the picker. */
  name: string;
  /** Archive.org item and file, which together give a stable URL. */
  item: string;
  file: string;
  /** Seconds into the source to start, past any silent intro. */
  from: number;
}

/** All CC0 1.0, all by HoliznaCC0. See the note above on why these. */
const SOURCES: Source[] = [
  { name: "Cosmic waves", item: "holizna-cc-0-cosmic-waves", file: "HoliznaCC0 - Cosmic Waves.mp3", from: 45 },
  { name: "Dreamscape", item: "holizna-cc-0-cosmic-waves", file: "HoliznaCC0 - DreamScape.mp3", from: 20 },
  { name: "Rainfall", item: "holizna-cc-0-cosmic-waves", file: "HoliznaCC0 - Rain _ Sleep _ Meditation.mp3", from: 30 },
  { name: "Stillness", item: "holizna-cc-0-20-minute-meditation-1", file: "HoliznaCC0 - 20 Minute Meditation 1.mp3", from: 60 },
  { name: "Open sky", item: "holizna-cc-0-20-minute-meditation-2", file: "HoliznaCC0 - 20 Minute Meditation 2.mp3", from: 90 },
];

/** Long enough to carry a short video; the renderer loops it past that. */
const BED_SECONDS = 90;
/**
 * Bytes to pull for a given start offset.
 *
 * The sources run at about 320kbps, so a fixed range is not enough once the
 * start offset is late — the first attempt at this fetched a flat 4.5MB and
 * produced a twenty-second bed from a ninety-second offset. Sized from the
 * bitrate instead, with ten seconds of slack.
 */
const BYTES_PER_SECOND = 40_000;
const fetchBytes = (from: number) => Math.round((from + BED_SECONDS + 10) * BYTES_PER_SECOND);

const dir = musicDir();
await mkdir(dir, { recursive: true });

let made = 0;
for (const source of SOURCES) {
  const target = join(dir, `${source.name.toLowerCase().replace(/\s+/g, "-")}.mp3`);
  const url = `https://archive.org/download/${source.item}/${encodeURIComponent(source.file)}`;
  const partial = `${target}.part`;

  process.stdout.write(`${source.name}… `);
  try {
    // -L matters: archive.org answers with a 302 to the node holding the
    // file, and a range request that does not follow it returns nothing.
    await run("curl", [
      "-sL", "--fail", "--max-time", "180",
      "-r", `0-${fetchBytes(source.from)}`,
      "-o", partial,
      url,
    ]);

    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(source.from),
      "-t", String(BED_SECONDS),
      "-i", partial,
      "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "2",
      // A common loudness, so one track is not twice as loud as the next
      // under the same volume setting. -16 LUFS is the usual target for a
      // music file; -23 is the broadcast figure for a finished programme, and
      // using it here left the beds so quiet that bgm_volume and the duck
      // together buried them — at full volume the music moved the mix by one
      // decibel.
      //
      // No fades. The renderer fades the music out against the end of the
      // video, and a bed that fades in over three seconds gives a six-second
      // video almost no music at all. These are loops, not tracks.
      "-af", "loudnorm=I=-16:TP=-2",
      target,
    ]);

    made++;
    console.log("ok");
  } catch (cause) {
    console.log(`failed — ${cause instanceof Error ? cause.message.split("\n")[0] : "unknown"}`);
  } finally {
    await rm(partial, { force: true }).catch(() => {});
  }
}

// Written beside the audio so the provenance travels with the files, which
// are not in git and so carry no history of their own.
await writeFile(
  join(dir, "SOURCES.md"),
  [
    "# Where this music came from",
    "",
    "Fetched by `pnpm music`. Not committed — see scripts/fetch-music.mts.",
    "",
    "All tracks are by **HoliznaCC0** and released under",
    "[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/),",
    "which places them in the public domain. No attribution is required for",
    "videos made with them.",
    "",
    "Each file is a trimmed, fade-topped, loudness-matched excerpt.",
    "",
    "| Bed | Source |",
    "|---|---|",
    ...SOURCES.map((s) => `| ${s.name} | https://archive.org/details/${s.item} |`),
    "",
  ].join("\n"),
  "utf8",
);

console.log(`\n${made} of ${SOURCES.length} beds in ${dir}`);
if (made === 0) process.exitCode = 1;
