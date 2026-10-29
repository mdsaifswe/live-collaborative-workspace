import React, { useState, useEffect } from 'react';
import { Task, TaskStatus, TaskPriority } from '../../shared/types';
import { useWorkspace } from '../context/WorkspaceContext';
import { CommentThread } from './CommentThread';
import { X, Trash2, Edit2, Check, Clock } from 'lucide-react';

interface TaskDetailsModalProps {
  task: Task | null;
  onClose: () => void;
}

export const TaskDetailsModal: React.FC<TaskDetailsModalProps> = ({
  task,
  onClose,
}) => {
  const { updateTask, deleteTask, pendingOps, updatePresence } = useWorkspace();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (task) {
      setEditTitle(task.title);
      setEditDescription(task.description);
      setIsEditing(false);
      updatePresence(task.id);
    } else {
      updatePresence(undefined);
    }
  }, [task]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && task) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [task, onClose]);

  if (!task) return null;

  const isPending = pendingOps.some((op) => op.entityId === task.id);

  const handleStatusChange = async (newStatus: TaskStatus) => {
    if (newStatus === task.status) return;
    try {
      await updateTask(task.id, { status: newStatus });
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handlePriorityChange = async (newPriority: TaskPriority) => {
    if (newPriority === task.priority) return;
    try {
      await updateTask(task.id, { priority: newPriority });
    } catch (err) {
      console.error('Failed to update priority:', err);
    }
  };

  const handleSaveEdits = async () => {
    if (!editTitle.trim()) return;
    try {
      await updateTask(task.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      setIsEditing(false);
    } catch (err) {
      console.error('Failed updating task:', err);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    try {
      setIsDeleting(true);
      await deleteTask(task.id);
      onClose();
    } catch (err) {
      console.error('Failed deleting task:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-detail-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content" style={{ maxWidth: '720px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className={`priority-pill priority-${task.priority}`}>
              {task.priority}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Revision v{task.version}
            </span>
            {isPending && (
              <span className="pending-tag">
                <Clock size={12} aria-hidden="true" />
                <span>Sync pending</span>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="btn btn-secondary"
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
              aria-label="Edit task details"
              id="btn-edit-task"
            >
              <Edit2 size={14} />
              <span>{isEditing ? 'Cancel' : 'Edit'}</span>
            </button>

            <button
              onClick={handleDelete}
              className="btn btn-danger"
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
              disabled={isDeleting}
              aria-label="Delete task"
              id="btn-delete-task"
            >
              <Trash2 size={14} />
              <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
            </button>

            <button
              onClick={onClose}
              className="btn btn-secondary"
              style={{ padding: '0.3rem', borderRadius: '50%' }}
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label htmlFor="edit-task-title" className="form-label">
                  Title
                </label>
                <input
                  id="edit-task-title"
                  type="text"
                  className="form-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-task-desc" className="form-label">
                  Description
                </label>
                <textarea
                  id="edit-task-desc"
                  className="form-textarea"
                  rows={4}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleSaveEdits}
                  className="btn btn-primary"
                  id="btn-save-task-edits"
                  disabled={!editTitle.trim()}
                >
                  <Check size={14} />
                  <span>Save Changes</span>
                </button>
              </div>
            </div>
          ) : (
            <div>
              <h2
                id="task-detail-title"
                style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.75rem' }}
              >
                {task.title}
              </h2>

              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '0.95rem',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {task.description || 'No description provided.'}
              </p>
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem',
              padding: '1rem',
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <label htmlFor="task-status-change" className="form-label" style={{ display: 'block', marginBottom: '0.3rem' }}>
                Move Status
              </label>
              <select
                id="task-status-change"
                className="form-select"
                style={{ width: '100%' }}
                value={task.status}
                onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
            </div>

            <div>
              <label htmlFor="task-priority-change" className="form-label" style={{ display: 'block', marginBottom: '0.3rem' }}>
                Change Priority
              </label>
              <select
                id="task-priority-change"
                className="form-select"
                style={{ width: '100%' }}
                value={task.priority}
                onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <CommentThread taskId={task.id} />
        </div>
      </div>
    </div>
  );
};
