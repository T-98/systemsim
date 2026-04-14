import { ReactFlowProvider } from '@xyflow/react';
import { useStore } from './store';
import LandingPage from './components/ui/LandingPage';
import DesignFlow from './components/panels/DesignFlow';
import Canvas from './components/canvas/Canvas';
import ComponentLibrary from './components/panels/ComponentLibrary';
import ConfigPanel from './components/panels/ConfigPanel';
import TrafficEditor from './components/panels/TrafficEditor';
import Toolbar from './components/ui/Toolbar';
import LiveLog from './components/panels/LiveLog';
import DebriefPanel from './components/debrief/DebriefPanel';
import HintCard from './components/ui/HintCard';
import ReviewMode from './components/ui/ReviewMode';
import DesktopOnlyNotice from './components/ui/DesktopOnlyNotice';
import IntentHeader from './components/canvas/IntentHeader';

export default function App() {
  const appView = useStore((s) => s.appView);
  const setAppView = useStore((s) => s.setAppView);
  const appMode = useStore((s) => s.appMode);

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
          <div className="flex flex-col">
            <ComponentLibrary />
            {appMode === 'freeform' && <TrafficEditor />}
          </div>
          <Canvas />
          <ConfigPanel />
        </div>
        <LiveLog />
        <DebriefPanel />
        <HintCard />
      </div>
    </ReactFlowProvider>
  );
}
