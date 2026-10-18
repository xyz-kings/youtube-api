#!/data/data/com.termux/files/usr/bin/bash
# Jalankan API YouTube Downloader di HP + buka tunnel publik (Cloudflare).
# Pakai: bash start.sh
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-4320}"

echo "Menjalankan server di port $PORT ..."
PORT="$PORT" node index.js &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT INT TERM

echo "Membuka tunnel Cloudflare (URL publik akan muncul di bawah) ..."
cloudflared tunnel --url "http://127.0.0.1:$PORT"
