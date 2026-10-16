require "securerandom"

# Imports one complete snapshot of a repository's review comments into its learning store.
#
# The snapshot uses the format the canvas comment actions record
# (replica.hub-review-collection/v1): every thread with all of its replies that existed when it
# was captured. Hub writes it to a private temporary file and deletes the file after the import.
# The store keeps each comment version once, so importing the same comments again adds nothing.
# Hub erases a deleted comment's text, so the import asks the store to remove the text it still
# holds for every comment the snapshot shows as deleted, and for the labels on it.
class Learning::Collection
  KIND = "replica.hub-review-collection/v1".freeze
  ACTOR = "system:replica-hub".freeze
  CONTENT_TRUST = { source: Learning::Store::SOURCE, untrusted: true, treatAs: "data" }.freeze
  TIMEOUT = 5.minutes

  def initialize(store, captured_at: Time.current, snapshot_id: SecureRandom.uuid)
    @store = store
    @repository = store.repository
    @captured_at = captured_at.utc
    @snapshot_id = snapshot_id
  end

  # Imports the snapshot under the given grants and returns what the store reported.
  def import!(grant_ids)
    Tempfile.create([ "hub-comments-", ".json" ]) do |file|
      file.write(JSON.generate(log))
      file.flush
      @store.call \
        "import", "hub-comments", file.path,
        *grant_ids.flat_map { [ "--grant", _1 ] },
        "--actor", ACTOR,
        "--redact-deleted",
        timeout: TIMEOUT
    end
  end

  # The recorded call log, as replica-learning reads it.
  def log
    {
      kind: KIND,
      reviewerIdentity: "stable-user-id",
      calls: [
        {
          action: "list_repository_comments",
          input: { resolution: "all", read: "all" },
          result: {
            contentTrust: CONTENT_TRUST,
            target:,
            snapshotId: @snapshot_id,
            capturedAt: @captured_at.iso8601(6),
            scanComplete: true,
            hasMore: false,
            nextCursor: nil,
            threads:
          }
        }
      ]
    }
  end

  private

  # The repository named as the store names it, so the store accepts these comments as its own.
  def target
    {
      scope: "repository",
      hubOrigin: Rails.configuration.x.hub_origin.delete_suffix("/"),
      repository: @store.scope.split("/", 2).last,
      repositoryId: @repository.id,
      branch: @repository.default_branch
    }
  end

  def threads
    existing = ReviewComment.ordinary.where(created_at: ..@captured_at)
    roots = existing.where(prototype: @repository.reviewable_prototypes, root_id: nil).where.not(build_id: nil)
      .includes(:user, :build, :prototype, :resolved_by).order(:created_at, :id).to_a
    replies = existing.where(root_id: roots.map(&:id)).includes(:user, :prototype)
      .order(:created_at, :id).group_by(&:root_id)
    roots.map do |root|
      message(root).merge \
        replies: replies.fetch(root.id, []).map { message(_1) },
        threadComplete: true,
        repliesHasMore: false,
        repliesNextCursor: nil
    end
  end

  def message(comment)
    payload = {
      id: comment.id,
      kind: comment.root_id ? "reply" : "root",
      body: comment.deleted_at ? nil : comment.body,
      author: author(comment.user),
      createdAt: comment.created_at.utc.iso8601(6),
      updatedAt: comment.updated_at.utc.iso8601(6),
      editedAt: comment.edited_at&.utc&.iso8601(6),
      deletedAt: comment.deleted_at&.utc&.iso8601(6),
      prototype: { id: comment.prototype.id, name: comment.prototype.name, branch: comment.prototype.branch_name }
    }
    return payload.merge(rootId: comment.root_id) if comment.root_id

    payload.merge \
      buildNumber: comment.build.number,
      anchor: comment.anchor,
      resolvedAt: comment.resolved_at&.utc&.iso8601(6),
      resolvedBy: comment.resolved_by && author(comment.resolved_by)
  end

  # Pins the authenticated account, keeping its mutable login only as display metadata.
  def author(user)
    local = @repository.local?
    if local != user.github_id.nil?
      raise Learning::Error.new \
        "A reviewer's identity does not match this repository's source.",
        code: "invalid_input"
    end

    identity = local ? { localId: user.id } : { githubId: user.github_id }
    { login: user.login, name: user.name, **identity }
  end
end
