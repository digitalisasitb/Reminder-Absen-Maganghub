/**
 * Storage abstraction.
 *  - Vercel / production : Upstash Redis REST (env KV_REST_API_URL + KV_REST_API_TOKEN,
 *                          atau UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
 *  - Lokal               : file JSON di folder /data
 *  - Vercel tanpa Redis  : /tmp (sementara, hilang saat cold start) - hanya fallback darurat
 *
 * Nilai awal (seed) diambil dari file bawaan repo di /data/<key>.json.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SEED_DIR = path.join(__dirname, '..', '..', 'data');
const FILE_DIR = process.env.VERCEL ? '/tmp/kemnaker-data' : SEED_DIR;

function readJsonFile(file) {
  try {
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf-8') || 'null');
  } catch (e) {
    return undefined;
  }
}

async function redis(command) {
  const res = await axios.post(REDIS_URL, command, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    timeout: 8000
  });
  return res.data.result;
}

async function get(key, fallback = null) {
  if (REDIS_URL && REDIS_TOKEN) {
    const raw = await redis(['GET', `kemnaker:${key}`]);
    if (raw) return JSON.parse(raw);
  } else {
    const local = readJsonFile(path.join(FILE_DIR, `${key}.json`));
    if (local !== undefined && local !== null) return local;
  }
  const seed = readJsonFile(path.join(SEED_DIR, `${key}.json`));
  return seed !== undefined && seed !== null ? seed : fallback;
}

async function set(key, value) {
  if (REDIS_URL && REDIS_TOKEN) {
    await redis(['SET', `kemnaker:${key}`, JSON.stringify(value)]);
    return;
  }
  fs.mkdirSync(FILE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILE_DIR, `${key}.json`), JSON.stringify(value, null, 2), 'utf-8');
}

const usingRedis = () => !!(REDIS_URL && REDIS_TOKEN);

module.exports = { get, set, usingRedis };
