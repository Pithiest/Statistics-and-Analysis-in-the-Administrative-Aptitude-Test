import {
  normalizeCode,
  normalizeRecords,
  normalizeSettings
} from "./model";
import type { Settings, TrainingRecord } from "./model";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://atwsraivphybkfmyeubd.supabase.co";
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_y6wlba5S8qYJebIgnc389Q_zW6pMJnv";

export async function syncSpace(spaceCode: string, records: TrainingRecord[], settings: Settings, options: { upload?: boolean } = {}) {
  const code = normalizeCode(spaceCode);
  if (!code) return { records, settings };
  const shouldUpload = options.upload !== false;
  const hashes = await candidateHashes(code);
  const hashFilter = hashes.map(encodeURIComponent).join(",");
  const rows = await cloudFetch<Array<{ payload: string; updated_at: string; space_hash: string }>>(
    `/rest/v1/xingce_sync?space_hash=in.(${hashFilter})&select=payload,updated_at,space_hash&order=updated_at.desc&limit=1`
  );
  const remoteRow = rows[0] || null;
  const remote = remoteRow ? await parsePayload(remoteRow.payload, code) : null;
  const mergedRecords = normalizeRecords([...records, ...(remote?.records || [])]);
  const mergedSettings = mergeSettings(settings, remote?.settings);
  const targetHash = remoteRow?.space_hash || hashes[0];
  if (shouldUpload) {
    await cloudFetch(`/rest/v1/xingce_sync?on_conflict=space_hash`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        space_hash: targetHash,
        payload: await encryptText(JSON.stringify({ version: 7, records: mergedRecords, settings: mergedSettings, updatedAt: new Date().toISOString() }), code),
        updated_at: new Date().toISOString()
      })
    });
  }
  return { records: mergedRecords, settings: mergedSettings };
}

function mergeSettings(local: Settings, remote?: Partial<Settings> | null) {
  if (!remote) return normalizeSettings(local);
  const safeLocal = normalizeSettings(local);
  const safeRemote = normalizeSettings(remote);
  return safeRemote.updatedAt > safeLocal.updatedAt ? safeRemote : safeLocal;
}

async function parsePayload(payload: string, code: string) {
  const raw = String(payload || "").trim();
  const texts: string[] = [];
  if (raw.startsWith("{")) {
    texts.push(raw);
  } else {
    for (const salt of ["xingce-v20-cloud-sync", "xingce-space-sync-v4"]) {
      try {
        texts.push(await decryptText(raw, code, salt));
        break;
      } catch {
        try {
          texts.push(await decryptText(raw, code, salt, true));
          break;
        } catch {
          continue;
        }
      }
    }
  }
  for (const text of texts) {
    try {
      const parsed = JSON.parse(text);
      return { records: normalizeRecords(parsed.records || parsed), settings: normalizeSettings(parsed.settings || {}) };
    } catch {
      continue;
    }
  }
  return null;
}

async function cloudFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      signal: init.signal || controller.signal,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...(init.headers || {})
      }
    });
    if (!response.ok) throw new Error(await response.text());
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  } finally {
    window.clearTimeout(timeout);
  }
}

const encoder = new TextEncoder();
const keyCache = new Map<string, CryptoKey>();

async function candidateHashes(code: string) {
  const normalized = normalizeCode(code).toLowerCase();
  const variants = Array.from(new Set([normalized, code, code.toLowerCase(), code.toUpperCase()].filter(Boolean)));
  return Promise.all(variants.map(hashText));
}

async function deriveKey(code: string, salt: string, raw = false) {
  const normalized = raw ? code : normalizeCode(code).toLowerCase();
  const cacheKey = `${salt}:${raw ? "raw" : "std"}:${normalized}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const material = await crypto.subtle.importKey("raw", encoder.encode(normalized), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 120_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  keyCache.set(cacheKey, key);
  return key;
}

async function encryptText(text: string, code: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(code, "xingce-v20-cloud-sync"), encoder.encode(text)));
  return `${toBase64(iv)}.${toBase64(cipher)}`;
}

async function decryptText(payload: string, code: string, salt: string, raw = false) {
  const [iv, cipher] = payload.split(".");
  if (!iv || !cipher) throw new Error("bad payload");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await deriveKey(code, salt, raw), fromBase64(cipher));
  return new TextDecoder().decode(plain);
}

async function hashText(text: string) {
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
