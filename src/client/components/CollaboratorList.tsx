import React from 'react';
import { Presence, User } from '../../shared/types';

interface CollaboratorListProps {
  presences: Presence[];
  currentUser: User;
}

export const CollaboratorList: React.FC<CollaboratorListProps> = ({
  presences,
  currentUser,
}) => {
  // Combine current user with other presences
  const others = presences.filter((p) => p.userId !== currentUser.id);

  return (
    <div
      className="collaborator-group"
      aria-label="Active collaborators in this workspace"
      title={`${others.length + 1} active collaborators`}
    >
      <div
        className="collaborator-avatar"
        style={{ backgroundColor: currentUser.color }}
        title={`${currentUser.name} (You)`}
      >
        {currentUser.name.charAt(0).toUpperCase()}
      </div>

      {others.slice(0, 4).map((collab) => (
        <div
          key={collab.userId}
          className="collaborator-avatar"
          style={{ backgroundColor: collab.userColor || '#8b5cf6' }}
          title={collab.userName}
        >
          {collab.userName.charAt(0).toUpperCase()}
        </div>
      ))}

      {others.length > 4 && (
        <div
          className="collaborator-avatar"
          style={{ backgroundColor: '#374151' }}
          title={`${others.length - 4} more collaborators`}
        >
          +{others.length - 4}
        </div>
      )}
    </div>
  );
};
