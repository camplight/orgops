import type { DeepLink } from "../../ports/deep-link";

export function createSelectChannel(options: { deepLink: DeepLink }) {
  const { deepLink } = options;
  return function selectChannel(input: { channelId: string | null; replace?: boolean }): void {
    deepLink.updateChannelDeepLink(input.channelId, input.replace);
  };
}
