class AddImprovementNotesToReviewComments < ActiveRecord::Migration[8.1]
  def change
    add_column :review_comments, :kind, :string, null: false, default: "review"
    add_column :review_comments, :local_id, :string
    add_column :review_comments, :note_revision, :integer
    add_column :review_comments, :note_status, :string
    add_column :review_comments, :capture, :text
    add_index :review_comments, %i[prototype_id user_id local_id], unique: true
    add_check_constraint :review_comments,
      "(kind = 'review' AND local_id IS NULL AND note_revision IS NULL AND note_status IS NULL AND capture IS NULL) OR " \
      "(kind = 'improvement_note' AND root_id IS NULL AND build_id IS NULL AND local_id IS NOT NULL AND length(local_id) = 36 AND note_revision IS NOT NULL AND note_revision > 0 AND note_status IS NOT NULL AND note_status IN ('open', 'sent', 'ready', 'resolved', 'blocked') AND (capture IS NULL OR length(CAST(capture AS BLOB)) <= 1500000))",
      name: "review_comments_kind"
    remove_check_constraint :review_comments,
      "(root_id IS NULL AND build_id IS NOT NULL AND anchor IS NOT NULL) OR (root_id IS NOT NULL AND build_id IS NULL AND anchor IS NULL)",
      name: "review_comments_thread_shape"
    add_check_constraint :review_comments,
      "(root_id IS NULL AND anchor IS NOT NULL AND (build_id IS NOT NULL OR kind = 'improvement_note')) OR (kind = 'review' AND root_id IS NOT NULL AND build_id IS NULL AND anchor IS NULL)",
      name: "review_comments_thread_shape"
  end
end
