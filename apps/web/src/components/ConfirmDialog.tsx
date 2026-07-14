import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true면 확인 버튼을 위험(빨강) 스타일로 표시한다(삭제/폐기 등 되돌릴 수 없는 작업용). */
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  message: string;
}

export type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** window.confirm 대체 — 앱 공통 스타일의 확인 모달을 띄우고 확인/취소 결과를 Promise로 반환한다. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm은 ConfirmProvider 하위에서만 사용할 수 있습니다.");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((result: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((message, options) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setRequest({ message, ...options });
    });
  }, []);

  const settle = (result: boolean): void => {
    resolver.current?.(result);
    resolver.current = null;
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="modal-overlay confirm-dialog-overlay" onClick={() => settle(false)}>
          <div
            className="modal-content confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{request.title ?? "확인"}</h3>
            <p className="confirm-dialog__message">{request.message}</p>
            <div className="modal-actions">
              <button
                type="button"
                className={request.danger ? "danger" : "primary"}
                onClick={() => settle(true)}
                autoFocus={!request.danger}
              >
                {request.confirmLabel ?? "확인"}
              </button>
              {/* 삭제/폐기 등 되돌릴 수 없는 작업은 취소에 기본 포커스를 둬 Enter 키 실수를 막는다. */}
              <button type="button" onClick={() => settle(false)} autoFocus={request.danger}>
                {request.cancelLabel ?? "취소"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
