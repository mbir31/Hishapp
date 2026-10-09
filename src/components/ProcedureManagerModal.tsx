import React, { useState } from 'react';
import { X, Plus, Edit2, Trash2, RotateCcw, Check, Activity } from 'lucide-react';
import { DEFAULT_PROCEDURES } from '../db/indexedDB';

interface ProcedureManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  procedures: string[];
  onSaveProcedures: (newProcedures: string[]) => Promise<void>;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const ProcedureManagerModal: React.FC<ProcedureManagerModalProps> = ({
  isOpen,
  onClose,
  procedures,
  onSaveProcedures,
  showToast,
}) => {
  const [list, setList] = useState<string[]>(procedures);
  const [newProcName, setNewProcName] = useState<string>('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Sync state if prop changes
  React.useEffect(() => {
    setList(procedures);
  }, [procedures]);

  if (!isOpen) return null;

  const handleAdd = () => {
    const trimmed = newProcName.trim();
    if (!trimmed) {
      showToast('Name Required', 'Enter procedure name to add', 'warning');
      return;
    }
    if (list.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      showToast('Duplicate', 'This procedure already exists in the list', 'warning');
      return;
    }
    setList([...list, trimmed]);
    setNewProcName('');
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditingValue(list[index]);
  };

  const handleConfirmEdit = () => {
    if (editingIndex === null) return;
    const trimmed = editingValue.trim();
    if (!trimmed) {
      showToast('Name Required', 'Procedure name cannot be empty', 'warning');
      return;
    }
    const updated = [...list];
    updated[editingIndex] = trimmed;
    setList(updated);
    setEditingIndex(null);
    setEditingValue('');
  };

  const handleDelete = (index: number) => {
    if (list.length <= 1) {
      showToast('Cannot Delete', 'You must have at least one procedure preset', 'warning');
      return;
    }
    const updated = list.filter((_, i) => i !== index);
    setList(updated);
    if (editingIndex === index) {
      setEditingIndex(null);
    }
  };

  const handleResetToDefault = () => {
    setList([...DEFAULT_PROCEDURES]);
    showToast('Reset to Defaults', 'Restored: Visit, RCT, Filling, Scaling, Extraction, Pulpectomy, Crown', 'info');
  };

  const handleSaveAndClose = async () => {
    try {
      setIsSaving(true);
      await onSaveProcedures(list);
      showToast('Procedures Updated', 'Saved customizable presets to local storage', 'success');
      onClose();
    } catch (err: any) {
      showToast('Error', err?.message || 'Failed to save procedures', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      <div className="ios-glass bg-white/95 rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl space-y-4 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                Customize Procedures
              </h3>
              <p className="text-xs text-slate-500">Add, rename, or remove procedure presets</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Add New Procedure Input */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="New procedure name (e.g. Bleaching, Impaction)..."
            value={newProcName}
            onChange={(e) => setNewProcName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500 bg-white"
          />
          <button
            type="button"
            onClick={handleAdd}
            className="btn-gradient px-3 py-2.5 rounded-xl text-white text-xs font-bold flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            <span>Add</span>
          </button>
        </div>

        {/* Procedures List */}
        <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
          {list.map((proc, index) => {
            const isEditing = editingIndex === index;

            return (
              <div
                key={`${proc}-${index}`}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 group"
              >
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleConfirmEdit()}
                      autoFocus
                      className="flex-1 px-2.5 py-1 rounded-lg border border-indigo-400 text-xs font-semibold text-slate-900 bg-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmEdit}
                      className="btn-gradient btn-gradient--emerald p-1.5 rounded-lg text-white"
                      title="Save"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-xs font-bold text-slate-800">{proc}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(index)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        title="Rename"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(index)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer controls */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="text-[11px] font-semibold text-slate-500 hover:text-indigo-600 flex items-center gap-1 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset 7 Defaults</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAndClose}
              disabled={isSaving}
              className="btn-gradient px-4 py-2 rounded-xl text-white text-xs font-bold disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Apply & Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
