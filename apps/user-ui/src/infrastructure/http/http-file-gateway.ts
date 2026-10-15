import { apiFetch, apiJson } from "./api";
import type { FileGateway } from "../../ports/file-gateway";

export function createHttpFileGateway(): FileGateway {
  return {
    upload: async (file) => {
      const body = new FormData();
      body.append("file", file, file.name);
      const uploadResponse = await apiFetch("/api/files", { method: "POST", body });
      return (await uploadResponse.json()) as { id: string };
    },
    getMeta: (fileId) =>
      apiJson<{
        id: string;
        original_name?: string;
        mime?: string;
        size?: number;
        sha256?: string;
      }>(`/api/files/${encodeURIComponent(fileId)}/meta`)
  };
}
