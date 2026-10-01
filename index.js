const express = require("express");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TARGET =
  "https://api.ytultra.com/ikool/youtube/download";

app.get("/", (req, res) => {
  res.json({
    success: true,
    name: "XYZ YouTube Downloader API",
    method: "POST",
    endpoint: "/youtube",
    usage: {
      url: "POST /youtube",
      body: {
        url: "https://www.youtube.com/watch?v=VIDEO_ID"
      }
    }
  });
});

app.post("/youtube", async (req, res) => {
  try {
    const url =
      req.body?.url ||
      req.body?.video ||
      req.body?.link;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL YouTube wajib diisi"
      });
    }

    if (
      !url.includes("youtube.com/") &&
      !url.includes("youtu.be/")
    ) {
      return res.status(400).json({
        success: false,
        error: "URL bukan URL YouTube yang valid"
      });
    }

    const response = await fetch(TARGET, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        url: url
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
      source: "ytultra",
      ...(
        typeof data === "object" &&
        data !== null
          ? data
          : { data }
      )
    });

  } catch (error) {
    console.error("YouTube API Error:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal menghubungi server downloader",
      message: error.message
    });
  }
});

module.exports = app;
