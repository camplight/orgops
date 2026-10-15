import type { DeepLink } from "../../ports/deep-link";

export function createBrowserDeepLink(): DeepLink {
  return {
    readLinkedChannelId: () => {
      return new URL(window.location.href).searchParams.get("channel");
    },
    readPendingShareToken: () => {
      const token = new URL(window.location.href).searchParams.get("share");
      return token?.trim() || null;
    },
    updateChannelDeepLink: (channelId, replace = false) => {
      const url = new URL(window.location.href);
      if (channelId) {
        url.searchParams.set("channel", channelId);
      } else {
        url.searchParams.delete("channel");
      }
      const method = replace ? "replaceState" : "pushState";
      window.history[method](null, "", url);
    },
    consumeShareToken: (channelId) => {
      const url = new URL(window.location.href);
      url.searchParams.delete("share");
      if (channelId) {
        url.searchParams.set("channel", channelId);
      }
      window.history.replaceState(null, "", url);
    },
    buildShareLink: ({ token, channelId }) => {
      const url = new URL(window.location.href);
      url.searchParams.set("share", token);
      url.searchParams.set("channel", channelId);
      return url.toString();
    }
  };
}
