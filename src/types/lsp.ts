export type LspLanguage = 'ruby' | 'typescript' | 'python';

export type LspServerState = 'idle' | 'starting' | 'ready' | 'unavailable';

export interface LspLocation {
  filePath: string;
  line: number;
  character: number;
  inDiff: boolean;
  preview: string[];
  previewStartLine: number;
}

export interface LspServerStatus {
  language: LspLanguage;
  state: LspServerState;
  detail?: string;
}

export interface LspStatusResponse {
  enabled: boolean;
  reason?: string;
  servers: LspServerStatus[];
}

export interface LspPositionRequest {
  filePath: string;
  line: number;
  character: number;
}
