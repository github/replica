# Presents only the signed-in recipient's currently accessible conversation activity.
class NotificationsController < SuperglueController
  include HasRepositoryWorkspace
  before_action { response.headers["Cache-Control"] = "private, no-store" }

  rescue_from GithubClient::Error, with: :unavailable

  # @route GET /notifications (notifications)
  def index
    @notifications_unread_count = Notification.visible_to(Current.user).where(read_at: nil).count
  end

  # @route GET /notifications/inbox (inbox_notifications)
  def inbox
    relation = Notification.visible_to(Current.user)
    unread_count = relation.where(read_at: nil).count
    relation = relation.where(read_at: nil) if params[:unread] == "true"
    limit = params[:limit].presence || "50"
    unless limit.is_a?(String) && limit.match?(/\A[1-9]\d*\z/) && limit.to_i <= 50
      raise ActionController::BadRequest
    end
    limit = limit.to_i
    if params[:before].present?
      raise ActionController::BadRequest unless params[:before].is_a?(String) && params[:before].match?(/\A[1-9]\d*\z/)

      relation = relation.where(id: ...params[:before].to_i)
    end

    rows = relation.includes(:actor, review_comment: { prototype: :repository })
      .order(id: :desc).limit(limit + 1).to_a
    reaction_ids = rows.select { _1.kind == "comment_reaction" }.map { _1.source_key.delete_prefix("reaction/").to_i }
    reactions = ReviewCommentReaction.where(id: reaction_ids).pluck(:id, :content)
      .to_h.transform_keys { "reaction/#{_1}" }
    render json: {
      notifications: rows.first(limit).map { notification_json(_1, reactions:) },
      nextBefore: rows.length > limit ? rows[limit - 1].id : nil,
      unreadCount: unread_count
    }
  end

  # @route GET /notifications/:id (notification)
  def show
    notification = Notification.visible_to(Current.user).find(params[:id])
    notification.record_opened_by(Current.user)
    render json: { commentId: notification.review_comment.id, version: notification.lock_version }
  end

  # @route PATCH /notifications/:id (notification)
  # @route PUT /notifications/:id (notification)
  def update
    relation = Notification.visible_to(Current.user)
    notification = relation.find(params[:id])
    attributes = params.require(:notification).permit(:read, :version)
    unless [ true, false ].include?(attributes[:read]) && attributes[:version].is_a?(Integer) && attributes[:version] >= 0
      raise ActionController::BadRequest
    end

    notification.lock_version = attributes[:version]
    notification.update! read_at: attributes[:read] ? Time.current : nil
    render json: {
      version: notification.lock_version,
      read: notification.read_at.present?,
      unreadCount: relation.where(read_at: nil).count
    }
  rescue ActiveRecord::StaleObjectError
    head :conflict
  end

  private

  def notification_json(notification, reactions:)
    message = notification.review_comment
    prototype = message.prototype
    {
      id: notification.id,
      version: notification.lock_version,
      kind: Notification::KINDS.fetch(notification.kind),
      reactionContent: reactions[notification.source_key],
      actor: { login: notification.actor.login, name: notification.actor.name, avatarUrl: notification.actor.avatar_url },
      excerpt: message.body.to_s.truncate(240),
      createdAt: notification.created_at.iso8601(6),
      read: notification.read_at.present?,
      repository: prototype.repository.name_with_owner,
      prototype: prototype.name.presence || prototype.branch_name,
      target: { prototypeId: prototype.id, threadId: message.root_id || message.id, commentId: message.id },
      path: repository_prototype_path(prototype.repository.route_id, prototype, comment: message.id, notification: notification.id),
      updatePath: notification_path(notification)
    }
  end

  def unavailable
    head :service_unavailable
  end
end
