const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

function isTimeoutSignal(signal?: AbortSignal | null): boolean {
  if (!signal?.aborted) return false;
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason.name === "TimeoutError" || /timed out|超时/i.test(reason.message);
  }
  return typeof reason === "string" && /TimeoutError|timed out|超时/i.test(reason);
}

function isUserAbort(signal?: AbortSignal | null): boolean {
  return Boolean(signal?.aborted && !isTimeoutSignal(signal));
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`;
  return /TimeoutError|ERR_TIMED_OUT|ETIMEDOUT|timed out|超时/i.test(text);
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ERR_CONNECTION_|ERR_TIMED_OUT|ERR_NETWORK_|ERR_PROXY_|ERR_SOCKET_|TimeoutError/i.test(
    text,
  );
}

function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("请求已取消"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("请求已取消"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function formatNetworkError(error: unknown, serviceName = "GitHub"): Error {
  if (isTimeoutError(error)) {
    return new Error(`连接 ${serviceName} 超时，请检查网络或系统代理设置后重试`);
  }
  if (isTransientNetworkError(error)) {
    return new Error(`无法连接 ${serviceName}（网络波动或代理异常），请检查网络后重试`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function formatGitHubNetworkError(error: unknown): Error {
  return formatNetworkError(error, "GitHub");
}

/**
 * 封装带单次瞬态重试（可中断退避）与友好中文网络提示的 fetcher；
 * 桌面端主进程注入 Chromium `electron.net` 后可自动继承 macOS / Windows 系统代理与 PAC 配置。
 */
export function createResilientFetcher(
  baseFetcher: typeof fetch = fetch,
  retryDelayMs = 600,
  serviceName = "GitHub",
): typeof fetch {
  return async (input, init) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (isUserAbort(init?.signal)) {
        throw new Error("请求已取消");
      }
      if (isTimeoutSignal(init?.signal)) {
        throw formatNetworkError(init?.signal?.reason ?? new Error("TimeoutError"), serviceName);
      }
      try {
        const response = await baseFetcher(input, init);
        if (attempt === 0 && TRANSIENT_HTTP_STATUSES.has(response.status) && !init?.signal?.aborted) {
          void response.body?.cancel().catch(() => {});
          await abortableDelay(retryDelayMs, init?.signal);
          continue;
        }
        return response;
      } catch (error) {
        if (isUserAbort(init?.signal)) throw error;
        if (isTimeoutSignal(init?.signal)) throw formatNetworkError(init?.signal?.reason ?? error, serviceName);
        lastError = error;
        if (attempt === 0 && isTransientNetworkError(error) && !init?.signal?.aborted) {
          try {
            await abortableDelay(retryDelayMs, init?.signal);
          } catch (abortErr) {
            if (isUserAbort(init?.signal)) throw abortErr;
            throw formatNetworkError(abortErr, serviceName);
          }
          continue;
        }
        throw formatNetworkError(error, serviceName);
      }
    }
    throw formatNetworkError(lastError, serviceName);
  };
}
