class CreateTaskConnections < ActiveRecord::Migration[8.1]
  def change
    create_table :task_connections do |table|
      table.references :repository, null: false, foreign_key: { on_delete: :restrict }
      table.references :approving_user, foreign_key: { to_table: :users, on_delete: :restrict }
      table.string :branch_name, null: false
      table.string :device_code_digest
      table.string :user_code, null: false
      table.datetime :approval_expires_at, null: false
      table.datetime :approved_at
      table.datetime :expires_at
      table.datetime :consumed_at
      table.datetime :revoked_at
      table.string :token_digest
      table.timestamps
      table.index :device_code_digest, unique: true
      table.index :user_code, unique: true
      table.index :token_digest, unique: true
      table.check_constraint "length(trim(branch_name)) BETWEEN 1 AND 255", name: "task_connections_branch"
      table.check_constraint \
        "(approved_at IS NULL AND approving_user_id IS NULL AND expires_at IS NULL) OR " \
          "(approved_at IS NOT NULL AND approving_user_id IS NOT NULL AND expires_at IS NOT NULL " \
          "AND julianday(expires_at) = julianday(approved_at) + 1)",
        name: "task_connections_approval"
      table.check_constraint \
        "(consumed_at IS NULL AND token_digest IS NULL) OR " \
          "(approved_at IS NOT NULL AND consumed_at IS NOT NULL AND token_digest IS NOT NULL AND device_code_digest IS NULL)",
        name: "task_connections_consumption"
    end
  end
end
