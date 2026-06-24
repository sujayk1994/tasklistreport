import { useEffect } from "react";
import { X, Pencil } from "lucide-react";

interface NoteModalProps {
  note: string;
  onClose: () => void;
  onEdit?: () => void;
}

export function NoteModal({ note, onClose, onEdit }: NoteModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-[#FBF7EE] border border-[#E2DBC6] shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-[#E2DBC6]">
          <span className="text-[13px] font-semibold text-[#1F1B14] tracking-wide uppercase opacity-60">
            Note
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-md text-[#9A9279] hover:bg-[#F4ECD8] hover:text-[#1F1B14] transition-colors"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          <p className="text-[14px] leading-relaxed text-[#3D3626] whitespace-pre-wrap break-words">
            {note}
          </p>
        </div>
        {onEdit && (
          <div className="px-5 pb-4 pt-2 flex justify-end border-t border-[#E2DBC6]">
            <button
              type="button"
              onClick={() => { onEdit(); onClose(); }}
              className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[#1F1B14] text-white hover:bg-[#2D2618] transition-colors"
            >
              <Pencil size={12} /> Edit note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
