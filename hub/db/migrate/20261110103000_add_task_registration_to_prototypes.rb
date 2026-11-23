class AddTaskRegistrationToPrototypes < ActiveRecord::Migration[8.1]
  def change
    add_index :task_connections, %i[id repository_id branch_name],
      unique: true, name: "task_connections_registration_identity"
    add_reference :prototypes, :registration_task_connection, index: true
    add_foreign_key :prototypes, :task_connections,
      column: %i[registration_task_connection_id repository_id branch_name],
      primary_key: %i[id repository_id branch_name], on_delete: :restrict
    add_check_constraint :prototypes,
      "registration_task_connection_id IS NULL OR author_id IS NULL",
      name: "prototypes_registration_actor"
  end
end
