// src/lib/files/types.ts
export type ParsedDocument = {
  text: string;
  meta: {
    fileName: string;
    fileType: string;
  };
};