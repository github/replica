class AddPendingActionsToFreshAuthorizations < ActiveRecord::Migration[8.1]
  def change
    add_column :fresh_authorizations, :pending_action, :text
    add_column :fresh_authorizations, :continued_at, :datetime
    add_check_constraint :fresh_authorizations,
      "continued_at IS NULL OR (verified_at IS NOT NULL AND pending_action IS NULL)",
      name: "fresh_authorizations_continuation"
  end
end
