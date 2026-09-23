import {
  normalizeCode,
  normalizeRecords,
  normalizeSettings
} from "./model.ts";
import type { Settings, TrainingRecord } from "./model.ts";

type CloudSyncConfig = {
  url: string;
  apiKey: string;
  fetcher?: typeof fetch;
};

export function createSpaceSync({ url, apiKey, fetcher = fetch }: CloudSyncConfig) {
  async function syncSpace(spaceCode: string, records: TrainingRecord[], settings: Settings, options: { upload?: boolean } = {}) {
    const code = normalizeCode(spaceCode);
    if (!code) return { records, settings };
    const shouldUpload = options.upload !== false;
    const hashes = await candidateHashes(code);
    const hashFilter = hashes.map(encodeURIComponent).join(",");
    const rows = await cloudFetch<Array<{ payload: string; updated_at: string; space_hash: string }>>(
      `/rest/v1/xingce_sync?space_hash=in.(${hashFilter})&select=payload,updated_at,space_hash&order=updated_at.desc&limit=8`
    );
    const remotePayloads = await Promise.all(rows.map((row) => parsePayload(row.payload, code)));
    const mergedRecords = normalizeRecords([...records, ...remotePayloads.flatMap((remote) => remote?.records || [])]);
    const mergedSettings = remotePayloads.reduce((merged, remote) => mergeSettings(merged, remote?.settings), normalizeSettings(settings));
    const targetHash = rows[0]?.space_hash || hashes[0];
    if (shouldUpload) {
      const updatedAt = new Date().toISOString();
      await cloudFetch(`/rest/v1/xingce_sync?on_conflict=space_hash`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          space_hash: targetHash,
          payload: await encryptText(JSON.stringify({ version: 7, records: mergedRecords, settings: mergedSettings, updatedAt }), code),
          updated_at: updatedAt
        })
      });
    }
    return { records: mergedRecords, settings: mergedSettings };
  }

  async function cloudFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${url}${path}`, {
        ...init,
        signal: init.signal || controller.signal,
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(init.headers || {})
        }
      });
      if (!response.ok) throw new Error(await response.text());
      const text = await response.text();
      return text ? (JSON.parse(text) as T) : (undefined as T);
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  return syncSpace;
}

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "https://atwsraivphybkfmyeubd.supabase.co";
const SUPABASE_KEY =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_y6wlba5S8qYJebIgnc389Q_zW6pMJnv";

export const syncSpace = createSpaceSync({ url: SUPABASE_URL, apiKey: SUPABASE_KEY });

function mergeSettings(local: Settings, remote?: Partial<Settings> | null) {
  if (!remote) return normalizeSettings(local);
  const safeLocal = normalizeSettings(local);
  const safeRemote = normalizeSettings(remote);
  return safeRemote.updatedAt > safeLocal.updatedAt ? safeRemote : safeLocal;
}

async function parsePayload(payload: string, code: string) {
  const raw = String(payload || "").trim();
  let text = raw;
  if (!raw.startsWith("{") && !raw.startsWith("[")) {
    let decoded = false;
    for (const salt of ["xingce-v20-cloud-sync", "xingce-space-sync-v4"]) {
      try {
        text = await decryptText(raw, code, salt);
        decoded = true;
        break;
      } catch {
        try {
          text = await decryptText(raw, code, salt, true);
          decoded = true;
          break;
        } catch {
          continue;
        }
      }
    }
    if (!decoded) throw new Error("Cloud sync payload could not be decrypted");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Cloud sync payload is not valid JSON");
  }

  const records = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)
      ? (parsed as { records: unknown[] }).records
      : null);
  if (!records) throw new Error("Cloud sync payload does not contain a record list");
  const normalizedEntries = records.map((record) => normalizeRecords([record])[0]);
  if (normalizedEntries.some((record) => !record)) throw new Error("Cloud sync payload contains invalid records");
  const remoteSettings = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as { settings?: unknown }).settings
    : undefined;
  if (remoteSettings !== undefined && (!remoteSettings || typeof remoteSettings !== "object" || Array.isArray(remoteSettings))) {
    throw new Error("Cloud sync payload contains invalid settings");
  }
  return { records: normalizeRecords(normalizedEntries), settings: normalizeSettings(remoteSettings || {}) };
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
