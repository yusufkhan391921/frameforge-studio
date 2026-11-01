const { randomUUID } = require("node:crypto");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const { Readable } = require("node:stream");
const path = require("node:path");

const mediaById = new Map();
const mediaTypes = new Map([
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".ogv", "video/ogg"],
]);

async function validateVideoPath(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error("The selected media path is invalid.");
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!mediaTypes.has(extension)) {
    throw new Error(`Unsupported video format: ${extension || "unknown"}`);
  }
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error("The selected media is not a file.");
  }
}

function mediaDetails(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = mediaTypes.get(extension);
  if (!mimeType) {
    throw new Error(`Unsupported video format: ${extension || "unknown"}`);
  }
  const id = randomUUID();
  mediaById.set(id, filePath);
  return {
    sourceId: id,
    name: path.basename(filePath),
    mimeType,
    url: `frameforge://media/${id}`,
  };
}

async function registerSelectedMedia(filePaths) {
  for (const filePath of filePaths) {
    await validateVideoPath(filePath);
  }
  return filePaths.map(mediaDetails);
}

async function serveMedia(request, registeredMedia = mediaById) {
  const url = new URL(request.url);
  const id = url.pathname.slice(1);
  const filePath = url.hostname === "media" ? registeredMedia.get(id) : undefined;
  if (!filePath) {
    return new Response("Media not found.", { status: 404 });
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return new Response("Media is no longer available.", { status: 404 });
    }
    throw error;
  }

  const mimeType = mediaTypes.get(path.extname(filePath).toLowerCase());
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": mimeType,
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const range = request.headers.get("range");
  let start = 0;
  let end = stat.size - 1;
  let status = 200;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      return new Response(null, { status: 416, headers });
    }
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        return new Response(null, { status: 416, headers });
      }
      start = Math.max(0, stat.size - suffixLength);
    } else {
      start = Number(match[1]);
      if (match[2]) end = Number(match[2]);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      headers.set("Content-Range", `bytes */${stat.size}`);
      return new Response(null, { status: 416, headers });
    }
    end = Math.min(end, stat.size - 1);
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  }

  headers.set("Content-Length", String(end - start + 1));
  if (request.method === "HEAD") {
    return new Response(null, { status, headers });
  }
  const stream = createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream), { status, headers });
}

module.exports = {
  mediaById,
  mediaTypes,
  registerSelectedMedia,
  serveMedia,
  validateVideoPath,
};
