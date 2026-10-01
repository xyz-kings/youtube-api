const express = require("express");

const app = express();

app.use(express.json());

const API_URL =
  "https://api.ytultra.com/ikool/youtube/download";

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    name: "XYZ YouTube Downloader API",
    version: "1.0.0",
    author: "XYZ Kings",

    description:
      "API untuk mendapatkan data download video YouTube.",

    endpoints: {
      download: {
        method: "POST",
        path: "/youtube",
        content_type: "application/json",

        body: {
          url: "string"
        },

        example_request: {
          url: "https://youtu.be/fKcF32dmcDk?si=ORQmNa8uHJLR5z9L"
        }
      }
    },

    examples: {
      curl: `curl -X POST "${getBaseUrl(req)}/youtube" -H "Content-Type: application/json" -d '{"url":"https://youtu.be/fKcF32dmcDk?si=ORQmNa8uHJLR5z9L"}'`,

      javascript: `fetch("${getBaseUrl(req)}/youtube", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    url: "https://youtu.be/fKcF32dmcDk?si=ORQmNa8uHJLR5z9L"
  })
})
.then(res => res.json())
.then(console.log);`
    }
  });
});

app.post("/youtube", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Parameter 'url' wajib diisi.",

        example: {
          url: "https://youtu.be/fKcF32dmcDk"
        }
      });
    }

    if (
      !url.includes("youtube.com/") &&
      !url.includes("youtu.be/")
    ) {
      return res.status(400).json({
        success: false,
        error: "URL YouTube tidak valid."
      });
    }

    const response = await fetch(API_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },

      body: JSON.stringify({
        url
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

    return res.status(response.status).json({
      success: response.ok,
      ...(
        data &&
        typeof data === "object"
          ? data
          : { data }
      )
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Terjadi kesalahan pada server.",
      message: error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint tidak ditemukan.",

    available_endpoints: {
      documentation: "GET /",
      youtube_download: "POST /youtube"
    }
  });
});

function getBaseUrl(req) {
  const protocol =
    req.headers["x-forwarded-proto"] || "https";

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host;

  return `${protocol}://${host}`;
}

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(
      `XYZ YouTube API running on http://localhost:${PORT}`
    );
  });
}
