import React from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

/**
 * Lightweight confirm modal used for destructive operator actions
 * (Stop Monitoring, Delete Filter, Reset Configuration, etc.).
 * No animation library — CSS-only fade to keep the presentation lightweight.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  tone = 'primary', onConfirm, onCancel, testId
}) => {
  if (!open) return null;
  const confirmBg = tone === 'danger'
    ? 'bg-red-600 hover:bg-red-500'
    : 'bg-accent-primary hover:bg-blue-500';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
      data-testid={testId}
    >
      <div
        className="bg-bg-secondary border border-border-color rounded-md w-[420px] max-w-[92vw] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-color">
          <h3 className="text-base font-semibold text-text-primary" data-testid="confirm-dialog-title">{title}</h3>
        </div>
        {description && (
          <div className="px-5 py-4 text-sm text-text-secondary leading-relaxed">
            {description}
          </div>
        )}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border-color">
          <button
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded bg-bg-tertiary hover:bg-gray-700 text-text-primary"
          >
            {cancelLabel}
          </button>
          <button
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-sm rounded text-white ${confirmBg}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
