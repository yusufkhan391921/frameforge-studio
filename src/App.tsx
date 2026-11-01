import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Clock3,
  Command,
  Download,
  Eye,
  Film,
  Focus,
  FolderOpen,
  Grid2X2,
  Hand,
  Layers3,
  LockKeyhole,
  MoreHorizontal,
  Move,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Volume2,
  WandSparkles,
  X,
  Zap,
  ZoomIn,
} from "lucide-react";

type GraphNode = ProjectDocument["nodes"][number];
type MediaAsset = {
  id: string;
  name: string;
  sourceId: string | null;
  url: string | null;
  mimeType: string;
  duration: number;
};
type TimelineClip = ProjectDocument["clips"][number];
type Tool = "select" | "hand";

const initialNodes: GraphNode[] = [
  { id: "source", name: "Footage", type: "MEDIA IN", color: "mint", icon: "film", detail: "No media" },
  { id: "grade", name: "Color grade", type: "COLOR", color: "orange", icon: "sun", detail: "Exposure · +0.35 EV" },
  { id: "glow", name: "Soft glow", type: "EFFECT", color: "violet", icon: "sparkles", detail: "Intensity · 0.28" },
  { id: "comp", name: "Over composite", type: "COMPOSITE", color: "blue", icon: "layers", detail: "Over · 100%" },
  { id: "output", name: "Final output", type: "OUTPUT", color: "mint", icon: "output", detail: "Source resolution" },
];

function NodeIcon({ icon }: { icon: GraphNode["icon"] }) {
  const props = { size: 14, strokeWidth: 1.8 };
  if (icon === "film") return <Film {...props} />;
  if (icon === "sun") return <Sun {...props} />;
  if (icon === "sparkles") return <Sparkles {...props} />;
  if (icon === "layers") return <Layers3 {...props} />;
  return <Eye {...props} />;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  const frames = Math.floor((seconds % 1) * 24).toString().padStart(2, "0");
  return `${mins}:${secs}:${frames}`;
}

function safeDuration(asset: MediaAsset | undefined) {
  return asset?.duration && Number.isFinite(asset.duration) ? asset.duration : 5;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function App() {
  const [nodes, setNodes] = useState(initialNodes);
  const [selectedNode, setSelectedNode] = useState("grade");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [sequenceName, setSequenceName] = useState("Opening scene");
  const [projectName, setProjectName] = useState("Untitled film");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exposure, setExposure] = useState(0.35);
  const [glow, setGlow] = useState(0.28);
  const [contrast, setContrast] = useState(1.08);
  const [temperature, setTemperature] = useState(0.12);
  const [opacity, setOpacity] = useState(1);
  const [activeTab, setActiveTab] = useState<"media" | "nodes">("media");
  const [tool, setTool] = useState<Tool>("select");
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const pendingSeekRef = useRef<{ clipId: string; seconds: number } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const appVersion = useMemo(() => window.frameforge?.getAppVersion(), []);

  const selectedClipIndex = clips.findIndex((clip) => clip.id === selectedClipId);
  const selectedClip = clips[selectedClipIndex];
  const selectedAsset = assets.find((asset) => asset.id === selectedClip?.mediaId);
  const totalDuration = clips.reduce(
    (total, clip) => total + safeDuration(assets.find((asset) => asset.id === clip.mediaId)),
    0,
  );
  const currentClipStart = clips.slice(0, Math.max(0, selectedClipIndex)).reduce(
    (total, clip) => total + safeDuration(assets.find((asset) => asset.id === clip.mediaId)),
    0,
  );
  const selected = nodes.find((node) => node.id === selectedNode) ?? nodes[0];
  const frame = Math.min(totalDuration, currentClipStart + playhead);
  const visibleAssets = assets.filter((asset) => asset.name.toLowerCase().includes(search.toLowerCase()));
  const graphNodes = nodes.map((node) => {
    if (node.id === "source") return { ...node, detail: selectedAsset?.name ?? "No media" };
    if (node.id === "grade") return { ...node, detail: `Exposure · ${exposure > 0 ? "+" : ""}${exposure.toFixed(2)} EV` };
    if (node.id === "glow" || node.name === "Light wrap") return { ...node, detail: `Intensity · ${glow.toFixed(2)}` };
    if (node.id === "output") return { ...node, detail: selectedAsset?.url && videoRef.current?.videoWidth ? `${videoRef.current.videoWidth} × ${videoRef.current.videoHeight}` : "Source resolution" };
    return node;
  });

  function showMessage(message: string) {
    setToast(message);
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const renderFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = "#101513";
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight) / 2;
    const brightness = 2 ** exposure;
    context.filter = `brightness(${brightness}) contrast(${contrast}) sepia(${Math.max(0, temperature) * 0.35}) hue-rotate(${Math.min(0, temperature) * -24}deg) saturate(${1 + Math.abs(temperature) * 0.3})`;
    context.globalAlpha = opacity;
    context.drawImage(video, x, y, drawWidth, drawHeight);
    context.filter = "none";

    if (glow > 0) {
      const glowCanvas = glowCanvasRef.current ?? document.createElement("canvas");
      glowCanvasRef.current = glowCanvas;
      if (glowCanvas.width !== width || glowCanvas.height !== height) {
        glowCanvas.width = width;
        glowCanvas.height = height;
      }
      const glowContext = glowCanvas.getContext("2d");
      if (glowContext) {
        glowContext.filter = `brightness(1.6) blur(${Math.round(glow * 20)}px)`;
        glowContext.drawImage(video, x, y, drawWidth, drawHeight);
        context.globalCompositeOperation = "screen";
        context.globalAlpha = glow * 0.65;
        context.drawImage(glowCanvas, 0, 0);
        context.globalCompositeOperation = "source-over";
        context.globalAlpha = opacity;
      }
    }
    context.globalAlpha = 1;
  }, [contrast, exposure, glow, opacity, temperature]);

  useEffect(() => {
    let animationFrame = 0;
    let lastDraw = 0;
    const draw = (timestamp: number) => {
      if (timestamp - lastDraw >= 1000 / 30 || lastDraw === 0) {
        renderFrame();
        lastDraw = timestamp;
      }
      if (playing) animationFrame = requestAnimationFrame(draw);
    };
    renderFrame();
    if (playing) animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [playing, renderFrame, selectedAsset?.sourceId]);

  useEffect(() => {
    if (!playing || !selectedAsset?.url) return;
    const video = videoRef.current;
    if (!video) return;
    const start = () => {
      void video.play().catch(() => {
        setPlaying(false);
        showMessage(`Could not play ${selectedAsset.name}`);
      });
    };
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      start();
      return;
    }
    video.addEventListener("canplay", start, { once: true });
    return () => video.removeEventListener("canplay", start);
  }, [playing, selectedAsset?.name, selectedAsset?.sourceId, selectedAsset?.url]);

  useEffect(() => {
    const pending = pendingSeekRef.current;
    const video = videoRef.current;
    if (!pending || pending.clipId !== selectedClipId || !video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    video.currentTime = Math.min(pending.seconds, video.duration || pending.seconds);
    setPlayhead(video.currentTime);
    pendingSeekRef.current = null;
  }, [selectedClipId, selectedAsset?.sourceId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchRef.current?.focus();
    }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openProject();
      }
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        void togglePlayback();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function markDirty() {
    setDirty(true);
  }

  function makeProject(): ProjectDocument {
    return {
      schemaVersion: 1,
      projectName,
      sequenceName,
      media: assets.map(({ id, name, duration }) => ({ id, name, duration })),
      clips,
      selectedClipId,
      selectedNode,
      nodes,
      effects: { exposure, glow, contrast, temperature, opacity },
      playhead: frame,
    };
  }

  function updateEffects(next: Partial<ProjectDocument["effects"]>) {
    if (next.exposure !== undefined) setExposure(next.exposure);
    if (next.glow !== undefined) setGlow(next.glow);
    if (next.contrast !== undefined) setContrast(next.contrast);
    if (next.temperature !== undefined) setTemperature(next.temperature);
    markDirty();
  }

  async function saveProject() {
    try {
      const project = makeProject();
      if (window.frameforge) {
        const saved = await window.frameforge.saveProject(project);
        if (!saved) return;
      } else {
        const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${projectName.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "Untitled"}.frameforge`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      }
      setDirty(false);
      showMessage("Project saved");
    } catch (error) {
      showMessage(error instanceof Error ? `Could not save project: ${error.message}` : "Could not save project.");
    }
  }

  function restoreProject(project: ProjectDocument) {
    setProjectName(project.projectName);
    setSequenceName(project.sequenceName);
    setAssets(project.media.map((asset) => ({
      ...asset,
      sourceId: null,
      url: null,
      mimeType: "",
      duration: asset.duration,
    })));
    setClips(project.clips);
    setSelectedClipId(project.selectedClipId);
    const restoredClip = project.clips.find((clip) => clip.id === project.selectedClipId);
    const restoredStart = project.clips.slice(0, Math.max(0, project.clips.findIndex((clip) => clip.id === project.selectedClipId)))
      .reduce((total, clip) => total + (project.media.find((asset) => asset.id === clip.mediaId)?.duration || 5), 0);
    if (restoredClip) {
      pendingSeekRef.current = { clipId: restoredClip.id, seconds: Math.max(0, project.playhead - restoredStart) };
    } else {
      pendingSeekRef.current = null;
    }
    setSelectedNode(project.selectedNode);
    setNodes(project.nodes);
    setExposure(project.effects.exposure);
    setGlow(project.effects.glow);
    setContrast(project.effects.contrast);
    setTemperature(project.effects.temperature);
    setOpacity(project.effects.opacity);
    setPlayhead(restoredClip ? Math.max(0, project.playhead - restoredStart) : 0);
    setDirty(false);
    setPlaying(false);
    showMessage("Project opened — relink its media to continue editing");
  }

  async function openProject() {
    try {
      if (window.frameforge) {
        const project = await window.frameforge.openProject();
        if (project) restoreProject(project);
      } else {
        projectInputRef.current?.click();
      }
    } catch (error) {
      showMessage(error instanceof Error ? `Could not open project: ${error.message}` : "Could not open project.");
    }
  }

  function addImportedMedia(imported: ImportedMedia[]) {
    if (imported.length === 0) return;
    const nextAssets = [...assets];
    const nextClips = [...clips];
    let selectedId = selectedClipId;

    for (const item of imported) {
      const existing = nextAssets.find((asset) => asset.name.toLowerCase() === item.name.toLowerCase());
      if (existing) {
        existing.sourceId = item.sourceId;
        existing.url = item.url;
        existing.mimeType = item.mimeType;
        if (!nextClips.some((clip) => clip.mediaId === existing.id)) {
          const clip = { id: crypto.randomUUID(), mediaId: existing.id };
          nextClips.push(clip);
          selectedId = clip.id;
        } else if (!selectedId) {
          selectedId = nextClips.find((clip) => clip.mediaId === existing.id)?.id ?? null;
        }
      } else {
        const asset = {
          id: crypto.randomUUID(),
          name: item.name,
          sourceId: item.sourceId,
          url: item.url,
          mimeType: item.mimeType,
          duration: 0,
        };
        const clip = { id: crypto.randomUUID(), mediaId: asset.id };
        nextAssets.push(asset);
        nextClips.push(clip);
        selectedId = clip.id;
      }
    }
    setAssets(nextAssets);
    setClips(nextClips);
    setSelectedClipId(selectedId);
    setPlayhead(0);
    setPlaying(false);
    setActiveTab("media");
    markDirty();
    showMessage(imported.length === 1 ? `${imported[0].name} added to the timeline` : `${imported.length} videos added to the timeline`);
  }

  async function importMedia(files?: File[]) {
    try {
      if (window.frameforge) {
        const imported = files
          ? await window.frameforge.registerDroppedMedia(files)
          : await window.frameforge.openMedia();
        addImportedMedia(imported);
      } else if (files?.length) {
        addImportedMedia(files.map((file) => ({
          sourceId: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type || "video/mp4",
          url: URL.createObjectURL(file),
        })));
      } else {
        fileInputRef.current?.click();
      }
    } catch (error) {
      showMessage(error instanceof Error ? `Could not import video: ${error.message}` : "Could not import video.");
    }
  }

  function selectMedia(asset: MediaAsset) {
    if (!asset.url) {
      const clip = clips.find((item) => item.mediaId === asset.id);
      if (clip) setSelectedClipId(clip.id);
      setPlaying(false);
      setPlayhead(0);
      showMessage(`${asset.name} is offline. Relink it by importing the file.`);
      void importMedia();
      return;
    }
    const existing = clips.find((clip) => clip.mediaId === asset.id);
    if (existing) {
      setSelectedClipId(existing.id);
      setPlayhead(0);
      if (videoRef.current) videoRef.current.currentTime = 0;
      return;
    }
    const clip = { id: crypto.randomUUID(), mediaId: asset.id };
    setClips((current) => [...current, clip]);
    setSelectedClipId(clip.id);
    setPlayhead(0);
    markDirty();
  }

  function addNode() {
    const node: GraphNode = {
      id: crypto.randomUUID(),
      name: "Light wrap",
      type: "EFFECT",
      color: "violet",
      icon: "sparkles",
      detail: `Intensity · ${glow.toFixed(2)}`,
    };
    setNodes((current) => [...current.slice(0, -1), node, current[current.length - 1]]);
    setSelectedNode(node.id);
    markDirty();
    showMessage("Light wrap added to the composite");
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video || !selectedAsset?.url) {
      showMessage("Import a video to start playback");
      return;
    }
    if (playing) {
      video.pause();
      setPlaying(false);
    } else {
      try {
        await video.play();
        setPlaying(true);
      } catch {
        showMessage("This video could not be played. Try an MP4, MOV, WebM, or Ogg video.");
      }
    }
  }

  function stepFrame(direction: -1 | 1) {
    const video = videoRef.current;
    if (!video || !selectedAsset?.url) return;
    video.currentTime = Math.max(0, Math.min(safeDuration(selectedAsset), video.currentTime + direction / 24));
  }

  function seekTimeline(seconds: number) {
    let remaining = Math.max(0, seconds);
    for (const clip of clips) {
      const duration = safeDuration(assets.find((asset) => asset.id === clip.mediaId));
      if (remaining <= duration) {
        pendingSeekRef.current = { clipId: clip.id, seconds: remaining };
        if (selectedClipId === clip.id && videoRef.current?.readyState === HTMLMediaElement.HAVE_NOTHING) {
          setPlayhead(remaining);
        }
        setSelectedClipId(clip.id);
        const video = videoRef.current;
        if (selectedClipId === clip.id && video && video.readyState !== HTMLMediaElement.HAVE_NOTHING) {
          video.currentTime = remaining;
          setPlayhead(remaining);
          pendingSeekRef.current = null;
        }
        return;
      }
      remaining -= duration;
    }
    const lastClip = clips.at(-1);
    if (lastClip) {
      const lastDuration = safeDuration(assets.find((asset) => asset.id === lastClip.mediaId));
      pendingSeekRef.current = { clipId: lastClip.id, seconds: lastDuration };
      setSelectedClipId(lastClip.id);
      setPlayhead(lastDuration);
    }
  }

  function updateMediaDuration(mediaId: string, duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    setAssets((current) => current.map((asset) => asset.id === mediaId ? { ...asset, duration } : asset));
  }

  async function exportSequence() {
    setShowExport(false);
    if (!clips.length || assets.some((asset) => !asset.url && clips.some((clip) => clip.mediaId === asset.id))) {
      showMessage("Import or relink every timeline clip before exporting");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || typeof MediaRecorder === "undefined" || !canvas.captureStream) {
      showMessage("WebM export is unavailable in this environment");
      return;
    }
    try {
      setPlaying(false);
      videoRef.current?.pause();
      setSelectedClipId(clips[0].id);
      setPlayhead(0);
      pendingSeekRef.current = { clipId: clips[0].id, seconds: 0 };
      const firstAsset = assets.find((asset) => asset.id === clips[0].mediaId);
      if (!firstAsset?.url) throw new Error("The first timeline clip is offline.");
      const deadline = Date.now() + 15000;
      let video: HTMLVideoElement | null = null;
      while (Date.now() < deadline) {
        video = videoRef.current;
        if (video?.currentSrc === new URL(firstAsset.url, window.location.href).href && video.readyState >= HTMLMediaElement.HAVE_METADATA) break;
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) {
        throw new Error("Timed out waiting for the first video to load.");
      }
      video.currentTime = 0;
      const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This platform does not provide a WebM encoder.");
      const stream = canvas.captureStream(24);
      const captureVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream };
      const sourceStream = captureVideo.captureStream?.() ?? null;
      sourceStream?.getAudioTracks().forEach((track) => stream.addTrack(track));
      const recorder = new MediaRecorder(stream, { mimeType });
      recordingChunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => { void finishExport(mimeType); };
      recorder.start(1000);
      setExporting(true);
      if (selectedClipId === clips[0].id) {
        video.currentTime = 0;
        setPlayhead(0);
      }
      await video.play();
      setPlaying(true);
      showMessage("Rendering the sequence to WebM");
    } catch (error) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      recordingChunksRef.current = [];
      setExporting(false);
      showMessage(error instanceof Error ? `Could not start export: ${error.message}` : "Could not start export.");
    }
  }

  async function finishExport(mimeType: string) {
    setPlaying(false);
    setExporting(false);
    recorderRef.current = null;
    const blob = new Blob(recordingChunksRef.current, { type: mimeType });
    recordingChunksRef.current = [];
    if (!blob.size) {
      showMessage("The render did not produce any video frames");
      return;
    }
    if (blob.size > 150 * 1024 * 1024) {
      showMessage("Export exceeds the 150 MB limit. Shorten the sequence and try again.");
      return;
    }
    try {
      if (window.frameforge) {
        const saved = await window.frameforge.saveExport(await blob.arrayBuffer());
        if (saved) showMessage("WebM export saved");
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${projectName.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "FrameForge-export"}.webm`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        showMessage("WebM export downloaded");
      }
    } catch (error) {
      showMessage(error instanceof Error ? `Could not save export: ${error.message}` : "Could not save export.");
    }
  }

  function onVideoEnded() {
    const nextClip = clips[selectedClipIndex + 1];
    if (nextClip) {
      if (nextClip.mediaId === selectedClip?.mediaId) {
        pendingSeekRef.current = null;
        if (videoRef.current) videoRef.current.currentTime = 0;
      } else {
        pendingSeekRef.current = { clipId: nextClip.id, seconds: 0 };
      }
      setSelectedClipId(nextClip.id);
      setPlayhead(0);
      return;
    }
    setPlaying(false);
    if (exporting) recorderRef.current?.stop();
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDraggingFiles(true);
  }

  async function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|ogv)$/i.test(file.name));
    if (!files.length) {
      showMessage("Drop a supported video file to import it");
      return;
    }
    await importMedia(files);
  }

  const mediaVideo = selectedAsset?.url ? (
    <video
      key={selectedAsset.sourceId}
      ref={videoRef}
      className="media-source"
      src={selectedAsset.url}
      crossOrigin="anonymous"
      preload="auto"
      playsInline
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        updateMediaDuration(selectedAsset.id, video.duration);
        const pending = pendingSeekRef.current;
        if (pending?.clipId === selectedClipId) {
          video.currentTime = Math.min(pending.seconds, video.duration || pending.seconds);
          setPlayhead(video.currentTime);
          pendingSeekRef.current = null;
        } else if (selectedAsset.duration === 0) {
          video.currentTime = 0;
          setPlayhead(0);
        }
        renderFrame();
      }}
      onLoadedData={renderFrame}
      onTimeUpdate={(event) => {
        const nextTime = event.currentTarget.currentTime;
        setPlayhead(nextTime);
        markDirty();
        renderFrame();
      }}
      onEnded={onVideoEnded}
      onError={() => {
        setPlaying(false);
        showMessage(`Could not decode ${selectedAsset.name}. Try an H.264 MP4 or WebM file.`);
      }}
    />
  ) : null;

  return (
    <main className="app-shell" onDragOver={onDragOver} onDrop={(event) => { void onDrop(event); }} onDragLeave={() => setDraggingFiles(false)}>
      {mediaVideo}
      <input ref={fileInputRef} className="hidden-input" type="file" accept="video/mp4,video/quicktime,video/webm,video/ogg,.m4v" multiple onChange={(event) => { void importMedia(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
      <input ref={projectInputRef} className="hidden-input" type="file" accept=".frameforge,application/json" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void file.text().then((text) => restoreProject(JSON.parse(text) as ProjectDocument)).catch(() => showMessage("This is not a valid FrameForge project file."));
        event.currentTarget.value = "";
      }} />
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark"><span /><span /><span /></div>
          <span className="brand-name">frameforge</span>
          <span className="brand-divider" />
          <button className="project-name" onClick={() => { const name = window.prompt("Project name", projectName); if (name?.trim()) { setProjectName(name.trim()); markDirty(); } }}>{projectName} <ChevronDown size={13} /></button>
          <span className={`save-state ${dirty ? "unsaved" : ""}`}><span className="status-dot" /> {dirty ? "Unsaved changes" : "Project ready"}</span>
        </div>
        <div className="titlebar-actions">
          <button className="quiet-button version-button" title={`FrameForge ${appVersion ?? "browser preview"}`}><Command size={13} /> {appVersion ? "Studio" : "Preview"}</button>
          <button className="quiet-button project-action" onClick={() => { void openProject(); }} title="Open project"><FolderOpen size={13} /> Open</button>
          <button className="quiet-button project-action" onClick={() => { void saveProject(); }} title="Save project (⌘S)"><Download size={13} /> Save</button>
          <button className="share-button" onClick={() => setShowExport(true)} disabled={exporting}>
            {exporting ? <><span className="export-spinner" /> Rendering</> : <><Download size={14} /> Export <ChevronDown size={12} /></>}
          </button>
          <button className="avatar" title="Your workspace">Y</button>
        </div>
      </header>

      <div className="workspace">
        <nav className="tool-rail" aria-label="Workspace tools">
          <div className="rail-group">
            <button className="rail-button active" title="Compositing"><Layers3 size={17} /></button>
            <button className="rail-button" title="Edit"><Clapperboard size={17} /></button>
            <button className="rail-button" title="Color"><Sun size={17} /></button>
            <button className="rail-button" title="Audio"><AudioLines size={17} /></button>
          </div>
          <div className="rail-bottom">
            <button className="rail-button" title="Help"><CircleHelp size={17} /></button>
            <button className="rail-button" title="Settings"><Settings2 size={17} /></button>
            <div className="rail-user">Y</div>
          </div>
        </nav>

        <section className={`library-panel ${draggingFiles ? "drop-target" : ""}`}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PROJECT</span>
              <h1>{projectName} <span className="heading-caret">⌄</span></h1>
            </div>
            <button className="icon-button" title="Project options"><MoreHorizontal size={17} /></button>
          </div>
          <div className="project-stats">
            <div><span>SEQUENCE</span><strong>{sequenceName}</strong></div>
            <div><span>FORMAT</span><strong>24 fps · WebM</strong></div>
          </div>
          <div className="panel-tabs">
            <button className={activeTab === "media" ? "selected" : ""} onClick={() => setActiveTab("media")}>Media <span>{assets.length.toString().padStart(2, "0")}</span></button>
            <button className={activeTab === "nodes" ? "selected" : ""} onClick={() => setActiveTab("nodes")}>Effects</button>
          </div>
          <label className="search-field"><Search size={14} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeTab === "media" ? "Find media..." : "Find an effect..."} /><kbd>⌘ K</kbd></label>
          {activeTab === "media" ? (
            <div className="media-list">
              <div className="section-label"><span>SEQUENCE</span><ChevronDown size={13} /></div>
              <div className="sequence-card">
                <div className="sequence-thumb"><div className="sequence-mountains" /></div>
                <span><strong>{sequenceName}</strong><small>{formatDuration(totalDuration)} · {clips.length} {clips.length === 1 ? "clip" : "clips"}</small></span>
                <button className="icon-button" onClick={() => { const name = window.prompt("Sequence name", sequenceName); if (name?.trim()) { setSequenceName(name.trim()); markDirty(); } }} title="Rename sequence"><MoreHorizontal size={15} /></button>
              </div>
              <div className="section-label media-label"><span>MEDIA POOL</span><button className="tiny-add" onClick={() => { void importMedia(); }} title="Import videos"><Plus size={14} /></button></div>
              {visibleAssets.map((asset) => (
                <button className={`media-row ${asset.id === selectedAsset?.id ? "media-selected" : ""}`} key={asset.id} onClick={() => selectMedia(asset)}>
                  <div className={`media-thumb ${asset.url ? "arctic" : "offline-thumb"}`}>
                    {asset.url ? <div className="thumb-landscape" /> : <FolderOpen size={16} />}
                    {asset.duration > 0 && <span className="duration-badge">{formatDuration(asset.duration)}</span>}
                  </div>
                  <span><strong>{asset.name}</strong><small>{asset.url ? `${asset.mimeType.replace("video/", "").toUpperCase()} · ${asset.duration ? formatDuration(asset.duration) : "READY"}` : "OFFLINE · RELINK"}</small></span>
                  <MoreHorizontal size={14} />
                </button>
              ))}
              {assets.length === 0 && <p className="empty-media">Your media will appear here. Import video to start editing.</p>}
              <button className="import-card" onClick={() => { void importMedia(); }}>
                <FolderOpen size={15} /> Import video <span>or drop files</span>
              </button>
              <div className="library-hint"><Sparkles size={14} /><span>Local media stays on your device. Project files store edit decisions, not video copies.</span></div>
            </div>
          ) : (
            <div className="effect-list">
              <div className="section-label"><span>FAVORITES</span><ChevronDown size={13} /></div>
              {["Color grade", "Soft glow", "Light wrap", "Lens blur", "Film grain"].map((effect, index) => (
                <button className="effect-row" key={effect} onClick={addNode}>
                  <span className={`effect-icon tone-${index}`}><WandSparkles size={14} /></span>{effect}<Plus size={13} />
                </button>
              ))}
              <div className="library-hint"><Zap size={14} /><span>Exposure, contrast, temperature, and glow are live preview effects.</span></div>
            </div>
          )}
          <div className="library-footer"><span><span className="green-dot" /> LOCAL PROJECT</span><button className="icon-button" title="Project settings"><Settings2 size={14} /></button></div>
        </section>

        <section className="editor">
          <div className="editor-toolbar">
            <div className="breadcrumb"><span>{projectName}</span><ChevronRight size={13} /><strong>{sequenceName}</strong><ChevronDown size={12} /></div>
            <div className="toolbar-center">
              <span className="live-indicator" /> VIEWER <span className="toolbar-separator" /> {selectedAsset ? `${Math.round((videoRef.current?.videoWidth ?? 0) / 10) * 10} × ${Math.round((videoRef.current?.videoHeight ?? 0) / 10) * 10}` : "PREVIEW"} <ChevronDown size={11} />
            </div>
            <div className="toolbar-tools">
              <button className={`tool-toggle ${tool === "select" ? "tool-active" : ""}`} onClick={() => setTool("select")} title="Select"><Move size={14} /></button>
              <button className={`tool-toggle ${tool === "hand" ? "tool-active" : ""}`} onClick={() => setTool("hand")} title="Pan"><Hand size={14} /></button>
              <span className="toolbar-separator" />
              <button className="tool-toggle" title="Viewer guides"><Grid2X2 size={14} /></button>
              <button className="tool-toggle" title="Viewer focus"><Focus size={14} /></button>
            </div>
          </div>

          <div className="viewer">
            <div className="viewer-meta"><span><span className="record-dot" /> COMPOSITE VIEW</span><span>{selectedAsset ? `${videoRef.current?.videoWidth || "—"} × ${videoRef.current?.videoHeight || "—"}` : "Import a video"} <span className="meta-divider">/</span> WEBM</span></div>
            <div className="preview-stage">
              <div className="preview-image">
                {selectedAsset?.url ? (
                  <canvas ref={canvasRef} className="composite-preview" width={960} height={540} aria-label={`Live composite preview of ${selectedAsset.name}`} />
                ) : (
                  <div className="empty-preview"><div className="empty-preview-art"><div className="sequence-mountains" /><div className="preview-aurora" /></div><div><strong>{selectedAsset ? "Media offline" : "Your next great frame starts here"}</strong><span>{selectedAsset ? "Import the source file to relink this clip" : "Drop a video here or import one from your media pool"}</span><button onClick={() => { void importMedia(); }}><Plus size={13} /> Import video</button></div></div>
                )}
                {selectedAsset?.url && <div className="frame-overlay"><span>{formatTime(frame)}</span><span>LIVE · {selectedAsset.mimeType.replace("video/", "").toUpperCase()}</span></div>}
                <div className="crosshair"><span /><span /></div>
                <div className="focus-corner top-left" /><div className="focus-corner top-right" /><div className="focus-corner bottom-left" /><div className="focus-corner bottom-right" />
              </div>
            </div>
            <div className="viewer-controls">
              <div className="transport">
                <button onClick={() => stepFrame(-1)} title="Previous frame"><ChevronLeft size={15} /></button>
                <button className="play-button" onClick={() => { void togglePlayback(); }} title={playing ? "Pause" : "Play"}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
                <button onClick={() => stepFrame(1)} title="Next frame"><ChevronRight size={15} /></button>
              </div>
              <span className="timecode">{formatTime(frame)} <span>/ {formatTime(totalDuration)}</span></span>
              <div className="viewer-utility"><button title="Viewer zoom"><ZoomIn size={15} /></button><button title="Viewer options"><MoreHorizontal size={16} /></button></div>
            </div>
          </div>

          <section className="graph-panel">
            <div className="graph-heading">
              <div className="graph-title"><span className="graph-title-icon"><Box size={14} /></span><strong>Node graph</strong><span className="graph-count">{nodes.length} nodes</span><span className="graph-mode">COMPOSITE 01</span></div>
              <div className="graph-actions"><span className="graph-shortcut"><Command size={11} /> ↵ to add node</span><button className="graph-add" onClick={addNode}><Plus size={14} /> Add node</button><button className="icon-button" title="Graph options"><MoreHorizontal size={16} /></button></div>
            </div>
            <div className="graph-canvas">
              <div className="graph-grid" />
              <svg className="graph-connections" aria-hidden="true">
                {nodes.slice(0, -1).map((node, index) => {
                  const start = index * 190 + 142;
                  const end = (index + 1) * 190;
                  return <g key={`${node.id}-connection`}><path d={`M ${start} 106 C ${start + 32} 106, ${end - 32} 106, ${end} 106`} className="connection-shadow" /><path d={`M ${start} 106 C ${start + 32} 106, ${end - 32} 106, ${end} 106`} className="connection-line" /><circle cx={start} cy="106" r="3" className="port-dot" /></g>;
                })}
              </svg>
              <div className="node-row">
                {graphNodes.map((node) => (
                  <button className={`graph-node ${selectedNode === node.id ? "node-selected" : ""}`} key={node.id} onClick={() => setSelectedNode(node.id)}>
                    <span className={`node-icon node-${node.color}`}><NodeIcon icon={node.icon} /></span>
                    <span className="node-copy"><small>{node.type}</small><strong>{node.name}</strong><em>{node.detail}</em></span>
                    <span className="node-port" />
                  </button>
                ))}
              </div>
              <div className="graph-zoom"><button title="Zoom out">−</button><span>72%</span><button title="Zoom in">+</button><span className="zoom-separator" /><button title="Fit graph"><Focus size={13} /></button></div>
            </div>
          </section>
        </section>

        <aside className="inspector">
          <div className="inspector-heading"><div><span className="eyebrow">INSPECTOR</span><h2>Properties</h2></div><button className="icon-button" title="Inspector options"><SlidersHorizontal size={15} /></button></div>
          <div className="selected-card">
            <span className={`node-icon node-${selected.color}`}><NodeIcon icon={selected.icon} /></span>
            <span><strong>{selected.name}</strong><small>{selected.type} NODE</small></span>
            <button className="icon-button" title="More node options"><MoreHorizontal size={15} /></button>
          </div>
          <div className="inspector-section">
            <div className="inspector-section-title"><span>COLOR & EFFECTS</span><ChevronDown size={13} /></div>
            <label className="control-label"><span>Exposure</span><span className="control-value">{exposure > 0 ? "+" : ""}{exposure.toFixed(2)} <small>EV</small></span></label>
            <input aria-label="Exposure" className="range-control" type="range" min="-2" max="2" step="0.01" value={exposure} onChange={(event) => updateEffects({ exposure: Number(event.target.value) })} />
            <label className="control-label temperature-label"><span>Temperature</span><span className="control-value">{temperature > 0 ? "+" : ""}{Math.round(temperature * 2000)} <small>K</small></span></label>
            <input aria-label="Temperature" className="range-control temperature-control" type="range" min="-1" max="1" step="0.01" value={temperature} onChange={(event) => updateEffects({ temperature: Number(event.target.value) })} />
            <label className="control-label contrast-label"><span>Contrast</span><span className="control-value">{contrast.toFixed(2)}</span></label>
            <input aria-label="Contrast" className="range-control" type="range" min="0.5" max="1.5" step="0.01" value={contrast} onChange={(event) => updateEffects({ contrast: Number(event.target.value) })} />
            <label className="control-label contrast-label"><span>Soft glow</span><span className="control-value">{glow.toFixed(2)}</span></label>
            <input aria-label="Soft glow" className="range-control" type="range" min="0" max="1" step="0.01" value={glow} onChange={(event) => updateEffects({ glow: Number(event.target.value) })} />
          </div>
          <div className="inspector-section blend-section">
            <div className="inspector-section-title"><span>BLENDING</span><ChevronDown size={13} /></div>
            <div className="blend-selector"><span>Screen · glow</span><ChevronDown size={13} /></div>
            <label className="control-label opacity-label"><span>Composite opacity</span><span className="control-value">{Math.round(opacity * 100)} <small>%</small></span></label>
            <input aria-label="Composite opacity" className="range-control" type="range" min="0" max="1" step="0.01" value={opacity} onChange={(event) => { setOpacity(Number(event.target.value)); markDirty(); }} />
          </div>
          <div className="inspector-section transform-section">
            <div className="inspector-section-title"><span>TRANSFORM</span><ChevronDown size={13} /></div>
            <div className="transform-row"><span>Position</span><div><span>X <b>0</b></span><span>Y <b>0</b></span></div><button title="Lock position"><LockKeyhole size={12} /></button></div>
            <div className="transform-row"><span>Scale</span><div><span className="scale-value">X <b>100</b></span><span>Y <b>100</b></span></div><button title="Link scale"><LockKeyhole size={12} /></button></div>
          </div>
          <div className="inspector-footer"><span><span className="green-dot" /> {selectedAsset?.url ? "LIVE PREVIEW" : "WAITING FOR MEDIA"}</span><span>{selectedAsset ? "Canvas · 960 × 540" : "No source"}</span></div>
        </aside>
      </div>

      <footer className="timeline">
        <div className="timeline-header">
          <div className="timeline-name"><Clapperboard size={14} /><strong>{sequenceName}</strong><span className="timeline-badge">24 fps</span><ChevronDown size={12} /></div>
          <div className="timeline-tools"><button title="Timeline settings"><Settings2 size={14} /></button><span /><button title="Zoom out">−</button><input aria-label="Timeline zoom" type="range" min="0" max="100" defaultValue="43" /><button title="Zoom in">+</button><button className="timeline-fit" title="Fit timeline"><Focus size={13} /></button></div>
        </div>
        <div className="timeline-body">
          <div className="track-labels">
            <div className="track-label"><span className="track-visibility"><Eye size={13} /></span><span className="track-type video-track"><Film size={13} /></span><strong>V1</strong><span>Footage</span><MoreHorizontal size={14} /></div>
            <div className="track-label"><span className="track-visibility"><Eye size={13} /></span><span className="track-type effect-track"><Sparkles size={13} /></span><strong>FX</strong><span>Composite</span><MoreHorizontal size={14} /></div>
            <div className="track-label"><span className="track-visibility"><Volume2 size={13} /></span><span className="track-type audio-track"><AudioLines size={13} /></span><strong>A1</strong><span>Source audio</span><MoreHorizontal size={14} /></div>
          </div>
          <div className="track-area">
            <div className="ruler" onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (totalDuration > 0) seekTimeline(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * totalDuration);
            }}>
              {Array.from({ length: 9 }, (_, i) => <span key={i} style={{ left: `${i * 12.5}%` }}>{formatDuration(totalDuration * i / 8)}</span>)}
              <div className="playhead" style={{ left: `${totalDuration ? Math.min(100, (frame / totalDuration) * 100) : 0}%` }}><i /></div>
            </div>
            <div className="track-lane clip-lane">
              {clips.map((clip) => {
                const asset = assets.find((item) => item.id === clip.mediaId);
                const duration = safeDuration(asset);
                const left = clips.slice(0, clips.indexOf(clip)).reduce((sum, item) => sum + safeDuration(assets.find((mediaItem) => mediaItem.id === item.mediaId)), 0);
                return (
                  <button className={`clip clip-video ${clip.id === selectedClipId ? "clip-selected" : ""} ${asset?.url ? "" : "clip-offline"}`} key={clip.id} style={{ left: `${totalDuration ? left / totalDuration * 100 : 0}%`, width: `${totalDuration ? Math.max(3, duration / totalDuration * 100) : 95}%` }} onClick={() => { setSelectedClipId(clip.id); setPlayhead(0); }}>
                    <div className="clip-preview"><span /><span /><span /><span /></div>
                    <div className="clip-content"><strong>{asset?.name ?? "Offline media"}</strong><small>{formatTime(left)} — {formatTime(left + duration)}</small></div>
                    <span className="clip-end">{asset?.url ? "VIDEO" : "OFFLINE"}</span>
                  </button>
                );
              })}
              {!clips.length && <button className="timeline-empty" onClick={() => { void importMedia(); }}><Plus size={13} /> Import a video to begin editing</button>}
              <div className="playhead-line" style={{ left: `${totalDuration ? Math.min(100, (frame / totalDuration) * 100) : 0}%` }} />
            </div>
            <div className="track-lane fx-lane">
              {clips.length > 0 && <div className="clip clip-effect" style={{ left: 0, width: "100%" }}><span className="effect-clip-icon"><Sparkles size={12} /></span><span><strong>Composite · {nodes.length} nodes</strong><small>Live preview effects</small></span></div>}
              <div className="playhead-line" style={{ left: `${totalDuration ? Math.min(100, (frame / totalDuration) * 100) : 0}%` }} />
            </div>
            <div className="track-lane audio-lane">
              {selectedAsset?.url && <div className="clip clip-audio" style={{ left: `${totalDuration ? currentClipStart / totalDuration * 100 : 0}%`, width: `${totalDuration ? Math.max(3, safeDuration(selectedAsset) / totalDuration * 100) : 95}%` }}><div className="waveform">{Array.from({ length: 68 }, (_, i) => <i key={i} style={{ height: `${18 + ((i * 37 + i * i * 13) % 70)}%` }} />)}</div><span className="audio-name">{selectedAsset.name} · source audio</span></div>}
              <div className="playhead-line" style={{ left: `${totalDuration ? Math.min(100, (frame / totalDuration) * 100) : 0}%` }} />
            </div>
          </div>
        </div>
      </footer>

      <div className="statusbar"><span><span className="green-dot" /> {exporting ? "Rendering" : selectedAsset?.url ? "Ready" : "Import video to start"}</span><span><Clock3 size={12} /> {dirty ? "Unsaved changes" : "Project saved"}</span><span className="status-spacer" /><span>{projectName} / {sequenceName}</span><span>{selectedAsset ? `${Math.round((videoRef.current?.videoWidth ?? 0) / 10) * 10} × ${Math.round((videoRef.current?.videoHeight ?? 0) / 10) * 10}` : "No media"}</span><span>24 fps</span></div>

      {draggingFiles && <div className="drop-overlay"><div><FolderOpen size={26} /><strong>Drop video to import</strong><span>MP4 · MOV · WebM · Ogg</span></div></div>}
      {toast && <div className="toast"><span className="green-dot" />{toast}<button onClick={() => setToast("")} aria-label="Dismiss"><X size={14} /></button></div>}
      {showExport && <div className="modal-backdrop" onClick={() => setShowExport(false)}><div className="export-modal" onClick={(event) => event.stopPropagation()}><div className="export-title"><div><span className="eyebrow">DELIVERY</span><h2>Export your composite</h2></div><button className="icon-button" onClick={() => setShowExport(false)} aria-label="Close"><X size={17} /></button></div><div className="export-preview"><div className="export-thumb"><div className="sequence-mountains" /></div><div><strong>{sequenceName}</strong><small>{totalDuration ? `${formatDuration(totalDuration)} · 24 fps · WebM` : "Add a video before exporting"}</small></div></div><label className="export-label">FORMAT<div className="blend-selector">WebM · VP9 / VP8 <ChevronDown size={13} /></div></label><label className="export-label">RENDER<div className="blend-selector">Composite effects · source audio <ChevronDown size={13} /></div></label><button className="export-primary" onClick={() => { void exportSequence(); }} disabled={!clips.length || exporting}><Download size={15} /> Render WebM</button><p>Exports the current sequence with live color/glow effects and clip audio. Maximum size: 150 MB.</p></div></div>}
    </main>
  );
}

export default App;
