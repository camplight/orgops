import type { Confirm } from "../../ports/confirm";

export function createBrowserConfirm(): Confirm {
  return {
    confirm: (message) => window.confirm(message)
  };
}
