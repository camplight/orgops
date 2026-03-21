import { loop } from "./runner";
import { pathToFileURL } from "node:url";

const entryHref = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : "";

if (import.meta.url === entryHref) {
  void loop();
}
