const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

function isTimeoutSignal(signal?: AbortSignal | null): boolean {
  if (!signal?.aborted) return false;
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason.name === "TimeoutError" || /timed out/i.test(reason.message);
  }
  return typeof reason === "string" && /TimeoutError|timed out/i.test(reason);
}

function isUserAbort(signal?: AbortSignal | null): boolean {
  return Boolean(signal?.aborted && !isTimeoutSignal(signal));
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`;
  return /TimeoutError|ERR_TIMED_OUT|ETIMEDOUT|timed out/i.test(text);
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ERR_CONNECTION_|ERR_TIMED_OUT|ERR_NETWORK_|ERR_PROXY_|ERR_SOCKET_|TimeoutError/i.test(
    text,
  );
}

export function formatGitHubNetworkError(error: unknown): Error {
  if (isTimeoutError(error)) {
    return new Error("连接 GitHub 超时，请检查网络或系统代理设置后重试");
  }
  if (isTransientNetworkError(error)) {
    return new Error("无法连接 GitHub（网络波动或代理异常），请检查网络后重试");
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * 封装带单次瞬态重试与友好中文网络提示的 fetcher；
 * 桌面端主进程注入 Chromium `electron.net` 后可自动继承 macOS / Windows 系统代理与 PAC 配置。
 */
export function createResilientFetcher(baseFetcher: typeof fetch = fetch, retryDelayMs = 600): typeof fetch {
  return async (input, init) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (isUserAbort(init?.signal)) {
        throw new Error("请求已取消");
      }
      if (isTimeoutSignal(init?.signal)) {
        throw formatGitHubNetworkError(init?.signal?.reason ?? new Error("TimeoutError"));
      }
      try {
        const response = await baseFetcher(input, init);
        if (attempt === 0 && TRANSIENT_HTTP_STATUSES.has(response.status) && !init?.signal?.aborted) {
          void response.body?.cancel().catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        return response;
      } catch (error) {
        if (isUserAbort(init?.signal)) throw error;
        if (isTimeoutSignal(init?.signal)) throw formatGitHubNetworkError(init?.signal?.reason ?? error);
        lastError = error;
        if (attempt === 0 && isTransientNetworkError(error) && !init?.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        throw formatGitHubNetworkError(error);
      }
    }
    throw formatGitHubNetworkError(lastError);
  };
}
