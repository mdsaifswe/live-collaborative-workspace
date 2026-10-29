import React from 'react';
import { Task } from '../../shared/types';
import { MessageSquare, Clock, Calendar } from 'lucide-react';

interface TaskCardProps {
  task: Task;
  isPending?: boolean;
  commentCount?: number;
  onClick: (task: Task) => void;
}

const TaskCardComponent: React.FC<TaskCardProps> = ({
  task,
  isPending = false,
  commentCount = 0,
  onClick,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(task);
    }
  };

  return (
    <article
      className="task-card"
      tabIndex={0}
      role="button"
      data-testid="task-card"
      data-task-id={task.id}
      data-version={task.version}
      data-comment-count={commentCount}
      onClick={() => onClick(task)}
      onKeyDown={handleKeyDown}
      aria-label={`Task: ${task.title}. Priority: ${task.priority}. Status: ${task.status}${task.dueDate ? `. Due date: ${task.dueDate}` : ''}`}
    >
      <div className="task-card-header">
        <h3 className="task-card-title">{task.title}</h3>
        {isPending && (
          <span className="pending-tag" title="Sync pending with server">
            <Clock size={10} aria-hidden="true" />
            <span>Syncing</span>
          </span>
        )}
      </div>

      {task.description && <p className="task-card-desc">{task.description}</p>}

      <div className="task-card-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <span className={`priority-pill priority-${task.priority}`}>
            {task.priority}
          </span>
          {task.dueDate && (
            <span
              className="task-due-date"
              data-testid="task-due-date"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.12rem 0.4rem',
              }}
              title={`Due date: ${task.dueDate}`}
            >
              <Calendar size={11} aria-hidden="true" color="var(--accent-primary)" />
              <span>{task.dueDate}</span>
            </span>
          )}
        </div>

        <div className="task-meta-icons">
          {commentCount > 0 && (
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              title={`${commentCount} comments`}
            >
              <MessageSquare size={13} aria-hidden="true" />
              <span>{commentCount}</span>
            </span>
          )}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
            v{task.version}
          </span>
        </div>
      </div>
    </article>
  );
};

export const TaskCard = React.memo(TaskCardComponent);

