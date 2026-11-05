const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = [
  "src/main/main.js", "src/main/runtime.js", "src/main/adapters.js", "src/main/preload.js",
  "src/renderer/app.js", "src/renderer/modules.js"
];

for (const entry of fs.readdirSync(path.join(root, "modules"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const renderer = path.join(root, "modules", entry.name, "renderer.js");
  if (fs.existsSync(renderer)) files.push(path.relative(root, renderer));
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
