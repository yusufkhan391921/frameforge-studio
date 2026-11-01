# FrameForge Studio

A compositing-first desktop video editor starter built with Electron, React, and TypeScript. Import local video, assemble a simple sequence, preview live color/glow adjustments, save project files, and render WebM.

## Run it

Requires Node.js 22.12+, 24.x, or 26.x.

```sh
npm install
npm run dev
```

`npm run build` type-checks and builds the renderer. `npm start` builds it and opens the desktop app. `npm test` checks project-file validation and the ranged local-media protocol.

## Make a video

1. Run `npm run dev`.
2. Select **Import video**, or drop video files into the app. Supported containers: MP4, M4V, MOV, WebM, and Ogg. Codec support depends on the operating system; H.264 MP4 and WebM are the best starting points.
3. Use the timeline to select clips or seek. Playback continues into the next clip.
4. Adjust exposure, temperature, contrast, glow, and composite opacity in the inspector.
5. Select **Export → Render WebM**. Export uses the live composite and source-video audio, when available. Output is capped at 150 MB.
6. Save a `.frameforge` project. Project files store media names and edit settings—not video files. After reopening, import the source videos again to relink them.

The viewer composites frames in a bounded 960 × 540 canvas and records at 24 fps. This is a working starter editor, not yet a replacement for a full nonlinear editor or a color-managed mastering tool.

## Project map

- `src/`: React renderer and studio layout.
- `desktop/main.cjs`: Electron window lifecycle and IPC handlers.
- `desktop/preload.cjs`: narrow, context-isolated bridge.
- `desktop/media.cjs`: allowlisted media registration and byte-range protocol.
- `desktop/project.cjs`: versioned project-document validation.
- `tests/desktop-bridge.test.cjs`: project and local-media bridge tests.
- `docs/architecture.md`: architecture boundaries and next milestones.

## Security baseline

The renderer has no Node.js integration. Electron enables context isolation and sandboxing. The main process serves only media explicitly selected through a native file dialog or dragged into the app; the preload exposes narrow import, project, and export operations. Project files are validated before use, and new windows or external navigation are denied.
