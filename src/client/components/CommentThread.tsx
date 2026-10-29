import React, { useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { Send, Trash2 } from 'lucide-react';

interface CommentThreadProps {
  taskId: string;
}

export const CommentThread: React.FC<CommentThreadProps> = ({ taskId }) => {
  const { comments, createComment, deleteComment, currentUser } = useWorkspace();
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const taskComments = comments.filter((c) => c.taskId === taskId && !c.isDeleted);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await createComment(taskId, content.trim());
      setContent('');
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTimestamp = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <section className="comment-section" aria-label="Task comments thread">
      <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>
        Discussion ({taskComments.length})
      </h3>

      <div className="comment-list" role="feed" aria-label="Comments">
        {taskComments.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            No comments yet. Start the conversation!
          </p>
        ) : (
          taskComments.map((comment) => (
            <article
              key={comment.id}
              className="comment-bubble"
              data-testid="comment-item"
              data-comment-id={comment.id}
            >
              <div className="comment-bubble-header">
                <span className="comment-author">{comment.authorName}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <time className="comment-time" dateTime={new Date(comment.createdAt).toISOString()}>
                    {formatTimestamp(comment.createdAt)}
                  </time>
                  {comment.authorId === currentUser.id && (
                    <button
                      onClick={() => deleteComment(comment.id)}
                      className="btn"
                      style={{ padding: '0.1rem', background: 'transparent', color: 'var(--text-dim)' }}
                      title="Delete comment"
                      aria-label="Delete comment"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              <p className="comment-content">{comment.content}</p>
            </article>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <input
          type="text"
          className="form-input"
          style={{ flex: 1 }}
          placeholder="Write a comment..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="Add a comment"
          id="comment-input"
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!content.trim() || isSubmitting}
          id="btn-post-comment"
          aria-label="Send comment"
        >
          <Send size={14} />
          <span>Post</span>
        </button>
      </form>
    </section>
  );
};
