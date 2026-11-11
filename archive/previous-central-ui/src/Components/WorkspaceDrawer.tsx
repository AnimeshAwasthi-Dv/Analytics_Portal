import { useEffect, useId, useRef, type ReactNode } from "react";
import { WorkspaceIcon } from "./WorkspaceIcon";
export function WorkspaceDrawer({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="cc-drawer"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="cc-drawer-panel">
        <header>
          <div>
            <h2 id={id}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="cc-icon-button"
            aria-label="Close details"
            onClick={onClose}
          >
            <WorkspaceIcon name="close" />
          </button>
        </header>
        <div className="cc-drawer-content">{children}</div>
      </div>
    </dialog>
  );
}
