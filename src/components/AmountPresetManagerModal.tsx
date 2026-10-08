import React, { useState } from 'react';
import { X, Plus, Edit2, Trash2, RotateCcw, Check, Coins } from 'lucide-react';
import { AmountPreset } from '../types';
import { DEFAULT_AMOUNT_PRESETS } from '../db/indexedDB';

interface AmountPresetManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currencySymbol: string;
  amountPresets: AmountPreset[];
  onSavePresets: (newPresets: AmountPreset[]) => Promise<void>;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const AmountPresetManagerModal: React.FC<AmountPresetManagerModalProps> = ({
  isOpen,
  onClose,
  currencySymbol,
  amountPresets,
  onSavePresets,
  showToast,
}) => {
  const [list, setList] = useState<AmountPreset[]>(amountPresets);
  const [newLabel, setNewLabel] = useState<string>('');
  const [newAmount, setNewAmount] = useState<string>('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState<string>('');
  const [editAmount, setEditAmount] = useState<string>('');

  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Sync state if prop changes
  React.useEffect(() => {
    setList(amountPresets);
  }, [amountPresets]);

  if (!isOpen) return null;

  const handleAdd = () => {
    const trimmedLabel = newLabel.trim();
    if (!trimmedLabel) {
      showToast('Label Required', 'Please enter a preset name (e.g. Student Discount, +1500)', 'warning');
      return;
    }
    const parsedAmt = Math.max(0, parseFloat(newAmount) || 0);

    const newPreset: AmountPreset = {
      id: `preset-${Date.now()}`,
      label: trimmedLabel,
      amount: parsedAmt,
    };

    setList([...list, newPreset]);
    setNewLabel('');
    setNewAmount('');
  };

  const handleStartEdit = (p: AmountPreset) => {
    setEditingId(p.id);
    setEditLabel(p.label);
    setEditAmount(String(p.amount));
  };

  const handleConfirmEdit = () => {
    if (!editingId) return;
    const trimmed = editLabel.trim();
    if (!trimmed) {
      showToast('Label Required', 'Preset label cannot be empty', 'warning');
      return;
    }
    const parsedAmt = Math.max(0, parseFloat(editAmount) || 0);

    setList(
      list.map((item) =>
        item.id === editingId ? { ...item, label: trimmed, amount: parsedAmt } : item
      )
    );
    setEditingId(null);
    setEditLabel('');
    setEditAmount('');
  };

  const handleDelete = (id: string) => {
    if (list.length <= 1) {
      showToast('Cannot Delete', 'You must have at least one amount preset', 'warning');
      return;
    }
    setList(list.filter((item) => item.id !== id));
    if (editingId === id) {
      setEditingId(null);
    }
  };

  const handleResetToDefault = () => {
    setList([...DEFAULT_AMOUNT_PRESETS]);
    showToast('Reset to Defaults', 'Restored No Payment, Free Campaign, and numeric presets', 'info');
  };

  const handleSaveAndClose = async () => {
    try {
      setIsSaving(true);
      await onSavePresets(list);
      showToast('Presets Saved', 'Updated quick amount presets in local storage', 'success');
      onClose();
    } catch (err: any) {
      showToast('Error', err?.message || 'Failed to save presets', 'error');
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
              <Coins className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                Customize Amount Presets
              </h3>
              <p className="text-xs text-slate-500">Edit or add quick buttons (e.g. Free Campaign, 0, or amounts)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Add New Preset Form */}
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide block">
            Add New Preset
          </span>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Label (e.g. Student Free)..."
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500 bg-white"
            />
            <div className="relative">
              <input
                type="number"
                placeholder="Amount (0 for free)"
                min="0"
                step="any"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500 bg-white"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Preset</span>
          </button>
        </div>

        {/* Presets List */}
        <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
          {list.map((preset) => {
            const isEditing = editingId === preset.id;
            const isZero = preset.amount === 0;

            return (
              <div
                key={preset.id}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 group"
              >
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Label"
                      className="flex-1 px-2.5 py-1 rounded-lg border border-indigo-400 text-xs font-semibold text-slate-900 bg-white outline-none"
                    />
                    <input
                      type="number"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      placeholder="Amount"
                      min="0"
                      step="any"
                      className="w-20 px-2 py-1 rounded-lg border border-indigo-400 text-xs font-semibold text-slate-900 bg-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmEdit}
                      className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
                      title="Save"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-800">{preset.label}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                          isZero
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-indigo-100 text-indigo-700'
                        }`}
                      >
                        {isZero ? 'Free (0)' : `${currencySymbol} ${preset.amount}`}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(preset)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        title="Edit"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(preset.id)}
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
            <span>Reset Defaults</span>
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
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-bold transition disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Apply & Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
