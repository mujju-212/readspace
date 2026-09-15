/// <reference types="vite/client" />

// File System Access API is not fully typed in TS lib.dom yet
interface Window {
  showDirectoryPicker?(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: string;
  }): Promise<FileSystemDirectoryHandle>;
}

// mammoth ships a prebuilt UMD browser bundle; use it directly in Vite
declare module 'mammoth/mammoth.browser.min.js' {
  interface MammothResult {
    value: string;
    messages: { type: string; message: string }[];
  }
  interface MammothStatic {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
  }
  const mammoth: MammothStatic;
  export default mammoth;
}
