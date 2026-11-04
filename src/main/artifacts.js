const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

/** Content-addressed managed artifact store. External source paths never enter its index. */
class ArtifactService {
  constructor({ app }) {
    this.root = path.join(app.getPath("userData"), "artifacts");
    this.indexPath = path.join(this.root, "index.json");
    this.index = { version: 1, artifacts: [] };
    this.writeQueue = Promise.resolve();
  }

  async initialise() {
    await fs.mkdir(this.root, { recursive: true });
    try { this.index = { ...this.index, ...JSON.parse(await fs.readFile(this.indexPath, "utf8")) }; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }

  list() { return [...this.index.artifacts].sort((left, right) => right.createdAt.localeCompare(left.createdAt)); }
  find(ref) { return this.index.artifacts.find(artifact => artifact.ref === ref) || null; }

  async store({ name, bytes, encoding = "base64", mediaType = "application/octet-stream", origin = "managed", lifecycle = "persistent", parent, operation }) {
    const content = Buffer.from(bytes, encoding);
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const ref = `artifact://${sha256}`;
    const objectPath = path.join(this.root, "objects", sha256);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });
    try { await fs.access(objectPath); } catch { await fs.writeFile(objectPath, content, { mode: 0o600 }); }
    let artifact = this.find(ref);
    if (!artifact) {
      artifact = { ref, displayName: name, mediaType, contentHash: sha256, sizeBytes: content.length, origin, lifecycle, parent: parent || null, operation: operation || null, createdAt: new Date().toISOString() };
      this.index.artifacts.push(artifact);
      await this.persist();
    }
    return artifact;
  }

  async export(ref, destination) {
    const artifact = this.find(ref);
    if (!artifact) throw new Error("Managed artifact was not found.");
    await fs.copyFile(path.join(this.root, "objects", artifact.contentHash), destination);
    return destination;
  }

  async persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      const temporary = `${this.indexPath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(this.index, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.indexPath);
    });
    return this.writeQueue;
  }
}

module.exports = { ArtifactService };
