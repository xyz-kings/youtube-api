#!/data/data/com.termux/files/usr/bin/bash
# Jalankan API YouTube Downloader di HP + buka tunnel publik (Cloudflare) - GRATIS.
# Pakai: bash start.sh
# Catatan: biarkan Termux tetap jalan (matikan optimasi baterai untuk Termux).
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-4320}"

echo "Menjalankan server di port $PORT ..."
PORT="$PORT" node index.js &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT INT TERM

echo "Membuka tunnel Cloudflare (URL publik muncul di bawah, tunggu ~10-30 detik) ..."
cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate --protocol http2
