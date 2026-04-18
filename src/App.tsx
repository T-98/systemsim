/**
 * @file App.tsx
 *
 * Top-level view router. Reads `appView` from the store and mounts the right
 * top-level component: landing / review / canvas. The design flow is
 * currently a full-page view at `appView === 'design'`. Wraps the canvas
 * tree in ReactFlowProvider so XyFlow hooks work inside nested components.
 */

import { ReactFlowProvider } from '@xyflow/react';
import { useStore } from './store';
import LandingPage from './components/ui/LandingPage';
import DesignFlow from './components/panels/DesignFlow';
import Canvas from './components/canvas/Canvas';
import CanvasSidebar from './components/panels/CanvasSidebar';
import ConfigPanel from './components/panels/ConfigPanel';
import Toolbar from './components/ui/Toolbar';
import BottomPanel from './components/panels/BottomPanel';
import HintCard from './components/ui/HintCard';
import ReviewMode from './components/ui/ReviewMode';
import DesktopOnlyNotice from './components/ui/DesktopOnlyNotice';
import IntentHeader from './components/canvas/IntentHeader';
import WikiRoute from './wiki/WikiRoute';
import CoverageDebugRoute from './wiki/components/CoverageDebugRoute';

export default function App() {
  const appView = useStore((s) => s.appView);
  const setAppView = useStore((s) => s.setAppView);

  if (appView === 'landing') {
    return (
      <>
        <DesktopOnlyNotice />
        <LandingPage />
      </>
    );
  }

  if (appView === 'review') {
    return (
      <>
        <DesktopOnlyNotice />
        <ReviewMode />
      </>
    );
  }

  if (appView === 'design') {
    return <DesignFlow onComplete={() => setAppView('canvas')} />;
  }

  if (appView === 'wiki') {
    return <WikiRoute />;
  }

  if (appView === 'wiki-coverage') {
    return <CoverageDebugRoute />;
  }

  return (
    <ReactFlowProvider>
      <div
        className="h-screen flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-primary)',
          color: 'var(--text-secondary)',
        }}
      >
        <IntentHeader />
        <Toolbar />
        <div className="flex flex-1 overflow-hidden">
          <CanvasSidebar />
          <Canvas />
          <ConfigPanel />
        </div>
        <BottomPanel />
        <HintCard />
      </div>
    </ReactFlowProvider>
  );
}
