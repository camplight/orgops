import type { FileGateway } from "../../ports/file-gateway";
import type { UploadedAttachment } from "../../types";

export function createUploadAttachment(options: { fileGateway: FileGateway }) {
  const { fileGateway } = options;
  return async function uploadAttachment(input: { file: File; localId: string }): Promise<UploadedAttachment> {
    const { file, localId } = input;
    const mime = file.type || "application/octet-stream";
    const uploadPayload = await fileGateway.upload(file);
    const meta = await fileGateway.getMeta(uploadPayload.id);
    const uploaded: UploadedAttachment = {
      localId,
      fileId: uploadPayload.id,
      name: meta.original_name || file.name || "upload",
      mime: meta.mime || mime,
      size: typeof meta.size === "number" ? meta.size : file.size,
      ...(typeof meta.sha256 === "string" && meta.sha256 ? { sha256: meta.sha256 } : {})
    };
    return uploaded;
  };
}
