class IndexPrototypeGallery < ActiveRecord::Migration[8.1]
  def change
    add_index :prototypes, [ :repository_id, :registered_at, :id ],
      name: "index_prototypes_on_gallery_order",
      where: "branch_deleted_at IS NULL AND registered_at IS NOT NULL"
    add_index :prototypes, [ :repository_id, :author_id, :registered_at, :id ],
      name: "index_prototypes_on_gallery_author",
      where: "branch_deleted_at IS NULL AND registered_at IS NOT NULL"
  end
end
