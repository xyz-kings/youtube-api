const express = require('express')
const vm = require('vm')

const app = express()
const PORT = process.env.PORT || 4320
const CLIENT = process.env.YT_CLIENT || 'VISIONOS'

const API_INFO = {
  name: 'YouTube Downloader API',
  version: '1.0.0',
  author: 'your-name',
  endpoints: {
    '/': 'Menampilkan info API (JSON)',
    '/ytdl?url=<link_youtube>': 'Ambil info + link download video/audio'
  }
}

const YOUTUBE_ID = /^[a-zA-Z0-9_-]{11}$/

const sendJson = (res, data, code = 200) => {
  res.status(code).set('Content-Type', 'application/json; charset=utf-8')
  res.send(JSON.stringify(data, null, 2))
}

const getVideoId = (input) => {
  if (!input) return null
  if (YOUTUBE_ID.test(input)) return input
  try {
    const u = new URL(input)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0]
    if (u.searchParams.get('v')) return u.searchParams.get('v')
    const parts = u.pathname.split('/')
    const i = parts.findIndex((p) => ['embed', 'shorts', 'live'].includes(p))
    if (i !== -1 && parts[i + 1]) return parts[i + 1]
  } catch {
    return null
  }
  return null
}

const toDuration = (sec) => {
  const s = Number(sec) || 0
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

let clientPromise
const getClient = () => {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { Innertube, Platform } = await import('youtubei.js')

      Platform.shim.eval = async (data, env) => {
        const sandbox = { ...env }
        vm.createContext(sandbox)
        return vm.runInContext(`(function(){\n${data.output}\n}).call(this)`, sandbox, { timeout: 15000 })
      }

      const options = { client_type: CLIENT, retrieve_player: true, location: 'US', lang: 'en' }
      if (process.env.YT_COOKIE) options.cookie = process.env.YT_COOKIE
      if (process.env.YT_PO_TOKEN) options.po_token = process.env.YT_PO_TOKEN
      if (process.env.YT_VISITOR_DATA) options.visitor_data = process.env.YT_VISITOR_DATA

      return Innertube.create(options)
    })().catch((err) => {
      clientPromise = undefined
      throw err
    })
  }
  return clientPromise
}

const resolveUrl = async (format, yt) => {
  if (typeof format.url === 'string' && format.url.startsWith('http')) return format.url
  try {
    const url = await format.decipher(yt.session.player)
    return typeof url === 'string' && url.startsWith('http') ? url : null
  } catch {
    return null
  }
}

app.get('/', (req, res) => {
  sendJson(res, {
    status: true,
    message: 'API aktif. Cara pakai: /ytdl?url=<link_youtube>',
    ...API_INFO
  })
})

app.get('/ytdl', async (req, res) => {
  const input = req.query.url

  if (!input) {
    return sendJson(res, {
      status: false,
      author: API_INFO.author,
      message: 'Parameter url tidak ditemukan. Contoh: /ytdl?url=https://youtu.be/xxxxx'
    }, 400)
  }

  const id = getVideoId(input)
  if (!id) {
    return sendJson(res, {
      status: false,
      author: API_INFO.author,
      message: 'URL YouTube tidak valid.'
    }, 400)
  }

  try {
    const yt = await getClient()

    let info
    for (let attempt = 0; attempt < 3; attempt++) {
      info = await yt.getBasicInfo(id)
      if (info.streaming_data?.adaptive_formats?.length || info.streaming_data?.formats?.length) break
      await new Promise((r) => setTimeout(r, 600))
    }

    const details = info.basic_info || {}
    const sd = info.streaming_data || {}
    const all = [...(sd.formats || []), ...(sd.adaptive_formats || [])]

    const mp4 = []
    const mp3 = []
    for (const f of all) {
      const url = await resolveUrl(f, yt)
      if (!url) continue
      const mime = f.mime_type || ''
      const container = mime.startsWith('video/mp4') ? 'mp4' : mime.startsWith('video/webm') ? 'webm' : mime.startsWith('audio/mp4') ? 'm4a' : mime.startsWith('audio/webm') ? 'webm' : null

      if (f.has_video) {
        mp4.push({
          itag: f.itag,
          quality: f.quality_label || `${f.height || '?'}p`,
          container,
          hasAudio: !!f.has_audio,
          fps: f.fps || null,
          bitrate: f.bitrate ? Number(f.bitrate) : null,
          contentLength: f.content_length ? Number(f.content_length) : null,
          url
        })
      } else if (f.has_audio) {
        mp3.push({
          itag: f.itag,
          quality: f.audio_quality ? f.audio_quality.replace('AUDIO_QUALITY_', '').toLowerCase() : 'audio',
          container,
          bitrate: f.bitrate ? Number(f.bitrate) : null,
          contentLength: f.content_length ? Number(f.content_length) : null,
          url
        })
      }
    }
    const dedupe = (list) => {
      const map = new Map()
      for (const item of list) if (!map.has(item.itag)) map.set(item.itag, item)
      return [...map.values()]
    }
    const mp4List = dedupe(mp4).sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0))
    const mp3List = dedupe(mp3).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))

    const thumbnails = details.thumbnail || []
    const thumbnail = thumbnails.length ? thumbnails[thumbnails.length - 1].url : null
    const bestMp4 = mp4List.find((f) => f.hasAudio) || mp4List[0] || null
    const bestMp3 = mp3List[0] || null

    const notes = []
    if (mp4List.length && !mp4List.some((f) => f.hasAudio)) {
      notes.push('mp4 di sini video-only (tanpa audio). Gabungkan dengan mp3 pakai ffmpeg bila ingin satu file.')
    }

    sendJson(res, {
      status: true,
      author: API_INFO.author,
      api: API_INFO.name,
      response: {
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: details.title || null,
        duration: details.duration || null,
        durationString: details.duration ? toDuration(details.duration) : null,
        channel: details.author || null,
        channelId: details.channel_id || null,
        views: details.view_count || null,
        shortDescription: details.short_description || null,
        isLive: !!details.is_live,
        thumbnail,
        thumbnails: thumbnails.map((t) => ({ url: t.url, width: t.width, height: t.height })),
        mp4: mp4List.length ? mp4List : null,
        mp3: mp3List.length ? mp3List : null,
        note: notes.length ? notes.join(' ') : null,
        tombol: {
          watch: `https://www.youtube.com/watch?v=${id}`,
          downloadMp4: bestMp4 ? bestMp4.url : null,
          downloadMp3: bestMp3 ? bestMp3.url : null
        }
      }
    })
  } catch (err) {
    sendJson(res, {
      status: false,
      author: API_INFO.author,
      message: 'Gagal mengambil data video.',
      error: err.message
    }, 500)
  }
})

app.use((req, res) => {
  sendJson(res, {
    status: false,
    author: API_INFO.author,
    message: 'Endpoint tidak ditemukan.'
  }, 404)
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server jalan di http://localhost:${PORT}`)
  })
}

module.exports = app
