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

function formatResponse(data) {
  const result = data?.data;

  if (!result) {
    return {
      success: false,
      author: "XYZ Kings",
      message: "Response provider tidak valid.",
      response: []
    };
  }

  const medias = Array.isArray(result.medias)
    ? result.medias
    : [];

  return {
    success: true,
    author: "XYZ Kings",
    code: 200,
    message: "Success",

    title: result.title || null,

    thumbnail: result.imageUrl || null,

    duration: result.duration || null,

    response: medias.map((item) => ({
      url: item.url || null,
      quality: item.quality || null,
      format: item.format || null,
      fileSize: item.fileSize || null,
      size: item.sizeStr || null,
      locked: item.locked || false
    }))
  };
}

async function downloadYouTube(url, res) {
  if (!url) {
    return res.status(400).json({
      success: false,
      author: "XYZ Kings",
      code: 400,
      message: "Parameter url wajib diisi.",
      response: []
    });
  }

  if (typeof url !== "string") {
    return res.status(400).json({
      success: false,
      author: "XYZ Kings",
      code: 400,
      message: "Parameter url harus berupa string.",
      response: []
    });
  }

  const cleanUrl = url.trim();

  if (!isYouTubeUrl(cleanUrl)) {
    return res.status(400).json({
      success: false,
      author: "XYZ Kings",
      code: 400,
      message: "URL YouTube tidak valid.",
      response: []
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
      data = null;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        author: "XYZ Kings",
        code: response.status,
        message:
          data?.msg ||
          "Provider gagal memproses video.",
        response: []
      });
    }

    const result = formatResponse(data);

    return res.status(200).json(result);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      author: "XYZ Kings",
      code: 500,
      message: "Terjadi kesalahan pada server.",
      error: error.message,
      response: []
    });
  }
}

app.get("/", (req, res) => {
  const base = getBaseUrl(req);

  res.status(200).json({
    success: true,
    author: "XYZ Kings",
    name: "XYZ YouTube Downloader API",
    version: "1.2.0",

    description:
      "YouTube video downloader API.",

    endpoints: {
      download: {
        method: "GET",
        path: "/xyzdl",
        parameter: "url",
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

    example: {
      url:
        "https://youtu.be/fKcF32dmcDk?si=ORQmNa8uHJLR5z9L"
    }
  });
});

app.get("/xyzdl", async (req, res) => {
  await downloadYouTube(
    req.query.url,
    res
  );
});

app.post("/youtube", async (req, res) => {
  await downloadYouTube(
    req.body?.url,
    res
  );
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    author: "XYZ Kings",
    code: 404,
    message: "Endpoint tidak ditemukan.",
    response: []
  });
});

module.exports = app;

if (require.main === module) {
  const PORT =
    process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(
      `XYZ YouTube API running on http://localhost:${PORT}`
    );
  });
}
