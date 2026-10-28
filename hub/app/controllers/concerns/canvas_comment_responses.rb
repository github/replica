# Combines explicitly requested improvements and reviews at the canvas feed boundary.
module CanvasCommentResponses
  extend ActiveSupport::Concern

  include ReviewCommentPages
  include ImprovementNoteResponses

  private

  def canvas_comments_for(prototypes, filter: "exclude")
    comments = []
    unless filter == "only"
      comments.concat \
        ReviewComment.where(prototype: prototypes)
          .includes(:prototype, :build, :user, :resolved_by, :reactions, comment_mentions: :github_identity).to_a
    end
    unless filter == "exclude"
      comments.concat \
        ImprovementComment.roots.where(prototype: prototypes)
          .includes(:prototype, :build, :user, replies: { request_links: :request }).to_a
    end
    comments.sort_by { [ _1.created_at, _1.id, _1.class.name ] }.reverse
  end

  def canvas_comment_json(comment)
    comment.is_a?(ImprovementComment) ? improvement_note_json(comment) : review_comment_json(comment)
  end
end
