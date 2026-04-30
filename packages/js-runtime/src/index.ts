import vm from "node:vm";

export type JsRuntimeEvaluateOptions = {
  filename?: string;
  bootstrapTimeoutMs?: number;
};

export type JsRuntimeSession = {
  context: Record<string, unknown>;
  evaluate: (code: string, options?: JsRuntimeEvaluateOptions) => Promise<unknown>;
  close: () => void;
};

export function createJsRuntimeSession(initialContext: Record<string, unknown> = {}): JsRuntimeSession {
  const context = initialContext;
  if (!Object.prototype.hasOwnProperty.call(context, "globalThis")) {
    context.globalThis = context;
  }
  const vmContext = vm.createContext(context);
  const mainContextLoader = vm.constants?.USE_MAIN_CONTEXT_DEFAULT_LOADER;

  return {
    context,
    async evaluate(code: string, options?: JsRuntimeEvaluateOptions): Promise<unknown> {
      const script = new vm.Script(`(async () => {\n${code}\n})()`, {
        filename: options?.filename ?? "orgops-runtime",
        ...(mainContextLoader
          ? { importModuleDynamically: mainContextLoader }
          : {}),
      });
      const result = script.runInContext(vmContext, {
        timeout: options?.bootstrapTimeoutMs,
      });
      if (result && typeof (result as Promise<unknown>).then === "function") {
        return await (result as Promise<unknown>);
      }
      return result;
    },
    close() {
      // vm contexts are garbage-collected with their references.
    },
  };
}
