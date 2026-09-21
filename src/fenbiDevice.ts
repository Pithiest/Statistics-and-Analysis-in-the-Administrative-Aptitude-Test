// Browser-only collector matching Fenbi's public pfweb implementation:
// https://nodestatic.fbstatic.cn/weblts_spa_online/page/main-N27TX2P7.js
// No fabricated values, network requests, password access, or retry logic.
export const FENBI_STARTUP_ID = String(Date.now());
export type FenbiBrowserExtras = {
  canvas: string; webgl: string; screen: string; language: string;
  platform: string; cores: string; memory: string; touchPoints: string;
};
function canvasHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return hash.toString(36);
}
function canvasFingerprint() {
  try {
    const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 50;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.textBaseline = "top"; context.font = "14px Arial";
    context.fillStyle = "#f60"; context.fillRect(50, 0, 100, 50);
    context.fillStyle = "#069"; context.fillText("DeviceUUID@fp", 2, 15);
    context.fillStyle = "rgba(102,204,0,0.7)"; context.fillText("DeviceUUID@fp", 4, 17);
    return canvasHash(canvas.toDataURL());
  } catch { return ""; }
}
function webglFingerprint() {
  try {
    const context = document.createElement("canvas").getContext("webgl");
    if (!context) return "";
    const extension = context.getExtension("WEBGL_debug_renderer_info");
    const vendor = context.getParameter(extension ? extension.UNMASKED_VENDOR_WEBGL : context.VENDOR);
    const renderer = context.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : context.RENDERER);
    return `${vendor}~${renderer}`;
  } catch { return ""; }
}
export function collectFenbiBrowserExtras(): FenbiBrowserExtras {
  const browser = navigator as Navigator & { userAgentData?: { platform?: string }; deviceMemory?: number };
  return {
    canvas: canvasFingerprint(), webgl: webglFingerprint(),
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    language: browser.language || "", platform: browser.userAgentData?.platform || browser.platform || "",
    cores: String(browser.hardwareConcurrency || 0), memory: String(browser.deviceMemory || 0), touchPoints: String(browser.maxTouchPoints || 0),
  };
}

const ATTEMPTS_KEY = "pithiest-xingce-fenbi-device-attempts-v1";
const attemptedThisPage = new Set<string>();
export function hasAttemptedFenbiDevice(token: string): boolean {
  if (attemptedThisPage.has(token)) return true;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) || "[]");
    return !Array.isArray(saved) || saved.includes(token);
  } catch { return true; }
}
/** Persist before collecting or sending; failed persistence must not permit an untracked attempt. */
export function markFenbiDeviceAttempt(token: string): boolean {
  if (hasAttemptedFenbiDevice(token)) return false;
  attemptedThisPage.add(token);
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) || "[]");
    if (!Array.isArray(saved)) return false;
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify([...new Set([...saved.filter((value) => typeof value === "string"), token])]));
    return true;
  } catch { return false; }
}
