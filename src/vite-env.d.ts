/// <reference types="vite/client" />

interface Window {
  frameforge?: {
    getAppVersion: () => Promise<string>;
    openMedia: () => Promise<ImportedMedia[]>;
    registerDroppedMedia: (files: File[]) => Promise<ImportedMedia[]>;
    saveProject: (project: ProjectDocument) => Promise<boolean>;
    openProject: () => Promise<ProjectDocument | null>;
    saveExport: (bytes: ArrayBuffer) => Promise<boolean>;
  };
}

interface ImportedMedia {
  sourceId: string;
  name: string;
  mimeType: string;
  url: string;
}

interface ProjectDocument {
  schemaVersion: 1;
  projectName: string;
  sequenceName: string;
  media: Array<{ id: string; name: string; duration: number }>;
  clips: Array<{ id: string; mediaId: string }>;
  selectedClipId: string | null;
  selectedNode: string;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    color: "mint" | "orange" | "violet" | "blue";
    icon: "film" | "sun" | "sparkles" | "layers" | "output";
    detail: string;
  }>;
  effects: {
    exposure: number;
    glow: number;
    contrast: number;
    temperature: number;
    opacity: number;
  };
  playhead: number;
}
