import React from 'react';
import { LayoutDashboard, PlusCircle, Scale, History } from 'lucide-react';
import { TabType } from '../types';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  pendingCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  pendingCount = 0,
}) => {
  const navItems: { id: TabType; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'entry', label: 'Entry', icon: PlusCircle },
    { id: 'settlement', label: 'Settlement', icon: Scale, badge: pendingCount },
    { id: 'history', label: 'History', icon: History },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom,0px)] ios-glass-nav">
      <div className="max-w-md mx-auto px-4 py-0.5 flex items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onChangeTab(item.id)}
              className={`relative flex flex-col items-center justify-center py-0 px-3 sm:px-5 rounded-2xl transition-all duration-200 active:scale-95 group ${
                isActive ? 'text-indigo-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {/* Active subtle pill highlight */}
              {isActive && (
                <div className="absolute inset-0 bg-indigo-50/80 rounded-2xl -z-10 shadow-sm border border-indigo-100/60 transition-all duration-200" />
              )}

              {/* Icon Container with Badge */}
              <div className="relative flex items-center justify-center p-0.5">
                <Icon
                  className={`w-6 h-6 transition-transform duration-200 ${
                    isActive ? 'scale-110 stroke-[2.2]' : 'group-hover:scale-105 stroke-[1.8]'
                  }`}
                />
                {item.badge && item.badge > 0 ? (
                  <span className="absolute -top-1 -right-2 px-1.5 py-0.2 min-w-4.5 h-4.5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white shadow-sm">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </div>

              {/* Extra-small crisp font label */}
              <span className="text-[10px] tracking-tight leading-none mt-0.5 select-none">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
