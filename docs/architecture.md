# FrameForge Studio architecture

## Product direction

FrameForge is a compositing-first video studio: an editable node graph is the primary creative model, while clips, tracks, and keyframes provide editorial timing. The differentiator is a shared, inspectable graph from desktop compositing through final delivery, not a promise that this starter already replaces an established NLE.

## Current starter

The Electron shell supports local video import, byte-range streaming over an opaque application URL, sequential clip playback/scrubbing, live canvas exposure/temperature/contrast/glow, versioned project JSON, and WebM recording. The preview/export canvas is capped at 960 × 540 and export at 150 MB. Source-video audio is included when the platform exposes it to `captureStream`.

This is a deliberately small functional editing slice, not a production nonlinear editor: there is no trimming, transitions, multiple video tracks, color-managed HDR, GPU render service, proxy generation, waveform analysis, recovery journal, or professional codec/export pipeline. Project files do not bundle source media; reopening marks sources offline until the user imports them again.

## Proposed production boundaries

```text
┌──────────────────── Electron desktop shell ───────────────────┐
│ React renderer                                                 │
│ timeline · node editor · inspector · viewer · accessible UI    │
│                 │ typed, validated IPC                         │
│                 ▼                                              │
│ Main process                                                    │
│ project lifecycle · permissions · media catalog · job control  │
│                 │ versioned messages                            │
│                 ▼                                              │
│ Render service (separate process)                              │
│ graph evaluation · GPU effects · frame cache · export           │
└───────────────────────────────────────────────────────────────┘
```

- **Renderer:** React editor state and a bounded preview/export canvas. The renderer receives opaque media URLs rather than file paths and has no Node.js APIs.
- **Project model:** versioned, declarative documents for sequences, tracks, clips, graph nodes, keyframes, media references, and color settings. Changes should be undoable commands; graphs should support cycle validation and stable node IDs.
- **Main process:** owns native dialogs, project file access, media registration, and export writes. IPC validates project documents and output sizes; filesystem paths stay in the main process.
- **Render service:** isolate decoding and rendering from UI responsiveness. Begin with FFmpeg for broad demux/decode/encode support; define a versioned frame and effect interface before selecting a GPU backend. Evaluate Metal on macOS and Vulkan/DX12 on other targets behind a common renderer abstraction.
- **Interchange:** keep source media immutable; store edits and graph parameters non-destructively. Plan explicit project migrations and export profiles rather than relying on opaque runtime state.

## Quality attributes

- **Responsive editing:** playback and graph evaluation are asynchronous, cancellable jobs with bounded queues and observable progress.
- **Reliability:** periodic atomic project snapshots, render-job recovery, media relinking, and golden-image tests for deterministic effects.
- **Color correctness:** document working space and display transform; validate HDR/SDR paths and metadata before claiming color-managed parity.
- **Security:** strict renderer isolation, least-privilege IPC, validated project inputs, patched media libraries, and no shell interpolation for media commands.
- **Cross-platform:** package and test Windows, macOS, and Linux separately; native GPU and codec capabilities remain explicit and discoverable.

## Delivery sequence

1. **Editing:** clip trim handles, multiple tracks, transitions, undo/redo, autosave, and portable media relinking.
2. **Preview:** frame-accurate seeking, waveform generation, proxies, and GPU-accelerated effect evaluation.
3. **Compositing:** editable typed graph connections, masks, transforms, keyframes, and cache invalidation.
4. **Delivery:** background render jobs, cancellation/resume, export presets, audio muxing, and verified output metadata.
5. **Hardening:** project recovery, large-media performance, accessibility, platform packaging, security review, and regression fixtures.

Each milestone needs measurable acceptance tests before expansion. In particular, benchmark playback under representative 4K media, compare render output to golden frames, and test project migrations across supported app versions.
