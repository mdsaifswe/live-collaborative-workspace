import React, { useMemo } from 'react';
import { Task, TaskStatus } from '../../shared/types';
import { TaskCard } from './TaskCard';
import { useWorkspace } from '../context/WorkspaceContext';

interface TaskBoardProps {
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

const TaskBoardComponent: React.FC<TaskBoardProps> = ({ tasks, onSelectTask }) => {
  const { comments, pendingOps } = useWorkspace();

  const pendingTaskIds = useMemo(() => {
    const set = new Set<string>();
    for (const op of pendingOps) {
      if (op.entityId) set.add(op.entityId);
    }
    return set;
  }, [pendingOps]);

  const commentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of comments) {
      if (!c.isDeleted) {
        map.set(c.taskId, (map.get(c.taskId) || 0) + 1);
      }
    }
    return map;
  }, [comments]);

  return (
    <main className="board-container" aria-label="Kanban task board">
      {COLUMNS.map((col) => {
        const columnTasks = tasks.filter((t) => t.status === col.id);

        return (
          <section
            key={col.id}
            className="board-column"
            data-testid={`column-${col.id}`}
            aria-labelledby={`col-header-${col.id}`}
          >
            <div className="column-header">
              <div className="column-title-group">
                <h2 id={`col-header-${col.id}`} className="column-title">
                  {col.label}
                </h2>
              </div>
              <span className="column-badge" aria-label={`${columnTasks.length} tasks`}>
                {columnTasks.length}
              </span>
            </div>

            <div className="column-cards">
              {columnTasks.map((task) => (
                <div key={task.id}>
                  <TaskCard
                    task={task}
                    isPending={pendingTaskIds.has(task.id)}
                    commentCount={commentCounts.get(task.id) || 0}
                    onClick={onSelectTask}
                  />
                </div>
              ))}

              {columnTasks.length === 0 && (
                <div
                  style={{
                    padding: '2rem 1rem',
                    textAlign: 'center',
                    color: 'var(--text-dim)',
                    fontSize: '0.85rem',
                  }}
                >
                  No tasks in {col.label}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </main>
  );
};

export const TaskBoard = React.memo(TaskBoardComponent);
