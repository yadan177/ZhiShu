import { useState } from "react";
import { WarningCircle, X } from "@phosphor-icons/react";
import { APP_COPY, formatPlatformList } from "./copy";
import type { Preview } from "./types";

interface PreviewDialogProps {
  preview: Preview;
  busy: boolean;
  onClose: () => void;
  onApply: () => void;
}

const ACTION_LABEL = {
  add: "新增",
  modify: "修改",
  remove: "删除",
} as const;

export function PreviewDialog({ preview, busy, onClose, onApply }: PreviewDialogProps) {
  const [selected, setSelected] = useState(0);
  const current = preview.changes[selected];
  const title =
    preview.kind === "install"
      ? "安装预览"
      : preview.kind === "update"
        ? "更新变更"
        : "卸载预览";
  const confirmLabel =
    preview.kind === "install"
      ? APP_COPY.actions.confirmInstall
      : preview.kind === "update"
        ? APP_COPY.actions.confirmUpdate
        : APP_COPY.actions.confirmUninstall;
  const sourceText =
    preview.kind === "uninstall"
      ? "项目规则"
      : preview.sourceType === "workspace"
        ? "本地目录源"
        : `规则版本 ${preview.version ?? "-"}`;

  return (
    <div className="modal-backdrop">
      <section className="modal preview-modal" role="dialog" aria-modal="true" aria-label={title}>
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
              {formatPlatformList(preview.targets)} · {sourceText}
              {preview.rulepacks && preview.rulepacks.length > 0 ? ` · ${preview.rulepacks.length} 个规则包` : ""}
            </span>
          </div>

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
            className={preview.kind === "uninstall" ? "danger-button" : "primary-button"}
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
