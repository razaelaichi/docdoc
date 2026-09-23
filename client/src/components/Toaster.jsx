import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckIcon, CloseIcon, InfoIcon } from "./Icons.jsx";

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

const LIFETIME = 6000;

// Status messages (WCAG 4.1.3): announced by the polite live region without moving focus.
// Toasts pause while hovered or focused and can be dismissed, so nobody is rushed (2.2.1).
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);
  const schedule = useCallback((id) => timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME)), [dismiss]);
  const pause = (id) => clearTimeout(timers.current.get(id));

  const toast = useCallback(
    (message, { tone = "ok" } = {}) => {
      const id = ++nextId.current;
      setToasts((all) => [...all.slice(-2), { id, message, tone }]);
      schedule(id);
    },
    [schedule]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.tone}`}
            onMouseEnter={() => pause(t.id)}
            onMouseLeave={() => schedule(t.id)}
            onFocus={() => pause(t.id)}
            onBlur={() => schedule(t.id)}
          >
            {t.tone === "ok" ? <CheckIcon /> : <InfoIcon />}
            <span>{t.message}</span>
            <button className="btn-ghost btn-icon" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
