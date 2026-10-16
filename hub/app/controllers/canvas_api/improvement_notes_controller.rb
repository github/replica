class CanvasApi::ImprovementNotesController < CanvasApi::BaseController
  include HasReviewCommentContext
  include ReviewCommentMutations

  prepend_before_action -> { reject_large_request(maximum: 1_550_000) }, only: :create
  before_action :require_writer, only: :create
  rescue_from ActiveRecord::RecordInvalid, with: :invalid_note

  # @route GET /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/improvement_notes (canvas_api_improvement_notes)
  def index
    notes = @prototype.improvement_notes.where(user: Current.user).includes(:user).order(:id).limit(201)
    return render json: { error: "Too many improvement notes." }, status: :conflict if notes.size > 200

    render json: { notes: notes.map { review_comment_json(_1) } }
  end

  # @route POST /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/improvement_notes (canvas_api_improvement_notes)
  def create
    revision = params[:revision]
    previous_revision = params[:previous_revision]
    return head :bad_request unless revision.is_a?(Integer) && revision.positive?
    return head :bad_request unless previous_revision.is_a?(Integer) && previous_revision >= 0
    return head :bad_request unless [ true, false ].include?(params[:deleted])
    return head :bad_request unless params[:anchor].is_a?(ActionController::Parameters)

    @prototype.with_lock do
      note = @prototype.improvement_notes.find_or_initialize_by(user: Current.user, local_id: params[:local_id])
      if note.persisted? && note.anchor != params[:anchor].to_unsafe_h
        return render json: { error: "A saved note's target cannot change." }, status: :conflict
      end

      if note.persisted? && revision < note.note_revision
        return render json: { error: "The Hub note has a newer revision." }, status: :conflict
      end
      if note.persisted? && revision == note.note_revision
        same = note.body == (params[:deleted] ? nil : params[:body]) &&
          note.note_status == params[:status] &&
          note.anchor == params[:anchor]&.to_unsafe_h &&
          note.deleted_at.present? == params[:deleted] &&
          note.capture == params[:capture]
        return render json: { error: "This note revision has different content." }, status: :conflict unless same

        return render json: review_comment_json(note)
      end
      return head :conflict if note.deleted_at.present?
      if previous_revision != (note.persisted? ? note.note_revision : 0)
        return render json: { error: "The Hub note changed since its last synchronization." }, status: :conflict
      end
      if note.new_record?
        return head :conflict if @prototype.improvement_notes.where(user: Current.user).count >= 200

        note.anchor = params[:anchor]&.to_unsafe_h
      end
      note.assign_attributes \
        body: params[:deleted] ? nil : params[:body],
        note_revision: revision,
        note_status: params[:status],
        capture: params[:capture]
      if params[:deleted]
        note.created_at ||= Time.current
        note.deleted_at = Time.current
      end
      note.save!
      render json: review_comment_json(note), status: :ok
    end
  end

  private

  def load_prototype
    @prototype = @repository.reviewable_prototypes.find(params[:prototype_id])
  end

  def invalid_note(error)
    render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
  end
end
