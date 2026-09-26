"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  children,
  description,
  footer,
  onClose,
  open,
  title,
}: {
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      className="modal"
      ref={dialogRef}
      onClose={onClose}
      aria-describedby={description ? "putduk-modal-description" : undefined}
      aria-labelledby="putduk-modal-title"
    >
      <div className="modal__panel">
        <header>
          <div>
            <p className="eyebrow">CONFIRMATION</p>
            <h2 id="putduk-modal-title">{title}</h2>
            {description ? (
              <p id="putduk-modal-description">{description}</p>
            ) : null}
          </div>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => dialogRef.current?.close()}
          >
            닫기
          </button>
        </header>
        <div className="modal__content">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </dialog>
  );
}
