require "test_helper"
require_relative "../support/security_rate_limit_store"

# Exercises the existing authenticated boundary for standalone peer action names.
class SecurityAdminRateLimitProbeController < ApplicationController
  before_action :authorize_admin

  def create = render(json: { changed: true })
  def update = render(json: { changed: true })
  def destroy = render(json: { changed: true })
  def show = render(json: { changed: false })
  def edit = render(json: { changed: false })
  def reset_confirmation = render(json: { changed: false })

  private

  def authorize_admin
    head :forbidden if !User.where(id: Current.user.id, hub_admin: true).where.not(github_id: nil).exists?
  end
end

class SecurityAdminRateLimitsTest < ActionController::TestCase
  tests SecurityAdminRateLimitProbeController
  include SecurityRateLimitStore

  setup do
    @routes = ActionDispatch::Routing::RouteSet.new
    @routes.draw do
      %w[create update destroy show edit reset_confirmation].each do |action|
        match action, to: "security_admin_rate_limit_probe##{action}", via: :all
      end
    end
    use_security_rate_limit_store
    @user = users.create(hub_admin: true)
    @request.session[:authenticated_session_id] = @user.sessions.create!.id
    @request.accept = "application/json"
    travel_to Time.current.change(usec: 0)
  end

  teardown do
    restore_security_rate_limit_store
    travel_back
  end

  test "every documented admin mutation spends the same ten-request allowance" do
    operations = {
      "hub_admins" => :update,
      "sharing_settings" => :update,
      "session_revocations" => :create,
      "github_apps" => :destroy,
      "github_app_credentials" => :update,
      "github_app_webhook_rotations" => :create
    }.to_a + [ [ "github_app_webhook_rotations", :destroy ] ]
    10.times do |index|
      dispatch(*operations[index % operations.size])
      assert_response :success
    end
    operations.each do |controller, action|
      dispatch(controller, action)
      assert_security_throttle(60)
    end
    travel 60.seconds
    dispatch("sharing_settings", :update)
    assert_response :success
  end

  test "reads and lookalike controllers never match the mutation registry" do
    {
      "hub_admins" => :edit, "sharing_settings" => :show, "session_revocations" => :show,
      "github_apps" => :reset_confirmation, "github_app_credentials" => :edit,
      "github_app_webhook_rotations" => :show, "not_sharing_settings" => :update
    }.each do |controller, action|
      11.times do
        dispatch(controller, action)
        assert_response :success
      end
    end
    assert_nil Rails.cache.read("rate-limit:security:hub_admin:#{@user.id}")
  end

  test "ordinary and revoked users fail normal authorization without spending an admin budget" do
    @user.update!(hub_admin: false)
    11.times do
      dispatch("sharing_settings", :update)
      assert_response :forbidden
    end
    assert_nil Rails.cache.read("rate-limit:security:hub_admin:#{@user.id}")
  end

  test "an admin flag without a live GitHub identity does not spend the admin budget" do
    @user.update_columns(github_id: nil)
    dispatch("github_apps", :destroy)
    assert_redirected_to "http://test.host/"
    assert_nil Rails.cache.read("rate-limit:security:hub_admin:#{@user.id}")
  end

  test "admin allowances belong to users rather than Sessions" do
    10.times { dispatch("sharing_settings", :update) }
    @request.session[:authenticated_session_id] = @user.sessions.create!.id
    dispatch("session_revocations", :create)
    assert_security_throttle(60)
    other = users.create(github_id: 1002, login: "mona", hub_admin: true)
    @request.session[:authenticated_session_id] = other.sessions.create!.id
    dispatch("session_revocations", :create)
    assert_response :success
  end

  private

  def dispatch(controller_path, action)
    @controller.define_singleton_method(:controller_path) { controller_path }
    process action, method: action.in?(%i[show edit reset_confirmation]) ? :get : :post, format: :json
  end
end
