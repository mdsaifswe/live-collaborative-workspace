import React from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { Search, Filter } from 'lucide-react';
import { TaskStatus, TaskPriority } from '../../shared/types';

export const TaskFilters: React.FC = () => {
  const { filters, setFilters, filteredTasks, tasks } = useWorkspace();

  return (
    <section className="workspace-toolbar" aria-label="Task filters and search">
      <div className="filter-group">
        <div className="search-input-wrapper">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            className="search-input"
            placeholder="Search tasks..."
            value={filters.searchQuery}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
            }
            aria-label="Search tasks by title or description"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Filter size={16} style={{ color: 'var(--text-dim)' }} aria-hidden="true" />
          <select
            className="filter-select"
            value={filters.statusFilter}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                statusFilter: e.target.value as TaskStatus | 'all',
              }))
            }
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="review">Under Review</option>
            <option value="done">Completed</option>
          </select>

          <select
            className="filter-select"
            value={filters.priorityFilter}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                priorityFilter: e.target.value as TaskPriority | 'all',
              }))
            }
            aria-label="Filter by priority"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Showing <strong>{filteredTasks.length}</strong> of <strong>{tasks.length}</strong> tasks
      </div>
    </section>
  );
};
