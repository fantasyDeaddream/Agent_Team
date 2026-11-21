import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppSettings,
  DetectedHarness,
  HarnessId,
  ManualRouteAssignment,
  OrchestrationRun,
  RoutingMode,
  StartRunRequest,
} from '@shared/domain';
import { HarnessesView } from './components/HarnessesView';
import { HistoryView } from './components/HistoryView';
import { OnboardingBanner } from './components/OnboardingBanner';
import { RolesRoutingView } from './components/RolesRoutingView';
import { NavTab, Sidebar } from './components/Sidebar';
import { WorkspaceView } from './components/WorkspaceView';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('workspace');
  const [harnesses, setHarnesses] = useState<DetectedHarness[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runs, setRuns] = useState<OrchestrationRun[]>([]);
  const [activeRun, setActiveRun] = useState<OrchestrationRun | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | null>(null);
  const checkedFirstLaunchRef = useRef(false);

  const rescanHarnesses = useCallback(async () => {
    setDetecting(true);
    try {
      const res = await window.agentTeam.detectHarnesses();
      setHarnesses(res.harnesses);
      setSettings(res.settings);
      if (!checkedFirstLaunchRef.current) {
        checkedFirstLaunchRef.current = true;
        if (!res.settings.onboardingCompleted) {
          setOnboardingStep(1);
          setActiveTab('harnesses');
        }
      }
    } finally {
      setDetecting(false);
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    const list = await window.agentTeam.listRuns();
    setRuns(list);
  }, []);

  useEffect(() => {
    void rescanHarnesses();
    void refreshRuns();

    const unsub = window.agentTeam.onRunEvent((payload) => {
      if (payload.type === 'run-updated' && payload.run) {
        const updated = payload.run;
        setActiveRun((prev) => (prev && prev.id !== updated.id ? prev : updated));
        setRuns((prev) => {
          const idx = prev.findIndex((r) => r.id === updated.id);
          if (idx === -1) return [updated, ...prev];
          const copy = [...prev];
          copy[idx] = updated;
          return copy;
        });
      } else if (payload.type === 'subtask-stream' && payload.subtaskId && payload.chunk) {
        const { runId, subtaskId, chunk } = payload;
        setActiveRun((prev) => {
          if (!prev || prev.id !== runId) return prev;
          return {
            ...prev,
            subtasks: prev.subtasks.map((st) =>
              st.id === subtaskId ? { ...st, streamLog: st.streamLog + chunk } : st
            ),
          };
        });
      }
    });

    return () => unsub();
  }, [rescanHarnesses, refreshRuns]);

  const isRunning = Boolean(
    activeRun &&
      [
        'planning',
        'classifying',
        'awaiting_manual_routing',
        'executing',
        'reviewing',
      ].includes(activeRun.status)
  );
  const awaitingManualRouting = activeRun?.status === 'awaiting_manual_routing';

  const handleSaveSettings = async (next: AppSettings) => {
    const saved = await window.agentTeam.saveSettings(next);
    setSettings(saved);
  };

  const handleResetRoles = async () => {
    const saved = await window.agentTeam.resetRoles();
    setSettings(saved);
  };

  const handleAutoFillRoutes = async () => {
    const saved = await window.agentTeam.autoFillRoutes();
    setSettings(saved);
  };

  const handleStartOnboarding = () => {
    setOnboardingStep(1);
    setActiveTab('harnesses');
  };

  const handleGoOnboardingStep = (step: 1 | 2) => {
    setOnboardingStep(step);
    setActiveTab(step === 1 ? 'harnesses' : 'roles');
  };

  const handleCompleteOnboarding = async () => {
    setOnboardingStep(null);
    setActiveTab('workspace');
    if (settings && !settings.onboardingCompleted) {
      await handleSaveSettings({ ...settings, onboardingCompleted: true });
    }
  };

  const handleSaveCustomPath = async (
    harnessId: HarnessId,
    customPath: string | undefined
  ) => {
    if (!settings) return;
    const nextPaths = { ...settings.customExecutablePaths };
    if (customPath) nextPaths[harnessId] = customPath;
    else delete nextPaths[harnessId];
    const saved = await window.agentTeam.saveSettings({
      ...settings,
      customExecutablePaths: nextPaths,
    });
    setSettings(saved);
    await rescanHarnesses();
  };

  const handleStartRun = async (req: StartRunRequest) => {
    const created = await window.agentTeam.startRun(req);
    setActiveRun(created);
    setRuns((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
  };

  const handleSubmitManualRoutes = async (
    runId: string,
    assignments: ManualRouteAssignment[]
  ) => {
    await window.agentTeam.submitManualRoutes({ runId, assignments });
  };

  const handleCancelRun = async () => {
    await window.agentTeam.cancelRun();
  };

  const handleDeleteRun = async (runId: string) => {
    await window.agentTeam.deleteRun(runId);
    setRuns((prev) => prev.filter((r) => r.id !== runId));
    setActiveRun((prev) => (prev?.id === runId ? null : prev));
  };

  return (
    <div className="h-screen w-screen flex bg-surface-950 text-slate-100 overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        harnesses={harnesses}
        settings={settings}
        detecting={detecting}
        onRescan={rescanHarnesses}
        isRunning={isRunning}
        awaitingManualRouting={awaitingManualRouting}
        runCount={runs.length}
      />

      <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {onboardingStep !== null && (
          <OnboardingBanner
            step={onboardingStep}
            harnesses={harnesses}
            settings={settings}
            detecting={detecting}
            onGoStep={handleGoOnboardingStep}
            onFinish={handleCompleteOnboarding}
            onSkip={handleCompleteOnboarding}
          />
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === 'workspace' && (
            <WorkspaceView
              settings={settings}
              harnesses={harnesses}
              activeRun={activeRun}
              isRunning={isRunning}
              onStartRun={handleStartRun}
              onSubmitManualRoutes={handleSubmitManualRoutes}
              onCancelRun={handleCancelRun}
              onStartOnboarding={handleStartOnboarding}
              onOpenRolesTab={() => setActiveTab('roles')}
              onUpdateWorkspaceDefault={(dir) => {
                if (!settings) return;
                void handleSaveSettings({ ...settings, defaultWorkspaceDir: dir });
              }}
              onUpdateRoutingModeDefault={(mode: RoutingMode) => {
                if (!settings) return;
                void handleSaveSettings({ ...settings, defaultRoutingMode: mode });
              }}
            />
          )}

          {activeTab === 'roles' && settings && (
            <RolesRoutingView
              settings={settings}
              harnesses={harnesses}
              onSaveSettings={handleSaveSettings}
              onResetRoles={handleResetRoles}
              onAutoFillRoutes={handleAutoFillRoutes}
            />
          )}

          {activeTab === 'harnesses' && (
            <HarnessesView
              harnesses={harnesses}
              settings={settings}
              detecting={detecting}
              onRescan={rescanHarnesses}
              onSaveCustomPath={handleSaveCustomPath}
            />
          )}

          {activeTab === 'history' && (
            <HistoryView
              runs={runs}
              onInspectRun={(run) => {
                setActiveRun(run);
                setActiveTab('workspace');
              }}
              onDeleteRun={handleDeleteRun}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
