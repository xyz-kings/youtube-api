const express = require('express')
const vm = require('vm')

const app = express()
const PORT = process.env.PORT || 4320
const AUTHOR = process.env.AUTHOR || 'your-name'
const API_NAME = 'YouTube Downloader API'

const DEFAULT_CLIENTS = (process.env.YT_CLIENTS || 'VISIONOS,IOS,ANDROID,TVHTML5,TVHTML5_SIMPLY_EMBEDDED_PLAYER,WEB_EMBEDDED_PLAYER')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

let shimReady = false
const setupShim = async () => {
  if (shimReady) return
  const { Platform } = await import('youtubei.js')
  Platform.shim.eval = async (data, env) => {
    const sandbox = { ...env }
    vm.createContext(sandbox)
    return vm.runInContext(`(function(){\n${data.output}\n}).call(this)`, sandbox, { timeout: 15000 })
  }
  shimReady = true
}

const clientCache = new Map()
const getClient = (clientType) => {
  if (!clientCache.has(clientType)) {
    const promise = (async () => {
      await setupShim()
      const { Innertube } = await import('youtubei.js')
      const options = { client_type: clientType, retrieve_player: true, location: 'US', lang: 'en' }
      if (process.env.YT_COOKIE) options.cookie = process.env.YT_COOKIE
      if (process.env.YT_PO_TOKEN) options.po_token = process.env.YT_PO_TOKEN
      if (process.env.YT_VISITOR_DATA) options.visitor_data = process.env.YT_VISITOR_DATA
      return Innertube.create(options)
    })().catch((err) => {
      clientCache.delete(clientType)
      throw err
    })
    clientCache.set(clientType, promise)
  }
  return clientCache.get(clientType)
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const toDuration = (sec) => {
  const s = Number(sec) || 0
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

const getVideoId = (input) => {
  if (!input) return null
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input
  try {
    const u = new URL(input)
    if (u.hostname === 'youtube.com' || u.hostname.endsWith('.youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
      const parts = u.pathname.split('/').filter(Boolean)
      if (['shorts', 'embed', 'live', 'v'].includes(parts[0]) && parts[1]) return parts[1]
    }
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0]
  } catch {
    return null
  }
  return null
}

const gatherFormats = async (yt, info) => {
  const sd = info.streaming_data || {}
  const all = [...(sd.formats || []), ...(sd.adaptive_formats || [])]
  const mp4 = []
  const mp3 = []
  for (const f of all) {
    const url = await resolveUrl(f, yt)
    if (!url) continue
    const mime = f.mime_type || ''
    const container = mime.startsWith('video/mp4') ? 'mp4'
      : mime.startsWith('video/webm') ? 'webm'
      : mime.startsWith('audio/mp4') ? 'm4a'
      : mime.startsWith('audio/webm') ? 'webm' : null
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
  mp4.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0))
  mp3.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  return { mp4: dedupe(mp4), mp3: dedupe(mp3) }
}

const processClient = async (clientType, id) => {
  const yt = await getClient(clientType)
  let info
  for (let attempt = 0; attempt < 2; attempt++) {
    info = await yt.getBasicInfo(id)
    if (info.streaming_data) break
    await sleep(400)
  }
  return { yt, info }
}

const buildResponse = async (id, yt, info) => {
  const details = info.basic_info || {}
  const { mp4, mp3 } = await gatherFormats(yt, info)
  const thumbnails = details.thumbnail || []
  const bestMp4 = mp4.find((f) => f.hasAudio) || mp4[0] || null
  const bestMp3 = mp3[0] || null
  const notes = []
  if (mp4.length && !mp4.some((f) => f.hasAudio)) {
    notes.push('mp4 di sini video-only (tanpa audio). Gabungkan dengan mp3 pakai ffmpeg bila ingin satu file.')
  }
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: details.title || null,
    duration: details.duration || null,
    durationString: details.duration ? toDuration(details.duration) : null,
    channel: details.author || null,
    channelId: details.channel_id || null,
    views: details.view_count || null,
    thumbnail: thumbnails.length ? thumbnails[thumbnails.length - 1].url : null,
    thumbnails,
    mp4: mp4.length ? mp4 : null,
    mp3: mp3.length ? mp3 : null,
    note: notes.length ? notes.join(' ') : null,
    tombol: {
      watch: `https://www.youtube.com/watch?v=${id}`,
      downloadMp4: bestMp4 ? bestMp4.url : null,
      downloadMp3: bestMp3 ? bestMp3.url : null
    }
  }
}

const getVideoIdOr400 = (input) => getVideoId(input)

app.get('/', (req, res) => {
  res.json({
    status: true,
    message: 'API aktif. Cara pakai: /ytdl?url=<link_youtube>',
    name: API_NAME,
    author: AUTHOR,
    clients: DEFAULT_CLIENTS
  })
})

app.get('/ytdl', async (req, res) => {
  const input = req.query.url
  if (!input) {
    return res.status(400).json({ status: false, author: AUTHOR, message: 'Parameter url tidak ditemukan. Contoh: /ytdl?url=https://youtu.be/xxxxx' })
  }
  const id = getVideoIdOr400(input)
  if (!id) {
    return res.status(400).json({ status: false, author: AUTHOR, message: 'URL YouTube tidak valid.' })
  }

  const clientsWanted = req.query.client
    ? String(req.query.client).split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_CLIENTS

  if (req.query.debug) {
    const diagnostics = []
    for (const clientType of clientsWanted) {
      const entry = { client: clientType }
      try {
        const { yt, info } = await processClient(clientType, id)
        const sd = info.streaming_data
        entry.playability = info.playability_status?.status || null
        entry.title = info.basic_info?.title || null
        entry.formats = (sd?.formats || []).length
        entry.adaptive = (sd?.adaptive_formats || []).length
        let ok = 0
        for (const f of [...(sd?.formats || []), ...(sd?.adaptive_formats || [])]) {
          if (await resolveUrl(f, yt)) ok++
        }
        entry.urls = ok
      } catch (err) {
        entry.error = String(err.message || err).slice(0, 160)
      }
      diagnostics.push(entry)
    }
    return res.json({ status: true, author: AUTHOR, id, diagnostics })
  }

  const attempts = clientsWanted.map(async (clientType) => {
    const { yt, info } = await processClient(clientType, id)
    const result = await buildResponse(id, yt, info)
    if (!result.mp4 && !result.mp3) throw new Error(`no formats from ${clientType}`)
    return { client: clientType, result }
  })

  try {
    const first = await Promise.any(attempts)
    return res.json({ status: true, author: AUTHOR, api: API_NAME, client: first.client, response: first.result })
  } catch {
    const { yt, info } = await processClient(clientsWanted[0], id).catch(() => ({ yt: null, info: {} }))
    const result = yt ? await buildResponse(id, yt, info) : { id, url: `https://www.youtube.com/watch?v=${id}` }
    return res.json({ status: true, author: AUTHOR, api: API_NAME, client: null, response: result, message: 'Data video kosong (mungkin diblokir dari IP server).' })
  }
})

app.use((req, res) => {
  res.status(404).json({ status: false, author: AUTHOR, message: 'Endpoint tidak ditemukan.' })
})

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`))
}

module.exports = app
