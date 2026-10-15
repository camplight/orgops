import type { EventRow } from "../types";

export type RealtimeFeed = {
  start: () => void;
  stop: () => void;
  setTopics: (topics: Set<string>) => void;
};

export type RealtimeFeedHandlers = {
  onOpen: () => void;
  onClose: () => void;
  onEvent: (event: EventRow) => void;
};
