const express = require("express");

const app = express();

app.use(express.json());
app.set("json spaces", 2);

const API_URL =
  "https://api.ytultra.com/ikool/youtube/download";

function getBaseUrl(req) {
  const protocol =
    req.headers["x-forwarded-proto"] || "https";

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host;

  return `${protocol}://${host}`;
}

function isYouTubeUrl(value) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();

    return (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtu.be" ||
      hostname === "www.youtu.be"
    );
  } catch {
    return false;
  }
}

async function downloadYouTube(url, res) {
  if (!url) {
    return res.status(400).json({
      success: false,
      error: "Parameter url wajib diisi.",
      example:
        "/xyzdl?url=https://youtu.be/fKcF32dmcDk"
    });
  }

  if (typeof url !== "string") {
    return res.status(400).json({
      success: false,
      error: "Parameter url harus berupa string."
    });
  }

  const cleanUrl = url.trim();

  if (!isYouTubeUrl(cleanUrl)) {
    return res.status(400).json({
      success: false,
      error: "URL YouTube tidak valid.",
      received: cleanUrl
    });
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({
        url: cleanUrl
      })
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw: text
      };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        provider: "ytultra",
        status: response.status,
        data
      });
    }

    return res.status(200).json({
      success: true,
      provider: "ytultra",
      data
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Gagal memproses URL YouTube.",
      message: error.message
    });
  }
}

app.get("/", (req, res) => {
  const base = getBaseUrl(req);

  res.status(200).json({
    success: true,
    name: "XYZ YouTube Downloader API",
    version: "1.1.0",
    author: "XYZ Kings",
    description:
      "API untuk mendapatkan data download video YouTube.",

    endpoints: {
      documentation: {
        method: "GET",
        path: "/"
      },

      download_get: {
        method: "GET",
        path: "/xyzdl",
        query: {
          url: "YouTube URL"
        },
        example:
          `${base}/xyzdl?url=https%3A%2F%2Fyoutu.be%2FfKcF32dmcDk`
      },

      download_post: {
        method: "POST",
        path: "/youtube",
        headers: {
          "Content-Type": "application/json"
        },
        body: {
          url: "https://youtu.be/fKcF32dmcDk"
        }
      }
    },

    example_url:
      "https://youtu.be/fKcF32dmcDk?si=ORQmNa8uHJLR5z9L",

    examples: {
      get:
        `${base}/xyzdl?url=https%3A%2F%2Fyoutu.be%2FfKcF32dmcDk%3Fsi%3DORQmNa8uHJLR5z9L`,

      post:
        `curl -X POST "${base}/youtube" -H "Content-Type: application/json" -d '{"url":"https://youtu.be/fKcF32dmcDk"}'`
    }
  });
});

app.get("/xyzdl", async (req, res) => {
  await downloadYouTube(req.query.url, res);
});

app.post("/youtube", async (req, res) => {
  await downloadYouTube(req.body?.url, res);
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint tidak ditemukan.",
    available_endpoints: {
      documentation: "GET /",
      download_get: "GET /xyzdl?url=YOUTUBE_URL",
      download_post: "POST /youtube"
    }
  });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(
      `XYZ YouTube API running on http://localhost:${PORT}`
    );
  });
}
