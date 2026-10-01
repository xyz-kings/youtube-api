const express = require("express");
const { YtdlCore } = require("@ybd-project/ytdl-core");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");

const ytdl = new YtdlCore();

function send(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.send(JSON.stringify(data, null, 2));
}

function getVideoId(input) {
  if (!input) return null;

  const value = String(input).trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com"
    ) {
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v");

        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
          return id;
        }
      }

      if (url.pathname.startsWith("/shorts/")) {
        const id = url.pathname.split("/")[2];

        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
          return id;
        }
      }

      if (url.pathname.startsWith("/embed/")) {
        const id = url.pathname.split("/")[2];

        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
          return id;
        }
      }
    }

    if (host === "youtu.be") {
      const id = url.pathname.split("/")[1];

      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return id;
      }
    }
  } catch (_) {
    return null;
  }

  return null;
}

function formatDuration(seconds) {
  const total = Number(seconds);

  if (!Number.isFinite(total) || total <= 0) {
    return "00:00";
  }

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);

  if (hours > 0) {
    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(secs).padStart(2, "0")
    ].join(":");
  }

  return [
    String(minutes).padStart(2, "0"),
    String(secs).padStart(2, "0")
  ].join(":");
}

function formatSize(bytes) {
  const value = Number(bytes);

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];

  let size = value;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }

  if (index === 0) {
    return `${Math.round(size)} B`;
  }

  return `${size.toFixed(2)} ${units[index]}`;
}

function getMime(format) {
  if (format.mimeType) {
    return String(format.mimeType).split(";")[0];
  }

  return "";
}

function getFormat(format) {
  if (format.container) {
    return String(format.container).toLowerCase();
  }

  const mime = getMime(format);

  if (mime.includes("mp4")) {
    return "mp4";
  }

  if (mime.includes("webm")) {
    return "webm";
  }

  if (mime.includes("m4a")) {
    return "m4a";
  }

  return "unknown";
}

function getVideoQuality(format) {
  if (
    format.quality &&
    typeof format.quality === "object" &&
    format.quality.label
  ) {
    return format.quality.label;
  }

  if (format.qualityLabel) {
    return format.qualityLabel;
  }

  if (format.height) {
    return `${format.height}p`;
  }

  return "unknown";
}

function getAudioQuality(format) {
  if (format.audioBitrate) {
    return `${Math.round(Number(format.audioBitrate))}kbps`;
  }

  if (format.bitrate) {
    return `${Math.round(Number(format.bitrate) / 1000)}kbps`;
  }

  return "audio";
}

function getHeight(format) {
  if (format.height) {
    return Number(format.height) || 0;
  }

  if (
    format.quality &&
    typeof format.quality === "object" &&
    format.quality.label
  ) {
    const match = String(format.quality.label).match(/(\d+)p/);

    if (match) {
      return Number(match[1]);
    }
  }

  return 0;
}

function buildMedias(formats) {
  if (!Array.isArray(formats)) {
    return [];
  }

  const medias = [];

  const usable = formats.filter((format) => {
    return (
      format &&
      typeof format === "object" &&
      format.url &&
      !format.isHLS &&
      !format.isDashMPD
    );
  });

  const videoFormats = usable
    .filter((format) => {
      return format.hasVideo === true;
    })
    .sort((a, b) => {
      return getHeight(b) - getHeight(a);
    });

  const audioFormats = usable
    .filter((format) => {
      return (
        format.hasAudio === true &&
        format.hasVideo !== true
      );
    })
    .sort((a, b) => {
      const bitrateA =
        Number(a.audioBitrate || a.bitrate || 0);

      const bitrateB =
        Number(b.audioBitrate || b.bitrate || 0);

      return bitrateB - bitrateA;
    });

  const usedVideo = new Set();

  for (const format of videoFormats) {
    const quality = getVideoQuality(format);

    if (quality === "unknown") {
      continue;
    }

    if (usedVideo.has(quality)) {
      continue;
    }

    usedVideo.add(quality);

    medias.push({
      mediaType: format.hasAudio ? "video+audio" : "video",
      quality,
      format: getFormat(format),
      size: formatSize(format.contentLength),
      url: format.url
    });
  }

  const usedAudio = new Set();

  for (const format of audioFormats) {
    const quality = getAudioQuality(format);

    if (usedAudio.has(quality)) {
      continue;
    }

    usedAudio.add(quality);

    medias.push({
      mediaType: "audio",
      quality,
      format: getFormat(format),
      size: formatSize(format.contentLength),
      url: format.url
    });
  }

  return medias;
}

function getTitle(info) {
  if (info?.videoDetails?.title) {
    return info.videoDetails.title;
  }

  if (info?.title) {
    return info.title;
  }

  if (info?.basic_info?.title) {
    return info.basic_info.title;
  }

  return "Unknown Title";
}

function getDuration(info) {
  if (info?.videoDetails?.lengthSeconds) {
    return formatDuration(
      info.videoDetails.lengthSeconds
    );
  }

  if (info?.lengthSeconds) {
    return formatDuration(info.lengthSeconds);
  }

  if (info?.basic_info?.duration) {
    return formatDuration(info.basic_info.duration);
  }

  return "00:00";
}

function getThumbnail(info, videoId) {
  const thumbnails =
    info?.videoDetails?.thumbnails ||
    info?.thumbnails ||
    info?.basic_info?.thumbnail ||
    [];

  if (Array.isArray(thumbnails) && thumbnails.length) {
    const thumbnail =
      thumbnails[thumbnails.length - 1];

    if (typeof thumbnail === "string") {
      return thumbnail;
    }

    if (thumbnail?.url) {
      return thumbnail.url;
    }
  }

  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

app.get("/", (req, res) => {
  const host =
    req.get("host") ||
    "your-domain.vercel.app";

  const protocol =
    req.headers["x-forwarded-proto"] ||
    "https";

  const base = `${protocol}://${host}`;

  const example =
    "https://www.youtube.com/watch?v=fKcF32dmcDk";

  return send(res, 200, {
    success: true,
    provider: "xyzkings",
    name: "XYZ YouTube API",
    version: "2.1.0",
    status: "online",
    apiKey: false,

    endpoint: {
      path: "/xyzdl",
      method: "GET",
      parameter: "url"
    },

    usage: {
      example:
        `${base}/xyzdl?url=${encodeURIComponent(example)}`,

      curl:
        `curl "${base}/xyzdl?url=${example}"`,

      nodejs:
        `const r = await fetch("${base}/xyzdl?url=${example}");\nconst data = await r.json();\nconsole.log(data);`
    },

    response: {
      title: "YouTube video title",
      imageUrl: "YouTube thumbnail",
      duration: "MM:SS or HH:MM:SS",
      medias: [
        {
          mediaType: "video",
          quality: "720p",
          format: "mp4",
          size: "19.43 MB",
          url: "https://*.googlevideo.com/videoplayback?... "
        },
        {
          mediaType: "audio",
          quality: "128kbps",
          format: "m4a",
          size: "4.21 MB",
          url: "https://*.googlevideo.com/videoplayback?... "
        }
      ]
    },

    note:
      "Media URLs are temporary YouTube stream URLs."
  });
});

app.get("/xyzdl", async (req, res) => {
  try {
    const input = req.query.url;

    if (!input) {
      return send(res, 400, {
        success: false,
        provider: "xyzkings",
        data: {
          code: "4001",
          msg: "Parameter url is required",
          data: null
        }
      });
    }

    const videoId = getVideoId(input);

    if (!videoId) {
      return send(res, 400, {
        success: false,
        provider: "xyzkings",
        data: {
          code: "4002",
          msg: "Invalid YouTube URL or video ID",
          data: null
        }
      });
    }

    const youtubeUrl =
      `https://www.youtube.com/watch?v=${videoId}`;

    console.log(
      `[XYZDL] Resolving ${videoId}`
    );

    const info =
      await ytdl.getFullInfo(youtubeUrl);

    const formats =
      Array.isArray(info.formats)
        ? info.formats
        : [];

    console.log(
      `[XYZDL] Formats found: ${formats.length}`
    );

    const medias =
      buildMedias(formats);

    const title =
      getTitle(info);

    const imageUrl =
      getThumbnail(info, videoId);

    const duration =
      getDuration(info);

    return send(res, 200, {
      success: true,
      provider: "xyzkings",
      data: {
        code: "0000",
        msg: "Request successful",
        data: {
          title,
          imageUrl,
          duration,
          medias
        }
      }
    });
  } catch (error) {
    console.error(
      "[XYZDL ERROR]",
      error?.stack ||
      error?.message ||
      error
    );

    const message =
      String(
        error?.message ||
        error ||
        ""
      );

    let code = "5000";
    let msg =
      "Failed to retrieve YouTube information";

    if (
      /unavailable|not found/i.test(message)
    ) {
      code = "4004";
      msg = "Video not found or unavailable";
    }

    if (
      /429|too many requests|rate limit/i.test(message)
    ) {
      code = "4290";
      msg = "YouTube rate limit reached";
    }

    if (
      /sign in|bot|verification/i.test(message)
    ) {
      code = "4291";
      msg =
        "YouTube requires additional verification";
    }

    return send(res, 500, {
      success: false,
      provider: "xyzkings",
      data: {
        code,
        msg,
        data: null
      }
    });
  }
});

app.use((req, res) => {
  return send(res, 404, {
    success: false,
    provider: "xyzkings",
    data: {
      code: "4040",
      msg: "Endpoint not found",
      data: null
    }
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `XYZ YouTube API running on port ${PORT}`
    );
  });
}

module.exports = app;
