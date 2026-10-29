import React, { useState, useEffect, useCallback } from 'react';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { WorkspaceHeader } from './components/WorkspaceHeader';
import { OfflineBanner } from './components/OfflineBanner';
import { TaskFilters } from './components/TaskFilters';
import { TaskBoard } from './components/TaskBoard';
import { TaskForm } from './components/TaskForm';
import { TaskDetailsModal } from './components/TaskDetailsModal';
import { ConflictResolutionDialog } from './components/ConflictResolutionDialog';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer';
import { Task } from '../shared/types';

const WorkspaceContent: React.FC = () => {
  const { filteredTasks } = useWorkspace();
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTask(task);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid triggering when user is typing in input or textarea
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.key === 'n' || e.key === 'c') {
        e.preventDefault();
        setIsTaskFormOpen(true);
      } else if (e.key === 'd') {
        e.preventDefault();
        setIsDiagnosticsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app-container">
      <WorkspaceHeader
        onOpenCreateTask={() => setIsTaskFormOpen(true)}
        onToggleDiagnostics={() => setIsDiagnosticsOpen((prev) => !prev)}
      />

      <OfflineBanner />

      <TaskFilters />

      <TaskBoard
        tasks={filteredTasks}
        onSelectTask={handleSelectTask}
      />

      <TaskForm
        isOpen={isTaskFormOpen}
        onClose={() => setIsTaskFormOpen(false)}
      />

      <TaskDetailsModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
      />

      <ConflictResolutionDialog />

      <DiagnosticsDrawer
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <WorkspaceProvider>
      <WorkspaceContent />
    </WorkspaceProvider>
  );
};

export default App;
