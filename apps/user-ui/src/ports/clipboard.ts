export type Clipboard = {
  writeText: (text: string) => Promise<void>;
};
