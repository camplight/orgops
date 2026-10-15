export type DeepLink = {
  readLinkedChannelId: () => string | null;
  readPendingShareToken: () => string | null;
  updateChannelDeepLink: (channelId: string | null, replace?: boolean) => void;
  consumeShareToken: (channelId?: string | null) => void;
  buildShareLink: (options: { token: string; channelId: string }) => string;
};
