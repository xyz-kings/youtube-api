const express = require("express");
const { YtdlCore } = require("@ybd-project/ytdl-core");

const app = express();
const PORT = process.env.PORT || 3000;

const ytdl = new YtdlCore();

app.disable("x-powered-by");

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

  if (!Number.isFinite(total)) {
    return "00:00";
  }

  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);

  if (h > 0) {
    return [
      String(h).padStart(2, "0"),
      String(m).padStart(2, "0"),
      String(s).padStart(2, "0")
    ].join(":");
  }

  return [
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0")
  ].join(":");
}

function formatSize(bytes) {
  const size = Number(bytes);

  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function getQuality(format) {
  if (format.qualityLabel) {
    return format.qualityLabel;
  }

  if (format.height) {
    return `${format.height}p`;
  }

  return "unknown";
}

function getBitrate(format) {
  const bitrate =
    Number(format.audioBitrate) ||
    Math.round(Number(format.bitrate || 0) / 1000);

  if (!bitrate) {
    return "audio";
  }

  return `${bitrate}kbps`;
}

function buildMedias(formats) {
  const medias = [];

  const videoFormats = formats
    .filter((format) => {
      return (
        format.hasVideo &&
        format.container === "mp4" &&
        format.url
      );
    })
    .sort((a, b) => {
      return Number(b.height || 0) - Number(a.height || 0);
    });

  const audioFormats = formats
    .filter((format) => {
      return (
        format.hasAudio &&
        !format.hasVideo &&
        format.url
      );
    })
    .sort((a, b) => {
      return Number(b.audioBitrate || b.bitrate || 0) -
        Number(a.audioBitrate || a.bitrate || 0);
    });

  const usedVideo = new Set();

  for (const format of videoFormats) {
    const quality = getQuality(format);

    if (
      !quality ||
      quality === "unknown" ||
      usedVideo.has(quality)
    ) {
      continue;
    }

    usedVideo.add(quality);

    medias.push({
      mediaType: "video",
      quality,
      format: format.container || "mp4",
      size: formatSize(format.contentLength),
      url: format.url
    });
  }

  const usedAudio = new Set();

  for (const format of audioFormats) {
    const quality = getBitrate(format);

    if (usedAudio.has(quality)) {
      continue;
    }

    usedAudio.add(quality);

    medias.push({
      mediaType: "audio",
      quality,
      format:
        format.container ||
        (
          format.mimeType &&
          format.mimeType.includes("webm")
            ? "webm"
            : "m4a"
        ),
      size: formatSize(format.contentLength),
      url: format.url
    });
  }

  return medias;
}

app.get("/", (req, res) => {
  const host =
    req.get("host") ||
    "your-domain.vercel.app";

  const protocol =
    req.headers["x-forwarded-proto"] ||
    "https";

  const base =
    `${protocol}://${host}`;

  const youtubeUrl =
    "https://www.youtube.com/watch?v=fKcF32dmcDk";

  return send(res, 200, {
    success: true,
    provider: "xyzkings",
    name: "XYZ YouTube API",
    version: "2.0.0",
    status: "online",
    endpoint: "/xyzdl",
    method: "GET",
    parameter: {
      url: "YouTube URL atau YouTube Video ID"
    },
    usage: {
      url:
        `${base}/xyzdl?url=${encodeURIComponent(youtubeUrl)}`,

      curl:
        `curl "${base}/xyzdl?url=${youtubeUrl}"`,

      nodejs:
        `const response = await fetch("${base}/xyzdl?url=${youtubeUrl}");\nconst data = await response.json();\nconsole.log(data);`
    },
    output: {
      title: "Video title",
      imageUrl: "YouTube thumbnail",
      duration: "HH:MM:SS atau MM:SS",
      medias: [
        {
          mediaType: "video",
          quality: "720p",
          format: "mp4",
          size: "28.60 MB",
          url: "Temporary Google video stream URL"
        },
        {
          mediaType: "audio",
          quality: "128kbps",
          format: "m4a",
          size: "4.20 MB",
          url: "Temporary Google video stream URL"
        }
      ]
    },
    note:
      "Media URLs are temporary YouTube stream URLs and may expire."
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

    const url =
      `https://www.youtube.com/watch?v=${videoId}`;

    const info = await ytdl.getFullInfo(url);

    const details = info.videoDetails || {};

    const title =
      details.title ||
      "Unknown Title";

    const duration =
      formatDuration(details.lengthSeconds);

    const thumbnails =
      details.thumbnails ||
      [];

    const imageUrl =
      thumbnails.length
        ? thumbnails[thumbnails.length - 1].url
        : `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    const medias =
      buildMedias(info.formats || []);

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
      "[XYZ-YOUTUBE]",
      error?.stack || error?.message || error
    );

    let code = "5000";
    let message = "Failed to retrieve YouTube information";

    const errorText =
      String(error?.message || error || "");

    if (
      errorText.includes("Video unavailable") ||
      errorText.includes("Video not found")
    ) {
      code = "4004";
      message = "Video not found or unavailable";
    } else if (
      errorText.includes("Sign in") ||
      errorText.includes("bot")
    ) {
      code = "4290";
      message =
        "YouTube requires additional verification";
    } else if (
      errorText.includes("403")
    ) {
      code = "4030";
      message =
        "YouTube denied access to the requested stream";
    }

    return send(res, 500, {
      success: false,
      provider: "xyzkings",
      data: {
        code,
        msg: message,
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
