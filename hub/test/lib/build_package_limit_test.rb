require "test_helper"

class BuildPackageLimitTest < ActiveSupport::TestCase
  setup do
    @original_value = ENV["REPLICA_MAXIMUM_PACKAGE_MIB"]
    @original_maximum = Rails.configuration.x.maximum_package_bytes
  end

  teardown do
    ENV["REPLICA_MAXIMUM_PACKAGE_MIB"] = @original_value
    Rails.configuration.x.maximum_package_bytes = @original_maximum
  end

  test "defaults to 150 MiB only when the deployment variable is absent" do
    assert_equal 150.megabytes, BuildPackageLimit.parse(nil)
  end

  test "converts positive whole decimal overrides to unpacked bytes" do
    %w[1 7 151 1024].each do |value|
      assert_equal value.to_i * 1_048_576, BuildPackageLimit.parse(value)
    end
  end

  test "rejects explicit empty nonpositive decimal malformed and whitespace values" do
    [ "", "0", "-1", "1.5", "1.0", "7MiB", "abc", "+7", "1e2", "0x10",
      " ", " 7", "7 ", "7\n", "\t7" ].each do |value|
      error = assert_raises(ArgumentError, value.inspect) { BuildPackageLimit.parse(value) }
      assert_includes error.message, "REPLICA_MAXIMUM_PACKAGE_MIB"
    end
  end

  test "derives bounded ZIP overhead from the same unpacked byte budget" do
    [ 1.megabyte, 150.megabytes, 151.megabytes ].each do |maximum|
      overhead = (maximum + 999) / 1_000 +
        Build::PackageExtraction::MAXIMUM_ENTRIES * (2 * ArtifactStore::MAXIMUM_NAME_BYTES + 128) +
        64.kilobytes

      assert_equal maximum + overhead, BuildPackageLimit.maximum_download_bytes(maximum)
    end
  end

  test "limit errors give authors and deployment operators actionable guidance" do
    message = BuildPackageLimit.limit_message(7.megabytes)

    assert_includes message, "7 MiB"
    assert_match(/unpacked/i, message)
    assert_includes message, "REPLICA_MAXIMUM_PACKAGE_MIB"
    assert_match(/reduce|smaller/i, message)
    assert_match(/operator|administrator/i, message)
    assert_match(/restart|redeploy/i, message)
  end

  test "startup configures the limit and environment changes wait for a restart" do
    ENV.delete("REPLICA_MAXIMUM_PACKAGE_MIB")
    load Rails.root.join("config/initializers/deployment_configuration.rb")
    assert_equal 150.megabytes, Rails.configuration.x.maximum_package_bytes

    ENV["REPLICA_MAXIMUM_PACKAGE_MIB"] = "3"
    assert_equal 150.megabytes, Rails.configuration.x.maximum_package_bytes

    load Rails.root.join("config/initializers/deployment_configuration.rb")
    assert_equal 3.megabytes, Rails.configuration.x.maximum_package_bytes
  end

  test "an explicitly empty deployment variable prevents startup" do
    ENV["REPLICA_MAXIMUM_PACKAGE_MIB"] = ""

    error = assert_raises(ArgumentError) do
      load Rails.root.join("config/initializers/deployment_configuration.rb")
    end

    assert_includes error.message, "REPLICA_MAXIMUM_PACKAGE_MIB"
  end
end
