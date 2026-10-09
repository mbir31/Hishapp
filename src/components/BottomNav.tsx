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
    <nav className="bottom-nav" aria-label="Main navigation">
      <div className="bottom-nav__dock ios-glass-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={
                item.badge && item.badge > 0
                  ? `${item.label}, ${item.badge} pending settlement${item.badge === 1 ? '' : 's'}`
                  : item.label
              }
              className={`bottom-nav__item bottom-nav__item--${item.id}${isActive ? ' is-active' : ''}`}
            >
              <span className="bottom-nav__icon-wrap">
                <Icon className="bottom-nav__icon" aria-hidden="true" />
                {item.badge !== undefined && item.badge > 0 ? (
                  <span className="bottom-nav__badge" aria-hidden="true">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </span>
              <span className="bottom-nav__label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
