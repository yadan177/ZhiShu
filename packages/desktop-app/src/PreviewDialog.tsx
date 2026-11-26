import { useEffect, useRef, useState } from "react";
import { WarningCircle, X } from "@phosphor-icons/react";
import { APP_COPY, formatPlatformList } from "./copy";
import type { Preview } from "./types";

interface PreviewDialogProps {
  preview: Preview;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onApply: () => void;
}

const ACTION_LABEL = {
  add: "新增",
  modify: "修改",
  remove: "删除",
} as const;

export function PreviewDialog({ preview, busy, error, onClose, onApply }: PreviewDialogProps) {
  const [selected, setSelected] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const current = preview.changes[selected];

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const title =
    preview.kind === "install"
      ? "安装预览"
      : preview.kind === "update"
        ? "更新变更"
        : preview.kind === "repair"
          ? "覆盖修复预览"
          : preview.kind === "force-uninstall"
            ? "强制卸载预览"
            : "卸载预览";
  const confirmLabel =
    preview.kind === "install"
      ? APP_COPY.actions.confirmInstall
      : preview.kind === "update"
        ? APP_COPY.actions.confirmUpdate
        : preview.kind === "repair"
          ? APP_COPY.actions.confirmRepair
          : preview.kind === "force-uninstall"
            ? APP_COPY.actions.confirmForceUninstall
            : APP_COPY.actions.confirmUninstall;
  const isDangerAction = preview.kind === "uninstall" || preview.kind === "force-uninstall";
  const sourceText =
    isDangerAction
      ? "项目规则"
      : preview.sourceType === "workspace"
        ? "本地目录源"
        : `规则版本 ${preview.version ?? "-"}`;

  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="modal preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <div className="modal-body">
          <div className="preview-meta">
            <strong>{preview.root}</strong>
            <span>
              {preview.targets.length > 0 ? `${formatPlatformList(preview.targets)} · ` : ""}
              {sourceText}
              {preview.rulepacks && preview.rulepacks.length > 0 ? ` · ${preview.rulepacks.length} 个规则包` : ""}
            </span>
          </div>

          {(preview.kind === "repair" || preview.kind === "force-uninstall") && (
            <div className="alert-banner" role="note" style={{ marginBottom: 0 }}>
              <div className="alert-banner-body">
                <WarningCircle size={16} style={{ flex: "none" }} />
                <span>
                  {preview.kind === "repair"
                    ? "将覆盖重写受管规则文件并修复锁文件，严格保留项目本地 overrides.md 与非受管文件。"
                    : "将强制移除受管规则与异常控制文件，严格保留项目本地 overrides.md 与非受管文件。"}
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
              <WarningCircle size={17} style={{ flex: "none", marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          {preview.conflicts.length > 0 && (
            <div className="issue-box" role="alert">
              <WarningCircle size={18} style={{ flex: "none", marginTop: 1 }} />
              <div>
                {preview.conflicts.map((issue) => (
                  <p key={`${issue.code}:${issue.message}`}>
                    [{issue.code}] {issue.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="preview-section">
            <h3>文件变更 · {preview.changes.length}</h3>
            <div className="change-list">
              {preview.changes.map((change, index) => (
                <button
                  type="button"
                  key={change.path}
                  className={`change-row${selected === index ? " active" : ""}`}
                  onClick={() => setSelected(index)}
                >
                  <span className={`change-action ${change.action}`}>{ACTION_LABEL[change.action]}</span>
                  <span>{change.path}</span>
                </button>
              ))}
            </div>
          </div>

          {current && (
            <div className="preview-section">
              <h3>文件内容 · {current.path}</h3>
              <div className="content-comparison">
                {current.before !== undefined && (
                  <div>
                    <span>原内容</span>
                    <pre>{current.before}</pre>
                  </div>
                )}
                {current.after !== undefined && (
                  <div>
                    <span>变更后</span>
                    <pre>{current.after}</pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {preview.retainedPaths.length > 0 && (
            <div className="preview-section">
              <h3>保留项目文件 · {preview.retainedPaths.length}</h3>
              <ul className="retained-list">
                {preview.retainedPaths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            {APP_COPY.actions.cancel}
          </button>
          <button
            type="button"
            className={isDangerAction ? "danger-button" : "primary-button"}
            onClick={onApply}
            disabled={busy || preview.conflicts.length > 0 || preview.changes.length === 0}
          >
            {busy ? APP_COPY.actions.processing : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
