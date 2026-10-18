const express = require('express')
const vm = require('vm')


const app = express()
const PORT = process.env.PORT || 4320
const AUTHOR = process.env.AUTHOR || 'your-name'
const API_NAME = 'YouTube Downloader API'

const FALLBACK_CLIENTS = (process.env.YT_CLIENTS || 'VISIONOS,ANDROID,IOS,TVHTML5,WEB')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const WEB_REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

let proxyDispatcher = null
const httpFetch = async (url, init = {}) => {
  if (!process.env.YT_PROXY) return fetch(url, init)
  if (!proxyDispatcher) {
    const { ProxyAgent } = await import('undici')
    proxyDispatcher = new ProxyAgent(process.env.YT_PROXY)
  }
  return fetch(url, { ...init, dispatcher: proxyDispatcher })
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const toDuration = (sec) => {
  const s = Number(sec) || 0
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}
const getVideoId = (input) => {
  if (!input) return null
  if (/^[\w-]{11}$/.test(input)) return input
  try {
    const u = new URL(input)
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
      const parts = u.pathname.split('/').filter(Boolean)
      if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && parts[1]) return parts[1]
      return null
    }
    if (u.hostname === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || null
  } catch {
    return null
  }
  return null
}

// ------------------------------------------------------------------
// PO Token (BotGuard) provider
// ------------------------------------------------------------------
let potCache = null
const ensurePot = async () => {
  if (potCache && Date.now() - potCache.createdAt < 6 * 60 * 60 * 1000) return potCache

  const { BotGuardClient } = await import('bgutils-js/botguard')
  const { buildURL, parseLooseJSON, getHeaders } = await import('bgutils-js/utils')
  const { WebPoMinter } = await import('bgutils-js/webpo')
  const { JSDOM } = await import('jsdom')

  const dom = new JSDOM('<!DOCTYPE html><html lang="en"><head></head><body></body></html>', {
    url: 'https://www.youtube.com',
    referrer: 'https://www.youtube.com/',
    userAgent: USER_AGENT
  })
  const pageHeaders = { 'user-agent': USER_AGENT, 'accept-language': 'en-US,en;q=0.7' }
  if (process.env.YT_COOKIE) pageHeaders.cookie = process.env.YT_COOKIE
  const pageHtml = await (await httpFetch('https://www.youtube.com', { headers: pageHeaders })).text()
  const cfg = JSON.parse(pageHtml.match(/ytcfg\.set\(({.+?})\);/s)[1])
  const visitorData = cfg.VISITOR_DATA || cfg.INNERTUBE_CONTEXT?.client?.visitorData
  if (!visitorData) throw new Error('visitorData tidak ditemukan')

  dom.window.yt = { config_: cfg }
  Object.assign(globalThis, {
    yt: dom.window.yt,
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin
  })
  if (!('navigator' in globalThis)) Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator })

  const att = parseLooseJSON(pageHtml.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)[1]).R
  const interpreterUrl = att.bgChallenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  new Function(await (await httpFetch(`https:${interpreterUrl}`)).text())()

  const botGuard = await BotGuardClient.create({
    program: att.bgChallenge.program,
    globalName: att.bgChallenge.globalName,
    globalObject: globalThis
  })
  const signalOutput = []
  const botguardResponse = await botGuard.snapshot({ webPoSignalOutput: signalOutput })
  const it = await (
    await httpFetch(buildURL('GenerateIT', true), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify([WEB_REQUEST_KEY, botguardResponse])
    })
  ).json()
  if (!Array.isArray(it) || !it[0]) throw new Error('GenerateIT gagal')
  const minter = await WebPoMinter.create(
    { integrityToken: it[0], estimatedTtlSecs: it[1], mintRefreshThreshold: it[2], websafeFallbackToken: it[3] },
    signalOutput
  )
  potCache = { visitorData, minter, createdAt: Date.now() }
  return potCache
}

// ------------------------------------------------------------------
// Innertube clients
// ------------------------------------------------------------------
const clientCache = new Map()
const buildClient = async (clientType, visitorData, poToken) => {
  await setupShim()
  const { Innertube } = await import('youtubei.js')
  const options = { client_type: clientType, retrieve_player: true, location: 'US', lang: 'en', fetch: httpFetch }
  if (process.env.YT_COOKIE) options.cookie = process.env.YT_COOKIE
  if (visitorData) options.visitor_data = visitorData
  else if (process.env.YT_VISITOR_DATA) options.visitor_data = process.env.YT_VISITOR_DATA
  if (poToken) options.po_token = poToken
  else if (process.env.YT_PO_TOKEN) options.po_token = process.env.YT_PO_TOKEN
  return Innertube.create(options)
}

const getClient = (clientType, visitorData) => {
  const key = visitorData ? `${clientType}:${visitorData.slice(-12)}` : clientType
  if (!clientCache.has(key)) {
    const promise = buildClient(clientType, visitorData).catch((err) => {
      clientCache.delete(key)
      throw err
    })
    clientCache.set(key, promise)
  }
  return clientCache.get(key)
}

// ------------------------------------------------------------------
// Format extraction
// ------------------------------------------------------------------
const resolveUrl = async (format, yt) => {
  if (typeof format.url === 'string' && format.url.startsWith('http')) return format.url
  try {
    const url = await format.decipher(yt.session.player)
    return typeof url === 'string' && url.startsWith('http') ? url : null
  } catch {
    return null
  }
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

// ------------------------------------------------------------------
// Core: try POT + VISIONOS, then fallbacks
// ------------------------------------------------------------------
const withPot = async (id) => {
  const pot = await ensurePot()
  const poToken = await pot.minter.mintAsWebsafeString(id)
  const yt = await getClient('VISIONOS', pot.visitorData)
  let info
  for (let i = 0; i < 2; i++) {
    info = await yt.getBasicInfo(id, { po_token: poToken })
    if (info.streaming_data?.adaptive_formats?.length) break
    await sleep(400)
  }
  return { yt, info, poToken }
}

const processFallback = async (clientType, id) => {
  const yt = await getClient(clientType)
  let info
  for (let attempt = 0; attempt < 2; attempt++) {
    info = await yt.getBasicInfo(id)
    if (info.streaming_data) break
    await sleep(400)
  }
  return { yt, info }
}

app.get('/', (req, res) => {
  res.json({
    status: true,
    message: 'API aktif. Cara pakai: /ytdl?url=<link_youtube>',
    name: API_NAME,
    author: AUTHOR,
    clients: ['VISIONOS+POT', ...FALLBACK_CLIENTS]
  })
})

app.get('/potdebug', async (req, res) => {
  const id = getVideoId(req.query.url || 'UjyCqQjW6ks') || 'UjyCqQjW6ks'
  const list = String(req.query.client || 'VISIONOS,WEB,ANDROID,IOS,TVHTML5').split(',').map((s) => s.trim()).filter(Boolean)
  const out = { id, node: process.version, steps: [] }
  let pot
  try {
    const t0 = Date.now()
    pot = await ensurePot()
    out.steps.push({ step: 'pot', ok: true, ms: Date.now() - t0, visitor: pot.visitorData.slice(0, 24) })
    const poToken = await pot.minter.mintAsWebsafeString(id)
    out.steps.push({ step: 'mint', ok: true, len: poToken.length })
    for (const clientType of list) {
      try {
        const yt = await getClient(clientType, pot.visitorData)
        const info = await yt.getBasicInfo(id, { po_token: poToken })
        const sd = info.streaming_data
        let ok = 0
        for (const f of [...(sd?.formats || []), ...(sd?.adaptive_formats || [])]) {
          if (await resolveUrl(f, yt)) ok++
        }
        out.steps.push({
          client: clientType,
          playability: info.playability_status?.status,
          title: info.basic_info?.title || null,
          formats: (sd?.formats || []).length,
          adaptive: (sd?.adaptive_formats || []).length,
          urls: ok
        })
      } catch (err) {
        out.steps.push({ client: clientType, error: String(err.message || err).slice(0, 160) })
      }
    }
  } catch (err) {
    out.steps.push({ step: 'error', message: String(err.message || err).slice(0, 200) })
  }
  res.json(out)
})

app.get('/ytdl', async (req, res) => {
  const input = req.query.url
  if (!input) {
    return res.status(400).json({ status: false, author: AUTHOR, message: 'Parameter url tidak ditemukan. Contoh: /ytdl?url=https://youtu.be/xxxxx' })
  }
  const id = getVideoId(input)
  if (!id) {
    return res.status(400).json({ status: false, author: AUTHOR, message: 'URL YouTube tidak valid.' })
  }

  const clientsWanted = req.query.client
    ? String(req.query.client).split(',').map((s) => s.trim()).filter(Boolean)
    : FALLBACK_CLIENTS

  if (req.query.debug) {
    const diagnostics = []
    for (const clientType of clientsWanted) {
      const entry = { client: clientType }
      try {
        const { yt, info } = await processFallback(clientType, id)
        const sd = info.streaming_data
        entry.playability = info.playability_status?.status || null
        entry.title = info.basic_info?.title || null
        entry.formats = (sd?.formats || []).length
        entry.adaptive = (sd?.adaptive_formats || []).length
        let ok = 0
        for (const f of [...(sd?.formats || []), ...(sd?.adaptive_formats || [])]) if (await resolveUrl(f, yt)) ok++
        entry.urls = ok
      } catch (err) {
        entry.error = String(err.message || err).slice(0, 160)
      }
      diagnostics.push(entry)
    }
    return res.json({ status: true, author: AUTHOR, id, diagnostics })
  }

  // 1) Primary: VISIONOS + PO token
  try {
    const { yt, info } = await withPot(id)
    const result = await buildResponse(id, yt, info)
    if (result.mp4 || result.mp3) {
      return res.json({ status: true, author: AUTHOR, api: API_NAME, client: 'VISIONOS+POT', response: result })
    }
  } catch {}

  // 2) Fallback: multiple clients (parallel)
  const attempts = clientsWanted.map(async (clientType) => {
    const { yt, info } = await processFallback(clientType, id)
    const result = await buildResponse(id, yt, info)
    if (!result.mp4 && !result.mp3) throw new Error(`no formats from ${clientType}`)
    return { client: clientType, result }
  })

  try {
    const first = await Promise.any(attempts)
    return res.json({ status: true, author: AUTHOR, api: API_NAME, client: first.client, response: first.result })
  } catch {
    return res.json({
      status: true,
      author: AUTHOR,
      api: API_NAME,
      client: null,
      response: { id, url: `https://www.youtube.com/watch?v=${id}`, title: null, mp4: null, mp3: null, tombol: { watch: `https://www.youtube.com/watch?v=${id}`, downloadMp4: null, downloadMp3: null } },
      message: 'Data video kosong. IP server mungkin diblokir YouTube (butuh cookies / proxy).'
    })
  }
})

app.use((req, res) => {
  res.status(404).json({ status: false, author: AUTHOR, message: 'Endpoint tidak ditemukan.' })
})

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`))
}

module.exports = app
