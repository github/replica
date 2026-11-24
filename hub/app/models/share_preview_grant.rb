# == Schema Information
#
# Table name: share_preview_grants
# Database name: primary
#
#  id            :integer          not null, primary key
#  expires_at    :datetime         not null
#  return_path   :string(2048)     default("/"), not null
#  token_digest  :string           not null
#  created_at    :datetime         not null
#  updated_at    :datetime         not null
#  share_link_id :integer          not null
#
# Indexes
#
#  index_share_preview_grants_on_share_link_id  (share_link_id)
#  index_share_preview_grants_on_token_digest   (token_digest) UNIQUE
#
# Foreign Keys
#
#  share_link_id  (share_link_id => share_links.id) ON DELETE => cascade
#
# Check Constraints
#
#  share_preview_grants_return_path   (length(CAST(return_path AS BLOB)) BETWEEN 1 AND 2048 AND substr(return_path, 1, 1) = '/')
#  share_preview_grants_token_digest  (length(token_digest) = 64 AND token_digest NOT GLOB '*[^0-9a-f]*')
#
# Gives one browser a short-lived handoff to a shared Build preview.
class SharePreviewGrant < ApplicationRecord
  TOKEN_FORMAT = /\A[0-9a-f]{64}\z/

  belongs_to :share_link

  validates :token_digest, format: { with: TOKEN_FORMAT }, uniqueness: true
  validates :expires_at, presence: true

  class << self
    # Creates one grant and returns the secret sent to the preview host.
    def issue!(share_link:, return_path: nil)
      token = SecureRandom.urlsafe_base64(32)
      grant = transaction do
        share_link.reload
        raise SharingSetting::Disabled if !share_link.available?

        create! \
          share_link:,
          return_path: PreviewGrant.validate_return_path(
            return_path || share_link.prototype.start_page || "/"
          ),
          token_digest: Digest::SHA256.hexdigest(token),
          expires_at: 2.minutes.from_now
      end
      Analytics::Event.record_page_view do
        Analytics::Event.record! \
          repository: share_link.prototype.repository,
          name: "shared_preview_opened",
          source_key: "share_preview_grant/#{grant.id}/issued",
          properties: { prototype_id: share_link.prototype_id, build_id: share_link.build_id }
      end
      token
    end

    # Returns one fresh grant for the Build named by the preview host.
    def find_valid(token, build_id:)
      return if !token.is_a?(String) || token.bytesize > 128

      grant = includes(share_link: { build: { prototype: :repository } })
        .find_by(token_digest: Digest::SHA256.hexdigest(token))
      return if grant.nil? || grant.share_link.build_id != build_id
      return if grant.expires_at <= Time.current || !grant.share_link.available?

      grant
    end

    # Consumes a fresh grant once.
    def consume(grant)
      transaction do
        live = includes(share_link: { build: { prototype: :repository } }).find_by(id: grant.id)
        live && live.expires_at > Time.current && live.share_link.available? &&
          where(id: live.id).delete_all == 1
      end
    end

    # Removes expired grants that can no longer authorize a preview.
    def clear_expired!
      where(expires_at: ..Time.current).delete_all
    end
  end
end
