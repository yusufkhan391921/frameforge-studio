function validateProject(project) {
  if (
    !project ||
    typeof project !== "object" ||
    project.schemaVersion !== 1 ||
    typeof project.projectName !== "string" ||
    !project.projectName.trim() ||
    project.projectName.length > 120 ||
    typeof project.sequenceName !== "string" ||
    !project.sequenceName.trim() ||
    project.sequenceName.length > 120 ||
    !Array.isArray(project.media) ||
    project.media.length > 200 ||
    !Array.isArray(project.clips) ||
    project.clips.length > 500 ||
    !Array.isArray(project.nodes) ||
    project.nodes.length === 0 ||
    project.nodes.length > 50 ||
    !project.effects ||
    typeof project.effects !== "object" ||
    Array.isArray(project.effects) ||
    !Number.isFinite(project.playhead)
  ) {
    throw new Error("This is not a supported FrameForge project file.");
  }

  const mediaIds = new Set();
  for (const item of project.media) {
    if (
      !item ||
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      item.id.length > 80 ||
      typeof item.name !== "string" ||
      item.name.length === 0 ||
      item.name.length > 255 ||
      !Number.isFinite(item.duration) ||
      item.duration < 0 ||
      item.duration > 86400 ||
      mediaIds.has(item.id)
    ) {
      throw new Error("The project contains an invalid media entry.");
    }
    mediaIds.add(item.id);
  }

  const clipIds = new Set();
  for (const clip of project.clips) {
    if (
      !clip ||
      typeof clip.id !== "string" ||
      clip.id.length === 0 ||
      clip.id.length > 80 ||
      typeof clip.mediaId !== "string" ||
      !mediaIds.has(clip.mediaId) ||
      clipIds.has(clip.id)
    ) {
      throw new Error("The project contains a clip with missing media.");
    }
    clipIds.add(clip.id);
  }

  const nodeIds = new Set();
  for (const node of project.nodes) {
    if (
      !node ||
      typeof node.id !== "string" ||
      node.id.length === 0 ||
      node.id.length > 80 ||
      nodeIds.has(node.id) ||
      typeof node.name !== "string" ||
      node.name.length > 120 ||
      typeof node.type !== "string" ||
      node.type.length > 40 ||
      !["film", "sun", "sparkles", "layers", "output"].includes(node.icon) ||
      !["mint", "orange", "violet", "blue"].includes(node.color) ||
      typeof node.detail !== "string" ||
      node.detail.length > 255
    ) {
      throw new Error("The project contains an invalid compositing node.");
    }
    nodeIds.add(node.id);
  }

  if (
    (project.selectedClipId !== null && !clipIds.has(project.selectedClipId)) ||
    typeof project.selectedNode !== "string" ||
    !nodeIds.has(project.selectedNode) ||
    project.playhead < 0 ||
    project.playhead > 86400
  ) {
    throw new Error("The project contains an invalid selection or playhead.");
  }

  const { exposure, glow, contrast, temperature, opacity } = project.effects;
  if (
    !Number.isFinite(exposure) ||
    exposure < -2 ||
    exposure > 2 ||
    !Number.isFinite(glow) ||
    glow < 0 ||
    glow > 1 ||
    !Number.isFinite(contrast) ||
    contrast < 0.5 ||
    contrast > 1.5 ||
    !Number.isFinite(temperature) ||
    temperature < -1 ||
    temperature > 1 ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1
  ) {
    throw new Error("The project contains invalid effect settings.");
  }
  return project;
}

module.exports = { validateProject };
