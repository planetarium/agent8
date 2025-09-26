import { motion } from 'framer-motion';
import * as Dialog from '@radix-ui/react-dialog';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = false,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        </Dialog.Overlay>
        <div className="fixed inset-0 flex items-center justify-center z-[9999]">
          <Dialog.Content asChild>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="w-[90vw] md:w-[400px]"
            >
              <div className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-[#E5E5E5] dark:border-[#333333] shadow-xl">
                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[#111111] dark:text-white mb-2">{title}</h3>
                    <p className="text-[#666666] dark:text-[#CCCCCC] text-sm leading-relaxed">{message}</p>
                  </div>
                </div>
                <div className="border-t border-[#E5E5E5] dark:border-[#333333] p-4 flex justify-end gap-3 bg-[#F9F9F9] dark:bg-[#252525] rounded-b-lg">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg bg-[#F5F5F5] dark:bg-[#333333] text-[#666666] hover:text-[#111111] dark:text-[#999999] dark:hover:text-white transition-colors"
                  >
                    {cancelText}
                  </button>
                  <button
                    onClick={() => {
                      onConfirm();
                      onClose();
                    }}
                    className={`px-4 py-2 rounded-lg text-white transition-colors ${
                      isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-cyan-600 hover:bg-cyan-700'
                    }`}
                  >
                    {confirmText}
                  </button>
                </div>
              </div>
            </motion.div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
