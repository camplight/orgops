export function formatTimestamp(value?: number): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Unknown time";
  }
  return new Date(value).toLocaleString();
}
