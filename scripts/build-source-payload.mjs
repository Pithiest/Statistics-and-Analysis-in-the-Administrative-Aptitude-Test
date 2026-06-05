import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["src", "public"];
const files = {};

for (const root of roots) {
  for (const file of await walk(root)) {
    const normalized = file.replaceAll("\\", "/");
    files[normalized] = (await readFile(file)).toString("base64");
  }
}

const payload = {
  version: 5,
  updatedAt: new Date().toISOString(),
  files,
  delete: [
    "src/analytics.ts",
    "src/constants.ts",
    "src/storage.ts",
    "src/sync.ts",
    "src/types.ts",
    "public/icon.svg"
  ]
};

await writeFile("deploy-source.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Packed ${Object.keys(files).length} source files into deploy-source.json.`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(fullPath));
    else if (entry.isFile()) output.push(relative(".", fullPath));
  }

  return output.sort();
}
