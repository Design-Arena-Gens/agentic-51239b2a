import { NextRequest } from "next/server";
import ytdl from "ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { randomUUID } from "crypto";
import { createWriteStream, promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  url?: string;
  start?: number;
  end?: number;
  format?: "mp4";
};

function validateBody(body: Body) {
  if (!body.url || typeof body.url !== "string") {
    throw new Error("Missing url");
  }
  if (typeof body.start !== "number" || typeof body.end !== "number") {
    throw new Error("Missing start/end");
  }
  if (body.end <= body.start) {
    throw new Error("end must be greater than start");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    validateBody(body);
    const { url, start, end } = body;
    const duration = Math.max(0.01, end! - start!);

    // Prepare temp paths
    const id = randomUUID();
    const outFile = path.join("/tmp", `clip_${id}.mp4`);

    // Ensure ffmpeg binary is configured
    if (ffmpegStatic) {
      ffmpeg.setFfmpegPath(ffmpegStatic as string);
    }

    // Select a progressive MP4 format (video+audio)
    const info = await ytdl.getInfo(url!);
    const format =
      ytdl.chooseFormat(info.formats, {
        filter: (f) => f.container === "mp4" && !!f.hasVideo && !!f.hasAudio && !!f.isHLS === false && !!f.isDashMPD === false,
        quality: "highest",
      }) ||
      ytdl.chooseFormat(info.formats, { quality: "highest" });

    if (!format || !format.url) {
      return new Response("Failed to get a downloadable format", { status: 400 });
    }

    const readStream = ytdl.downloadFromInfo(info, {
      quality: format.itag,
      filter: "audioandvideo",
      // higher buffer for stability in serverless
      highWaterMark: 1 << 25,
    });

    // Run ffmpeg to trim and re-encode for precise cut
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(readStream)
        .inputOptions([])
        .outputOptions([
          "-ss",
          String(start),
          "-t",
          String(duration),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
        ])
        .format("mp4")
        .on("start", () => {
          // no-op
        })
        .on("error", (err) => {
          reject(err);
        })
        .on("end", () => {
          resolve();
        })
        .save(outFile);
    });

    const data = await fs.readFile(outFile);
    // Clean up
    fs.unlink(outFile).catch(() => {});

    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="clip_${Math.floor(start!)}-${Math.floor(end!)}.mp4"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    const message = err?.message || String(err);
    return new Response(message, { status: 500 });
  }
}

