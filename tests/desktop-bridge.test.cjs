const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { mediaById, registerSelectedMedia, serveMedia, validateVideoPath } = require("../desktop/media.cjs");
const { validateProject } = require("../desktop/project.cjs");

const validProject = {
  schemaVersion: 1,
  projectName: "Test project",
  sequenceName: "Opening scene",
  media: [{ id: "media-1", name: "test.mp4", duration: 3 }],
  clips: [{ id: "clip-1", mediaId: "media-1" }],
  selectedClipId: "clip-1",
  selectedNode: "grade",
  nodes: [{
    id: "grade",
    name: "Color grade",
    type: "COLOR",
    color: "orange",
    icon: "sun",
    detail: "Exposure · +0.35 EV",
  }],
  effects: { exposure: 0.35, glow: 0.28, contrast: 1.08, temperature: 0.12, opacity: 1 },
  playhead: 1.25,
};

test("validates and round-trips the supported project shape", () => {
  assert.equal(validateProject(validProject), validProject);
});

test("rejects projects with dangling clip references or out-of-range effects", () => {
  const missingMedia = structuredClone(validProject);
  missingMedia.clips[0].mediaId = "missing";
  assert.throws(() => validateProject(missingMedia), /clip with missing media/);

  const invalidExposure = structuredClone(validProject);
  invalidExposure.effects.exposure = 8;
  assert.throws(() => validateProject(invalidExposure), /invalid effect settings/);
});

test("rejects invalid graph nodes and duplicate node identities", () => {
  const missingNode = structuredClone(validProject);
  missingNode.nodes[0] = null;
  assert.throws(() => validateProject(missingNode), /invalid compositing node/);

  const duplicate = structuredClone(validProject);
  duplicate.nodes.push({ ...duplicate.nodes[0] });
  assert.throws(() => validateProject(duplicate), /invalid compositing node/);
});

test("serves only registered media and supports byte-range playback", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "frameforge-media-"));
  const mediaPath = path.join(directory, "fixture.mp4");
  await writeFile(mediaPath, Buffer.from("0123456789"));
  context.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(validateVideoPath(path.join(directory, "fixture.txt")), /Unsupported video format/);
  const [media] = await registerSelectedMedia([mediaPath]);
  const response = await serveMedia(
    new Request(`http://media/${media.sourceId}`, { headers: { Range: "bytes=3-6" } }),
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-range"), "bytes 3-6/10");
  assert.equal(await response.text(), "3456");

  const denied = await serveMedia(new Request("http://media/not-registered"));
  assert.equal(denied.status, 404);
  mediaById.delete(media.sourceId);
});
