import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://atwsraivphybkfmyeubd.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_y6wlba5S8qYJebIgnc389Q_zW6pMJnv";
const SOURCE_KEY = "pithiest-xingce-source-v5";

const remotePayload = await readRemotePayload().catch((error) => {
  console.warn(`Remote source payload unavailable: ${error.message}`);
  return null;
});
const localPayload = await readLocalPayload().catch(() => null);
const payload = remotePayload || localPayload;

if (!payload) {
  throw new Error("Source payload is empty.");
}

for (const file of payload.delete || []) {
  await rm(safeResolve(file), { force: true });
}

for (const [file, content] of Object.entries(payload.files || {})) {
  const target = safeResolve(file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(content, "base64"));
}

console.log(`Prepared ${Object.keys(payload.files || {}).length} source files for build.`);

async function readLocalPayload() {
  const text = await readFile(resolve("deploy-source.json"), "utf8");
  return JSON.parse(text);
}

async function readRemotePayload() {
  const url = `${SUPABASE_URL}/rest/v1/xingce_sync?space_hash=eq.${encodeURIComponent(SOURCE_KEY)}&select=payload&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!response.ok) throw new Error(`Cannot fetch source payload: ${response.status} ${await response.text()}`);
  const rows = await response.json();
  if (!rows[0]?.payload) throw new Error("Source payload is empty.");
  return JSON.parse(rows[0].payload);
}

function safeResolve(file) {
  const target = resolve(file);
  const pathFromRoot = relative(process.cwd(), target);
  if (!file || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`Refusing to write outside project root: ${file}`);
  }
  return target;
}
