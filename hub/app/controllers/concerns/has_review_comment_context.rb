# Shares request limits and repository access across review comment controllers.
# It also builds their JSON responses.
module HasReviewCommentContext
  extend ActiveSupport::Concern
  include ReviewCommentPages

  included do
    before_action :load_prototype

    rescue_from GithubClient::Error, with: :repository_unavailable
    rescue_from ActiveRecord::RecordInvalid, with: :invalid_comment
    rescue_from ReviewComment::TooManyMentions, with: :too_many_mentions
  end

  private

  # Rejects a comment request larger than the allowed byte limit.
  def reject_large_request(maximum: ReviewComment::REQUEST_MAXIMUM_BYTES)
    content_length = request.get_header("CONTENT_LENGTH")
    if content_length.present?
      return head :content_too_large if content_length.to_i > maximum

      return
    end

    body = request.body.read(maximum + 1)
    return head :content_too_large if body.bytesize > maximum

    request.set_header("rack.input", StringIO.new(body))
    request.set_header("CONTENT_LENGTH", body.bytesize.to_s)
  end

  # Loads one Prototype only after GitHub confirms repository access.
  def load_prototype
    @repository = Repository.find_by_route_id!(params[:repository_github_id])
    configuration = GithubAppConfiguration.current
    return head :not_found if !@repository.authorization.authorized?(Current.user, configuration:)

    @prototype = @repository.reviewable_prototypes.find(params[:prototype_id])
  end

  # Returns the only field accepted when changing or replying to a comment.
  def comment_body
    reject_note_thread_parameters!
    params.require(:review_comment).permit(:body)[:body]
  end

  # Reserves local work history for the dedicated improvement-note API.
  def reject_note_thread_parameters!
    fields = %w[note_thread thread]
    nested = params[:review_comment]
    if fields.any? { params.key?(_1) || (nested.is_a?(ActionController::Parameters) && nested.key?(_1)) }
      raise ActionController::BadRequest, "Improvement threads require the improvement notes API."
    end
  end

  # Returns changed records and tells subscribed browsers to reload when requested.
  def render_review_comment_change(comment, status: :ok, broadcast: true)
    comments = comment.reply? ? [ comment, comment.root ] : [ comment ]
    comments.each { _1.reactions.load }
    prepare_viewer_thread_reads(comments)
    render \
      json: { comments: comments.map { review_comment_json(_1) } },
      status: status
    ReviewCommentsChannel.broadcast_invalidation(@prototype) if broadcast
  end

  # Requires a positive activity version supplied as a JSON number.
  def positive_activity_version(value)
    raise ActionController::BadRequest if !value.is_a?(Integer) || !value.positive?

    value
  end

  # Returns unavailable when GitHub cannot confirm repository access.
  def repository_unavailable
    head :service_unavailable
  end

  # Returns model validation messages without saving partial thread changes.
  def invalid_comment(error)
    render \
      json: { errors: error.record.errors.full_messages },
      status: :unprocessable_entity
  end

  def too_many_mentions(error)
    render json: { errors: [ error.message ] }, status: :unprocessable_entity
  end
end
