import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ShieldAlert,
  Search,
  Filter,
  Download,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  Trash2,
  FileText,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import { AuditLogEntry } from '../types';
import { getAllAuditLogs, clearAuditLogs } from '../db/indexedDB';

interface AuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const AuditLogModal: React.FC<AuditLogModalProps> = ({ isOpen, onClose, showToast }) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen]);

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      const data = await getAllAuditLogs();
      setLogs(data);
    } catch (err: any) {
      showToast('Error', err?.message || 'Failed to load audit logs', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter !== 'ALL' && log.action !== actionFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchDetails = log.details?.toLowerCase().includes(q);
        const matchAction = log.action?.toLowerCase().includes(q);
        const matchTarget = log.targetId?.toLowerCase().includes(q);
        if (!matchDetails && !matchAction && !matchTarget) {
          return false;
        }
      }
      return true;
    });
  }, [logs, actionFilter, searchQuery]);

  if (!isOpen) return null;

  const handleExportAuditJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `Hisapp_AuditTrail_${new Date().toISOString().slice(0, 10)}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Exported', 'Full audit trail exported as JSON', 'success');
  };

  const getActionBadge = (action: AuditLogEntry['action']) => {
    switch (action) {
      case 'ENTRY_CREATED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            Created
          </span>
        );
      case 'ENTRY_EDITED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
            Edited
          </span>
        );
      case 'ENTRY_DELETED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
            Deleted
          </span>
        );
      case 'SETTLEMENT_CREATED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
            Settlement Done
          </span>
        );
      case 'SETTLEMENT_DELETED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            Settlement Reverted
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
            {action}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      <div className="ios-glass bg-white/95 rounded-3xl p-5 sm:p-6 w-full max-w-2xl shadow-2xl space-y-4 my-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                  Financial Audit Trail
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                  {logs.length} Total Events
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Tamper-resistant audit log of patient modifications, deletions &amp; settlements
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportAuditJSON}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
              title="Download audit trail JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search audit trail by patient name, action, or note..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 shrink-0">
            {[
              { id: 'ALL', label: 'All' },
              { id: 'ENTRY_CREATED', label: 'Created' },
              { id: 'ENTRY_EDITED', label: 'Edited' },
              { id: 'ENTRY_DELETED', label: 'Deleted' },
              { id: 'SETTLEMENT_CREATED', label: 'Settlement' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setActionFilter(f.id)}
                className={`px-2.5 py-1 rounded-lg text-[10.5px] font-semibold transition whitespace-nowrap ${
                  actionFilter === f.id
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Audit Log Timeline */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-400">Loading audit trail...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400 bg-slate-50 rounded-2xl p-6">
              No audit records match your filters.
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const hasDiff = log.previousData || log.newData;

              return (
                <div
                  key={log.id}
                  className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5 text-xs transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getActionBadge(log.action)}
                      <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>

                    {hasDiff && (
                      <button
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 shrink-0"
                      >
                        <span>{isExpanded ? 'Hide Details' : 'View Snapshot'}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>

                  <p className="text-xs font-semibold text-slate-800 leading-snug">
                    {log.details}
                  </p>

                  {/* Expandable Before/After Snapshot */}
                  {isExpanded && hasDiff && (
                    <div className="mt-2 p-2.5 rounded-xl bg-white border border-slate-200 text-[10.5px] font-mono space-y-1 overflow-x-auto">
                      {log.previousData && (
                        <div>
                          <span className="text-rose-600 font-bold block font-sans">
                            Prior State:
                          </span>
                          <pre className="text-slate-600 bg-slate-50 p-1.5 rounded overflow-x-auto">
                            {JSON.stringify(log.previousData, null, 2)}
                          </pre>
                        </div>
                      )}
                      {log.newData && (
                        <div>
                          <span className="text-emerald-600 font-bold block font-sans">
                            New State:
                          </span>
                          <pre className="text-slate-600 bg-slate-50 p-1.5 rounded overflow-x-auto">
                            {JSON.stringify(log.newData, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between shrink-0 text-xs">
          <span className="text-[11px] text-slate-400">
            Showing {filteredLogs.length} of {logs.length} logged events
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition"
          >
            Close Audit Trail
          </button>
        </div>
      </div>
    </div>
  );
};
