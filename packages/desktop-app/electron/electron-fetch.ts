import { app, net } from "electron";
import { createResilientFetcher, formatGitHubNetworkError, formatNetworkError } from "./resilient-fetch.ts";

export { createResilientFetcher, formatGitHubNetworkError, formatNetworkError };

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Electron 44 的 `net.fetch(..., { redirect: "manual" })` 在遇到 3xx 时会直接抛出
 * `Redirect was cancelled` 而不返回 Location 头；手动重定向场景使用 `net.request`
 * 保持 Chromium 系统代理/PAC 能力，同时暴露真实 3xx Location、支持背压与流中途报错传播。
 */
function electronManualRedirectFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return new Promise((resolve, reject) => {
    const req = net.request({
      url,
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      redirect: "manual",
    });

    const mergedHeaders = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => mergedHeaders.set(key, value));
    }
    mergedHeaders.forEach((value, key) => req.setHeader(key, value));

    let settled = false;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let streamClosed = false;
    let activeRes: Electron.IncomingMessage | undefined;
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    const failStream = (err: Error) => {
      cleanup();
      if (streamController && !streamClosed) {
        streamClosed = true;
        try {
          streamController.error(err);
        } catch {
          // 流已关闭或错误时忽略二次通知。
        }
      }
    };

    const abortError = (): Error => {
      if (signal?.reason instanceof Error) return signal.reason;
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      return err;
    };

    const onAbort = () => {
      cleanup();
      req.abort();
      if (!settled) {
        settled = true;
        reject(abortError());
        return;
      }
      failStream(abortError());
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const toHeaders = (raw: Record<string, string | string[]> | undefined): Headers => {
      const headers = new Headers();
      if (!raw) return headers;
      for (const [key, value] of Object.entries(raw)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else if (typeof value === "string") {
          headers.set(key, value);
        }
      }
      return headers;
    };

    req.on("redirect", (statusCode, _method, redirectUrl, responseHeaders) => {
      if (settled) return;
      settled = true;
      cleanup();
      const headers = toHeaders(responseHeaders);
      if (!headers.has("location") && redirectUrl) headers.set("location", redirectUrl);
      req.abort();
      resolve(new Response(null, { status: statusCode, headers }));
    });

    req.on("response", (res) => {
      if (settled) return;
      settled = true;
      activeRes = res;
      const headers = toHeaders(res.headers);
      if (NULL_BODY_STATUSES.has(res.statusCode)) {
        cleanup();
        resolve(new Response(null, { status: res.statusCode, statusText: res.statusMessage, headers }));
        return;
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          res.on("data", (chunk: Buffer) => {
            if (streamClosed) return;
            controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
            if (controller.desiredSize !== null && controller.desiredSize <= 0) {
              (res as unknown as { pause?: () => void }).pause?.();
            }
          });
          res.on("end", () => {
            cleanup();
            if (!streamClosed) {
              streamClosed = true;
              controller.close();
            }
          });
          res.on("aborted", () => {
            failStream(new Error("ERR_CONNECTION_CLOSED"));
          });
          res.on("error", (err: Error) => {
            failStream(err);
          });
        },
        pull() {
          (activeRes as unknown as { resume?: () => void } | undefined)?.resume?.();
        },
        cancel() {
          streamClosed = true;
          cleanup();
          req.abort();
        },
      });
      resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage, headers }));
    });

    req.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
        return;
      }
      failStream(err);
    });

    req.on("abort", () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("ERR_CONNECTION_ABORTED"));
        return;
      }
      failStream(new Error("ERR_CONNECTION_ABORTED"));
    });

    req.end();
  });
}

function rawElectronFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  if (typeof app?.isReady === "function" && app.isReady()) {
    if (init?.redirect === "manual" && typeof net?.request === "function") {
      return electronManualRedirectFetch(input, init);
    }
    if (typeof net?.fetch === "function") {
      return net.fetch(input as string | Request, init as Parameters<typeof net.fetch>[1]);
    }
  }
  return fetch(input, init);
}

/** GitHub 链路专用 Chromium 网络栈 fetcher（自动走系统代理与系统证书）。 */
export const electronFetch: typeof fetch = createResilientFetcher(rawElectronFetch, 600, "GitHub");

/** 通用外部文档巡检 Chromium 网络栈 fetcher（避免非 GitHub 目标报 GitHub 提示）。 */
export const electronGenericFetch: typeof fetch = createResilientFetcher(rawElectronFetch, 600, "远程文档服务");
