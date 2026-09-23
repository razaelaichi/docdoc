import { useEffect, useRef } from "react";
import { CloseIcon } from "./Icons.jsx";

// A real modal: focus moves in and is contained, the page behind is inert, Escape closes it,
// and focus returns to whatever opened it (WCAG 2.4.3).
export default function Modal({ title, meta, children, footer, onClose, size }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog.showModal();
    // showModal focuses the first control (the close button); a form dialog marks its field instead
    dialog.querySelector("[data-autofocus]")?.focus();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={size === "sm" ? "dialog-sm" : undefined}
      aria-labelledby="dialog-title"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dialog-head">
        <div>
          <h2 id="dialog-title">{title}</h2>
          {meta && <div className="meta">{meta}</div>}
        </div>
        <button className="btn-ghost btn-icon" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-foot">{footer}</div>}
    </dialog>
  );
}
