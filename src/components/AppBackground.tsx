import React from 'react';

/**
 * HISAPP — AMBIENT BACKGROUND
 * ───────────────────────────
 * One fixed, non-scrollable layer painted behind the whole app. It never moves
 * when the UI scrolls, so the frosted-glass cards floating on top always have
 * the same soothing light gradient to refract.
 *
 * The colour washes are deliberately calm and low-opacity (lavender, sky,
 * mint, peach, lemon) over a soft off-white base.
 */
export const AppBackground: React.FC = () => (
  <div className="app-backdrop" aria-hidden="true">
    <span className="app-backdrop__blob app-backdrop__blob--sky" />
    <span className="app-backdrop__blob app-backdrop__blob--lilac" />
    <span className="app-backdrop__blob app-backdrop__blob--mint" />
    <span className="app-backdrop__blob app-backdrop__blob--peach" />
    <span className="app-backdrop__blob app-backdrop__blob--lemon" />
    <span className="app-backdrop__grain" />
  </div>
);

export default AppBackground;
