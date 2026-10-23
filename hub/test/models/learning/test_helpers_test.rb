require "test_helper"

class LearningTestHelpersTest < ActiveSupport::TestCase
  # Exercise real Minitest callbacks explicitly without adding a failing discoverable test.
  class Probe < ActiveSupport::TestCase
    attr_accessor :fail_before_helper, :fail_in_body, :replacement_root, :replacement_token, :replacement_billing
    attr_reader :created_root

    setup { raise "failure before learning setup" if fail_before_helper }
    include LearningTestHelpers

    def exercise
      @created_root = Rails.configuration.x.learning_root
      Rails.configuration.x.learning_root = replacement_root if replacement_root
      Rails.configuration.x.copilot_token = replacement_token if replacement_token
      Rails.configuration.x.copilot_billing = replacement_billing if replacement_billing
      raise "failure after learning setup" if fail_in_body
    end
  end

  test "an earlier setup failure never deletes or replaces the configured learning root" do
    with_preserved_root do |root|
      original_environment = Learning::Command.instance_method(:environment)
      probe = Probe.new("exercise")
      probe.fail_before_helper = true

      result = probe.run

      assert_equal 1, result.failures.size
      assert_includes result.failures.sole.message, "failure before learning setup"
      assert root.join("keep.txt").file?
      assert_equal root, Rails.configuration.x.learning_root
      assert_equal "existing-test-cli", ENV["REPLICA_LEARNING_CLI"]
      assert_equal "preserved-synthetic-token", Rails.configuration.x.copilot_token
      assert_equal "organization", Rails.configuration.x.copilot_billing
      assert_equal original_environment, Learning::Command.instance_method(:environment)
    end
  end

  test "a temporary-directory failure leaves every saved global unchanged" do
    with_preserved_root do |root|
      original_directory = Dir.method(:mktmpdir)
      original_environment = Learning::Command.instance_method(:environment)
      Dir.define_singleton_method(:mktmpdir) do |*arguments, **options, &block|
        raise "could not create learning test directory" if arguments.first == "replica-learning-"

        original_directory.call(*arguments, **options, &block)
      end

      result = Probe.new("exercise").run

      assert_equal 1, result.failures.size
      assert_includes result.failures.sole.message, "could not create learning test directory"
      assert root.join("keep.txt").file?
      assert_equal root, Rails.configuration.x.learning_root
      assert_equal "existing-test-cli", ENV["REPLICA_LEARNING_CLI"]
      assert_equal "preserved-synthetic-token", Rails.configuration.x.copilot_token
      assert_equal "organization", Rails.configuration.x.copilot_billing
      assert_equal original_environment, Learning::Command.instance_method(:environment)
    ensure
      Dir.define_singleton_method(:mktmpdir, original_directory)
    end
  end

  test "teardown deletes only its own temporary directory even when the configured root changes" do
    with_preserved_root do |root|
      Dir.mktmpdir("other-learning-root-") do |directory|
        replacement = Pathname(directory)
        replacement.join("keep.txt").write("unrelated test data")
        original_environment = Learning::Command.instance_method(:environment)
        probe = Probe.new("exercise")
        probe.replacement_root = replacement
        probe.replacement_token = "different-synthetic-token"
        probe.replacement_billing = "token_owner"
        probe.fail_in_body = true

        result = probe.run

        assert_equal 1, result.failures.size
        assert_includes result.failures.sole.message, "failure after learning setup"
        assert_not probe.created_root.exist?
        assert replacement.join("keep.txt").file?
        assert root.join("keep.txt").file?
        assert_equal root, Rails.configuration.x.learning_root
        assert_equal "existing-test-cli", ENV["REPLICA_LEARNING_CLI"]
        assert_equal "preserved-synthetic-token", Rails.configuration.x.copilot_token
        assert_equal "organization", Rails.configuration.x.copilot_billing
        assert_equal original_environment, Learning::Command.instance_method(:environment)
      end
    end
  end

  test "teardown restores an explicitly captured missing token after the body changes it" do
    with_preserved_root do
      Rails.configuration.x.copilot_token = nil
      probe = Probe.new("exercise")
      probe.replacement_token = "different-synthetic-token"
      probe.fail_in_body = true

      result = probe.run

      assert_equal 1, result.failures.size
      assert_includes result.failures.sole.message, "failure after learning setup"
      assert_nil Rails.configuration.x.copilot_token
    end
  end

  private

  # A sentinel root is always owned by this test; failures never touch a real configured store.
  def with_preserved_root
    original_root = Rails.configuration.x.learning_root
    original_cli = ENV["REPLICA_LEARNING_CLI"]
    original_token = Rails.configuration.x.copilot_token
    original_billing = Rails.configuration.x.copilot_billing
    original_environment = Learning::Command.instance_method(:environment)
    Dir.mktmpdir("preserved-learning-root-") do |directory|
      root = Pathname(directory)
      root.join("keep.txt").write("preserved test data")
      Rails.configuration.x.learning_root = root
      ENV["REPLICA_LEARNING_CLI"] = "existing-test-cli"
      Rails.configuration.x.copilot_token = "preserved-synthetic-token"
      Rails.configuration.x.copilot_billing = "organization"
      yield root
    ensure
      Rails.configuration.x.learning_root = original_root
      ENV["REPLICA_LEARNING_CLI"] = original_cli
      Rails.configuration.x.copilot_token = original_token
      Rails.configuration.x.copilot_billing = original_billing
      Learning::Command.define_method(:environment, original_environment)
      Learning::Command.send(:private, :environment)
    end
  end
end
