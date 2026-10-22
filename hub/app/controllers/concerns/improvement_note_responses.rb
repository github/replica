# Serializes improvement notes without depending on review comment responses.
module ImprovementNoteResponses
  private

  # Renders one root and its relational conversation.
  def improvement_note_json(note)
    can_write = note.editable_by?(Current.user) &&
      @repository.authorization.sufficient?(@repository_permission, minimum: :write)
    {
      id: note.id, kind: "improvement_note", localId: note.local_id,
      revision: note.note_revision, status: note.note_status,
      buildNumber: note.build.number,
      body: note.body, anchor: note.anchor,
      thread: note.note_thread,
      deletedAt: note.deleted_at&.iso8601(6),
      createdAt: note.created_at.iso8601(6), updatedAt: note.updated_at.iso8601(6),
      author: { login: note.user.login, name: note.user.name, avatarUrl: note.user.avatar_url },
      viewerCanEdit: can_write, viewerCanDelete: can_write
    }
  end
end
