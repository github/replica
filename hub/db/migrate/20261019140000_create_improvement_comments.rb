class CreateImprovementComments < ActiveRecord::Migration[8.1]
  def change
    create_table :improvement_comments do |t|
      t.references :prototype, null: false, foreign_key: { on_delete: :restrict }
      t.references :user, null: false, foreign_key: { on_delete: :restrict }
      t.integer :build_id
      t.integer :root_id
      t.string :local_id, null: false
      t.string :thread_key, null: false
      t.integer :position, null: false, default: 0
      t.string :role, null: false, default: "author"
      t.string :status, null: false, default: "open"
      t.text :body
      t.json :author_snapshot
      t.json :anchor
      t.integer :note_revision
      t.string :note_status
      t.datetime :deleted_at
      t.timestamps
    end
    add_index :improvement_comments, %i[prototype_id user_id local_id], unique: true
    add_index :improvement_comments, %i[id prototype_id user_id local_id], unique: true, name: "improvement_comments_root_identity"
    add_index :improvement_comments, %i[id prototype_id user_id thread_key], unique: true, name: "improvement_comments_thread_identity"
    add_index :improvement_comments, %i[root_id position], unique: true
    add_index :improvement_comments, %i[prototype_id created_at id]
    add_index :improvement_comments, :build_id
    add_foreign_key :improvement_comments, :builds,
      column: %i[build_id prototype_id], primary_key: %i[id prototype_id], on_delete: :restrict
    add_foreign_key :improvement_comments, :improvement_comments,
      column: %i[root_id prototype_id user_id thread_key],
      primary_key: %i[id prototype_id user_id local_id], on_delete: :restrict
    add_check_constraint :improvement_comments,
      "(root_id IS NULL AND position = 0 AND role = 'author' AND thread_key = local_id AND build_id IS NOT NULL AND anchor IS NOT NULL AND note_revision > 0 AND note_revision IS NOT NULL AND note_status IN ('open', 'sent', 'ready', 'resolved', 'blocked') AND note_status IS NOT NULL) OR " \
      "(root_id IS NOT NULL AND root_id <> id AND position > 0 AND build_id IS NULL AND anchor IS NULL AND note_revision IS NULL AND note_status IS NULL)",
      name: "improvement_comments_shape"
    add_check_constraint :improvement_comments,
      "(role = 'author' AND status IN ('open', 'sent', 'ready', 'blocked')) OR (role = 'copilot' AND status IN ('ready', 'blocked') AND author_snapshot IS NULL)",
      name: "improvement_comments_role_status"
    add_check_constraint :improvement_comments,
      "CASE WHEN deleted_at IS NULL THEN body IS NOT NULL AND length(trim(body)) > 0 AND length(CAST(body AS BLOB)) <= 10000 ELSE body IS NULL AND author_snapshot IS NULL END",
      name: "improvement_comments_body"
    add_check_constraint :improvement_comments,
      "length(local_id) = 36 AND length(thread_key) = 36", name: "improvement_comments_local_id"
    add_check_constraint :improvement_comments,
      "anchor IS NULL OR (json_valid(anchor) AND json_type(anchor) = 'object' AND length(CAST(anchor AS BLOB)) <= 16384)",
      name: "improvement_comments_anchor"
    add_check_constraint :improvement_comments,
      "author_snapshot IS NULL OR (json_valid(author_snapshot) AND json_type(author_snapshot) = 'object')",
      name: "improvement_comments_author"

    create_table :improvement_comment_replies do |t|
      t.integer :response_id, null: false
      t.integer :request_id, null: false
      t.references :prototype, null: false
      t.references :user, null: false
      t.string :thread_key, null: false
      t.integer :position, null: false
    end
    add_index :improvement_comment_replies, %i[response_id request_id], unique: true
    add_index :improvement_comment_replies, %i[response_id position], unique: true
    add_index :improvement_comment_replies, :request_id
    add_index :improvement_comment_replies, %i[prototype_id user_id thread_key], name: "improvement_comment_replies_thread"
    %i[response_id request_id].each do |column|
      add_foreign_key :improvement_comment_replies, :improvement_comments,
        column: [ column, :prototype_id, :user_id, :thread_key ],
        primary_key: %i[id prototype_id user_id thread_key], on_delete: :restrict
    end
    add_check_constraint :improvement_comment_replies,
      "response_id <> request_id AND position >= 0", name: "improvement_comment_replies_shape"
  end
end
