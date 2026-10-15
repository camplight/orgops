export type FileGateway = {
  upload: (file: File) => Promise<{ id: string }>;
  getMeta: (fileId: string) => Promise<{
    id: string;
    original_name?: string;
    mime?: string;
    size?: number;
    sha256?: string;
  }>;
};
