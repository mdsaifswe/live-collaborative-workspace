import React, { useState, useEffect, useRef } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { TaskStatus, TaskPriority } from '../../shared/types';
import { X } from 'lucide-react';

interface TaskFormProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TaskForm: React.FC<TaskFormProps> = ({ isOpen, onClose }) => {
  const { createTask, currentUser } = useWorkspace();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      await createTask({
        id: taskId,
        title: title.trim(),
        description: description.trim(),
        status,
        priority,
        dueDate: dueDate || undefined,
        createdBy: currentUser.id,
      });

      // Reset & close
      setTitle('');
      setDescription('');
      setStatus('todo');
      setPriority('medium');
      setDueDate('');
      onClose();
    } catch (err) {
      console.error('Failed creating task:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-task-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content">
        <div className="modal-header">
          <h2 id="new-task-modal-title">Create New Task</h2>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '0.3rem', borderRadius: '50%' }}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label htmlFor="task-title" className="form-label">
                Task Title *
              </label>
              <input
                id="task-title"
                ref={titleInputRef}
                type="text"
                className="form-input"
                placeholder="e.g. Implement WebSocket heartbeat"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                aria-required="true"
              />
            </div>

            <div className="form-group">
              <label htmlFor="task-description" className="form-label">
                Description
              </label>
              <textarea
                id="task-description"
                className="form-textarea"
                rows={3}
                placeholder="Provide context, acceptance criteria, or technical details..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="task-status" className="form-label">
                  Status
                </label>
                <select
                  id="task-status"
                  className="form-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="done">Done</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="task-priority" className="form-label">
                  Priority
                </label>
                <select
                  id="task-priority"
                  className="form-select"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="task-due-date" className="form-label">
                Due Date
              </label>
              <input
                id="task-due-date"
                type="date"
                className="form-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              id="btn-submit-task"
              disabled={!title.trim() || isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
