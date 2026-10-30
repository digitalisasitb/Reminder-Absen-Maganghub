# Kemnaker Magang Reminder

Dashboard + otomasi reminder presensi peserta magang Kemnaker MagangHub.

## Struktur

```
api/index.js          Entry serverless Vercel (Express)
src/app.js            Express app & semua endpoint /api/*
src/lib/              store (Upstash Redis / file lokal), browser (Chromium)
src/services/         kemnaker, whatsapp, email, scheduler, log
public/               Dashboard (statis)
data/                 Seed awal (config.json, interns.json) - bukan storage produksi
scripts/              CLI & skrip uji lokal
server.js             Server lokal + node-cron
vercel.json           Rewrite /api/* + maxDuration
.github/workflows/    Pemicu jadwal (curl ke Vercel)
```

## Jadwal (Senin-Jumat, WIB)

| Jam   | Job        | Aksi                                  |
|-------|------------|---------------------------------------|
| 09:30 | `morning`   | Sync presensi                         |
| 15:30 | `afternoon` | Sync ulang → WhatsApp yang belum absen |
| 21:00 | `night`     | Sync ulang → Email mentor & peserta    |

Setiap job selalu **sync ulang dari portal**. Peserta yang sudah `hadir` hari itu
tidak akan turun lagi menjadi `belum_absen`; jika sync gagal, tidak ada email dikirim.

## Deploy ke Vercel

1. Import repo ke Vercel.
2. Tambah **Upstash Redis** (Vercel → Storage / Marketplace) → env `KV_REST_API_URL` & `KV_REST_API_TOKEN` otomatis terisi.
3. Set Environment Variables: `KEMNAKER_PHONE`, `KEMNAKER_PASS`, `SMTP_USER`, `SMTP_PASS`, `MENTOR_EMAIL`, `CRON_SECRET`, `ADMIN_PASSWORD` (lihat `.env.example`).
4. Di GitHub repo → Settings → Secrets: `APP_URL` (mis. `https://nama-app.vercel.app`) dan `CRON_SECRET` (sama dengan di Vercel).
5. Tes manual: Actions → *Kemnaker Magang Reminder (Scheduler)* → Run workflow.

> Vercel Hobby hanya mengizinkan cron 1x/hari, makanya jadwal 3x/hari dipicu GitHub Actions.
> Jika pakai Vercel Pro, bisa pindah ke `crons` di `vercel.json` (endpoint sama, auth `CRON_SECRET` otomatis).

## Lokal

```
npm install
cp .env.example .env
npm start               # http://localhost:3000
npm run cycle -- --time=21:00
```
