require "yaml"
require "open3"
require "tmpdir"
require "fileutils"
require "json"

def check(condition, message)
  abort(message) unless condition
end

def expression(value)
  value.to_s.strip.delete_prefix("${{").delete_suffix("}}").strip
end

root = File.expand_path("..", __dir__)
workflows = %w[hub-ci actions-ci].to_h do |name|
  [name, YAML.safe_load(File.read(File.join(root, ".github/workflows/#{name}.yml"))).fetch("jobs")]
end
expected_gates = {
  ["hub-ci", "frontend_test_shard"] => ["Frontend tests shard ${{ matrix.shard }}/4${{ matrix.node == 26 && ' (Node 26)' || '' }}", ["changes"]],
  ["hub-ci", "frontend_test"] => ["Frontend tests", %w[changes frontend_test_shard frontend_integration_test]],
  ["hub-ci", "production_image"] => ["Production image", %w[changes production_image_platform]],
  ["actions-ci", "result"] => ["Replica action tests", %w[changes test]]
}
gates = {}

workflows.each do |workflow, jobs|
  suite = workflow == "hub-ci" ? "hub" : "build_action"
  selection = "needs.changes.outputs.#{suite} == 'true'"
  jobs.each do |id, job|
    next if id == "changes"

    label = "#{workflow}/#{id}"
    check(Array(job["needs"]).include?("changes"), "#{label}: missing changes dependency")
    steps = job.fetch("steps")
    guards = steps.select { |step| step.fetch("env", {}).key?("SELECTION_RESULT") }
    if guards.empty?
      check(expression(job["if"]) == selection, "#{label}: suite must require selection")
      next
    end

    key = [workflow, id]
    check(expected_gates.key?(key), "#{label}: unexpected gate")
    check(guards.length == 1, "#{label}: expected exactly one selection guard")
    name, needs = expected_gates.fetch(key)
    check(job["name"] == name, "#{label}: required check name changed")
    check(Array(job["needs"]).sort == needs.sort, "#{label}: incorrect gate dependencies")
    check(expression(job["if"]) == "always()", "#{label}: gate must always run")
    guard = guards.first
    check(!guard.key?("if"), "#{label}: guard must not be conditional")
    env = guard.fetch("env")
    check(expression(env["SELECTION_RESULT"]) == "needs.changes.result", "#{label}: incorrect selection result")
    check(expression(env["SELECTED"]) == "needs.changes.outputs.#{suite}", "#{label}: incorrect selection output")
    result_jobs = { "SHARD_RESULT" => "frontend_test_shard", "INTEGRATION_RESULT" => "frontend_integration_test", "TEST_RESULT" => "test", "IMAGE_RESULT" => "production_image_platform" }
    expected_results = case id
                       when "frontend_test" then %w[SHARD_RESULT INTEGRATION_RESULT]
                       when "result" then ["TEST_RESULT"]
                       when "production_image" then ["IMAGE_RESULT"]
                       else []
                       end
    check(env.keys.sort == (%w[SELECTION_RESULT SELECTED] + expected_results).sort, "#{label}: incorrect gate inputs")
    expected_results.each do |variable|
      check(expression(env[variable]) == "needs.#{result_jobs.fetch(variable)}.result", "#{label}: incorrect #{variable}")
    end
    if id == "frontend_test_shard"
      check(job.dig("strategy", "matrix", "shard") == [1, 2, 3, 4], "#{label}: required shards changed")
      check(steps.first.equal?(guard) && steps.length > 1, "#{label}: guard must precede suite steps")
      check(steps.drop(1).all? { |step| expression(step["if"]) == selection }, "#{label}: suite steps must require selection")
    end
    gates[key] = guard.fetch("run")
  end
end
check(gates.keys.sort == expected_gates.keys.sort, "Expected exactly the shard guard and all three final result gates")
image_platform = workflows.fetch("hub-ci").fetch("production_image_platform")
check(!image_platform.fetch("env", {}).key?("DOCKER_DEFAULT_PLATFORM"), "Production image target must not change the platform of QEMU or Buildx setup")
check(image_platform.dig("env", "IMAGE_PLATFORM") == "linux/${{ matrix.architecture }}", "Production image target must follow the architecture matrix")
check(image_platform["name"] == "Production image (${{ matrix.architecture }})", "Production image platform name changed")
check(Array(image_platform["needs"]) == ["changes"], "Production image platform must depend on changes")
native_matrix = [
  { "architecture" => "amd64", "runner" => "ubuntu-latest" },
  { "architecture" => "arm64", "runner" => "ubuntu-24.04-arm" }
]
check(image_platform.dig("strategy", "matrix") == { "include" => native_matrix }, "Production image platform must map amd64 and arm64 to native runners")
check(expression(image_platform["runs-on"]) == "matrix.runner", "Production image platform must use its native matrix runner")
check(image_platform.fetch("steps").none? { |step| step["uses"].to_s.start_with?("docker/setup-qemu-action@") }, "Production image checks must not use QEMU")
check(image_platform.dig("strategy", "fail-fast") == false, "Production image platform must not cancel other architectures on failure")
check(workflows.fetch("actions-ci").fetch("test")["name"] == "Build action suite${{ matrix.node == 26 && ' (Node 26)' || '' }}", "Build action suite name changed")

states = %w[success failure cancelled skipped] + [""]
checks = 0
gates.each do |(workflow, id), script|
  variables = case id
              when "frontend_test" then %w[SHARD_RESULT INTEGRATION_RESULT]
              when "result" then ["TEST_RESULT"]
              when "production_image" then ["IMAGE_RESULT"]
              else []
              end
  combinations = variables.reduce([{}]) { |rows, variable| rows.flat_map { |row| states.map { |state| row.merge(variable => state) } } }
  states.product(%w[true false invalid] + [""]).each do |selection_result, selected|
    combinations.each do |results|
      expected = selection_result == "success" && %w[true false].include?(selected)
      expected &&= case id
                   when "frontend_test_shard" then true
                   when "frontend_test"
                     results["SHARD_RESULT"] == "success" &&
                       results["INTEGRATION_RESULT"] == (selected == "true" ? "success" : "skipped")
                   when "result"
                     results["TEST_RESULT"] == (selected == "true" ? "success" : "skipped")
                   when "production_image"
                     results["IMAGE_RESULT"] == (selected == "true" ? "success" : "skipped")
                   end
      env = results.merge("SELECTION_RESULT" => selection_result, "SELECTED" => selected)
      stdout, stderr, status = Open3.capture3(env.merge("BASH_ENV" => nil), "bash", "--noprofile", "--norc", "-e", "-c", script, chdir: root)
      check(status.success? == expected, "#{workflow}/#{id} #{env.inspect}: expected #{expected ? 'pass' : 'failure'}, exit #{status.exitstatus}\n#{stdout}#{stderr}")
      checks += 1
    end
  end
end
puts "CI workflow guards and wiring passed (#{checks} shell cases)."

catalog_output, catalog_error, catalog_status = Open3.capture3("bash", "scripts/starter-ci-matrix.sh", chdir: root)
check(catalog_status.success?, "Could not read the starter CI catalog:\n#{catalog_error}")
projects = %w[hub actions/build packages/learning] + JSON.parse(catalog_output).map { |starter| starter.fetch("directory") }
projects.each do |project|
  manifest = JSON.parse(File.read(File.join(root, project, "package.json")))
  check(manifest.dig("engines", "node") == "^24.15.0 || ^26.0.0", "#{project}: supported Node versions changed")
  next if File.file?(File.join(root, project, "starter-generator.mjs"))

  lock = JSON.parse(File.read(File.join(root, project, "package-lock.json")))
  check(lock.dig("packages", "", "engines") == manifest.fetch("engines"), "#{project}: locked Node engines differ from the manifest")
end
{
  "hub-ci" => %w[rails_test typecheck frontend_lint frontend_test_shard frontend_integration_test frontend_build storybook_build],
  "actions-ci" => ["test"],
  "starter-ci" => ["test"],
  "learning-ci" => ["test"]
}.each do |workflow, job_ids|
  jobs = YAML.safe_load(File.read(File.join(root, ".github/workflows/#{workflow}.yml"))).fetch("jobs")
  job_ids.each do |id|
    job = jobs.fetch(id)
    label = "#{workflow}/#{id}"
    check(job.dig("strategy", "matrix", "node") == [24, 26], "#{label}: existing checks must cover Node 24 and 26")
    check(job.dig("strategy", "fail-fast") == false, "#{label}: failures must not cancel other versions")
    check(job.fetch("name").end_with?("${{ matrix.node == 26 && ' (Node 26)' || '' }}"), "#{label}: preserve Node 24 check names and distinguish Node 26")
    setup_node = job.fetch("steps").find { |step| step["uses"].to_s.start_with?("actions/setup-node@") }
    check(setup_node && expression(setup_node.dig("with", "node-version")) == "matrix.node", "#{label}: execute the selected Node version")
    if workflow == "starter-ci"
      check(expression(job.dig("strategy", "matrix", "starter")) == "fromJSON(needs.catalog.outputs.starters)", "#{label}: check every catalog starter")
      runner = job.fetch("steps").find { |step| step["run"] == 'bash scripts/check-starter.sh "${{ matrix.starter.id }}" "$RUNNER_TEMP/prototype"' }
      check(runner, "#{label}: validate the assembled starter with the shared runner")
      commands = File.read(File.join(root, "scripts/check-starter.sh")).lines.map(&:strip)
      check(commands.include?("npm ci --engine-strict") && commands.include?("npm run check:starter"), "#{label}: enforce dependency engines and run app checks")
    else
      installs = job.fetch("steps").select { |step| step["run"].to_s.start_with?("npm ci") }
      check(!installs.empty? && installs.all? { |step| step.fetch("run").split.include?("--engine-strict") }, "#{label}: enforce dependency engines")
    end
  end
end
action_steps = workflows.fetch("actions-ci").fetch("test").fetch("steps")
fixture = action_steps.find { |step| step["name"] == "Prepare composite action fixture" }
composite = action_steps.find { |step| step["uses"] == "./actions/build" }
check(fixture && composite && [fixture, composite].all? { |step| expression(step["if"]) == "matrix.node == 24" }, "The Node 24 composite smoke test must run only once to avoid duplicate artifact uploads")
puts "Node support ranges, lockfiles and existing CI matrices passed."

release = YAML.safe_load(File.read(File.join(root, ".github/workflows/hub-release.yml"))).fetch("jobs")
prepare = release.fetch("prepare")
build = release.fetch("build")
publish = release.fetch("publish")
check(expression(prepare["if"]) == "startsWith(github.event.release.tag_name, 'hub-v')", "Release preparation must require a Hub release tag")
check(Array(build["needs"]) == ["prepare"], "Release image builds must wait for preparation")
check(Array(publish["needs"]).sort == %w[build prepare], "Release publication must wait for preparation and both image builds")
[build, publish].each do |job|
  check(!job.key?("if") || expression(job["if"]) == "success()", "Release builds and publication must require successful dependencies")
end
check(build.dig("strategy", "matrix") == { "include" => native_matrix }, "Release images must use both native architecture runners")
check(build.dig("strategy", "fail-fast") == false, "Release image builds must not cancel the other architecture")
check(expression(build["runs-on"]) == "matrix.runner", "Release images must use their native matrix runner")
check(release.values.flat_map { |job| job.fetch("steps") }.none? { |step| step["uses"].to_s.start_with?("docker/setup-qemu-action@") }, "Release images must not use QEMU")

def action_step(job, action)
  steps = job.fetch("steps").select { |step| step["uses"].to_s.start_with?("#{action}@") }
  check(steps.length == 1, "Expected exactly one #{action} step")
  steps.first
end

check(expression(action_step(prepare, "actions/checkout").dig("with", "ref")) == "github.event.release.tag_name", "Preparation must check out the release tag")
check(expression(action_step(build, "actions/checkout").dig("with", "ref")) == "needs.prepare.outputs.revision", "Image builds must check out the immutable prepared revision")
check(expression(action_step(publish, "actions/checkout").dig("with", "ref")) == "needs.prepare.outputs.revision", "Deployment packaging must check out the immutable prepared revision")
version_step = prepare.fetch("steps").find { |step| step["name"] == "Read release version" }
check(version_step && version_step["id"], "Preparation must retain the release version script")
metadata = action_step(prepare, "docker/metadata-action")
%w[version stable revision tags labels].each do |output|
  source = %w[tags labels].include?(output) ? metadata.fetch("id") : version_step.fetch("id")
  check(expression(prepare.fetch("outputs").fetch(output)) == "steps.#{source}.outputs.#{output}", "Preparation must expose #{output} from its producing step")
end
check(expression(version_step.dig("env", "RELEASE_TAG")) == "github.event.release.tag_name", "Version validation must read the release tag")
check(expression(version_step.dig("env", "RELEASE_PRERELEASE")) == "github.event.release.prerelease", "Version validation must read the release prerelease flag")
action_step(build, "docker/login-action")
action_step(build, "docker/setup-buildx-action")
action_step(publish, "docker/login-action")
action_step(publish, "docker/setup-buildx-action")
image = action_step(build, "docker/build-push-action")
check(image["id"] == "build", "Release image build must expose its digest")
options = image.fetch("with")
check(options["context"] == "hub" && options["build-contexts"] == "learning=packages/learning", "Release images must build Hub with the learning context")
check(options["platforms"] == "linux/${{ matrix.architecture }}", "Each release build must target only its native architecture")
check(expression(options["labels"]) == "needs.prepare.outputs.labels", "Release images must use prepared labels")
check(!options.key?("tags"), "Architecture builds must not publish release tags")
check(options.fetch("outputs").split(",").map(&:strip).sort == %w[type=image name=ghcr.io/github/replica-hub push-by-digest=true name-canonical=true push=true].sort, "Architecture images must publish only canonical digest references")
%w[REVISION VERSION].each do |key|
  check(options.fetch("build-args").lines.map(&:strip).include?("REPLICA_IMAGE_#{key}=${{ needs.prepare.outputs.#{key.downcase} }}"), "Release image must use prepared #{key.downcase}")
end
upload = action_step(build, "actions/upload-artifact").fetch("with")
check(upload["name"] == "image-digest-${{ matrix.architecture }}", "Each architecture must upload its own digest artifact")
check(upload["path"].to_s.include?("runner.temp") && upload["path"].end_with?("/digests/*"), "Digest artifacts must contain the exported digest filenames")
export_steps = build.fetch("steps").select { |step| step.fetch("env", {}).values.any? { |value| expression(value) == "steps.build.outputs.digest" } }
check(export_steps.length == 1, "Release builds must export the actual build digest")
export_step = export_steps.first
digest_variable = export_step.fetch("env").find { |_key, value| expression(value) == "steps.build.outputs.digest" }.first
download = action_step(publish, "actions/download-artifact").fetch("with")
check(download["pattern"] == "image-digest-*", "Publication must download all architecture digests")
check(download["path"].to_s.include?("runner.temp") && download["path"].end_with?("/digests"), "Publication must download digests into the runner's digest directory")
check(download["merge-multiple"] != true, "Publication must retain separate architecture artifact directories")
publish_step = publish.fetch("steps").find { |step| step["name"] == "Publish multiarchitecture image" }
check(publish_step && expression(publish_step.dig("env", "IMAGE_TAGS")) == "needs.prepare.outputs.tags", "Manifest publication must use all prepared tags")
%w[Package Upload].each do |verb|
  matches = release.flat_map { |id, job| job.fetch("steps").select { |step| step["name"] == "#{verb} deployment bundle" }.map { |step| [id, step] } }
  check(matches.length == 1 && matches.first.first == "publish", "The deployment bundle must be #{verb.downcase}d exactly once, in the final job")
  check(publish.fetch("steps").index(matches.first.last) > publish.fetch("steps").index(publish_step), "Deployment bundle #{verb.downcase} must follow manifest publication")
end

release_checks = 0
Dir.mktmpdir("check-ci-workflows-", root) do |directory|
  bin = File.join(directory, "bin")
  FileUtils.mkdir_p(bin)
  revision = "0123456789abcdef0123456789abcdef01234567"
  File.write(File.join(bin, "git"), "#!/bin/bash\n[[ \"$*\" == 'rev-parse HEAD' ]] || exit 99\nprintf '%s\\n' '#{revision}'\n")
  File.write(File.join(bin, "docker"), "#!/bin/bash\nprintf '%s\\0' \"$@\" '__END__' >> \"$DOCKER_ARGS\"\n")
  %w[git docker].each { |name| File.chmod(0o755, File.join(bin, name)) }
  shell_env = { "BASH_ENV" => nil, "PATH" => "#{bin}:/usr/bin:/bin" }
  [
    ["hub-v1.2.3", "false", true],
    ["hub-v0.0.0", "false", true],
    ["hub-v2.0.0-rc.1", "true", true],
    ["hub-v2.0.0-0.alpha-1", "true", true],
    ["hub-v1.2.3", "true", false],
    ["hub-v2.0.0-rc.1", "false", false],
    ["hub-v01.2.3", "false", false],
    ["hub-v1.2.3-rc.01", "true", false],
    ["hub-v1.2.3+build", "false", false],
    ["v1.2.3", "false", false],
    ["hub-v1.2", "false", false],
    ["hub-v1.2.3-", "true", false],
    ["hub-v1.2.3", "invalid", false]
  ].each do |tag, prerelease, expected|
    output = File.join(directory, "version-output")
    File.write(output, "")
    stdout, stderr, status = Open3.capture3(shell_env.merge("RELEASE_TAG" => tag, "RELEASE_PRERELEASE" => prerelease, "GITHUB_OUTPUT" => output), "bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", version_step.fetch("run"), chdir: root)
    check(status.success? == expected, "Release version #{tag}/#{prerelease}: expected #{expected}, exit #{status.exitstatus}\n#{stdout}#{stderr}")
    values = File.read(output).lines.map { |line| line.strip.split("=", 2) }.to_h
    check(values == (expected ? { "stable" => (prerelease == "false").to_s, "version" => tag.delete_prefix("hub-v"), "revision" => revision } : {}), "Release version #{tag}/#{prerelease}: incorrect outputs #{values.inspect}")
    release_checks += 1
  end

  digests = { "amd64" => "a" * 64, "arm64" => "b" * 64 }
  ["sha256:#{digests.fetch("amd64")}", "", "sha256:short", "sha512:#{'a' * 64}", "sha256:#{'g' * 64}"].each do |digest|
    runner = File.join(directory, "export-runner")
    FileUtils.rm_rf(runner)
    stdout, stderr, status = Open3.capture3(shell_env.merge("RUNNER_TEMP" => runner, digest_variable => digest), "bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", export_step.fetch("run"), chdir: root)
    expected = digest == "sha256:#{digests.fetch("amd64")}"
    check(status.success? == expected, "Digest export #{digest.inspect}: expected #{expected}, exit #{status.exitstatus}\n#{stdout}#{stderr}")
    files = Dir.glob(File.join(runner, "digests", "*"))
    check(files.map { |file| File.basename(file) } == (expected ? [digests.fetch("amd64")] : []), "Digest export must create exactly one SHA-256 filename and reject malformed digests")
    check(files.all? { |file| File.file?(file) && File.zero?(file) }, "Digest artifacts must be empty regular files")
    release_checks += 1
  end
  tags = %w[ghcr.io/github/replica-hub:1.2.3 ghcr.io/github/replica-hub:1.2 ghcr.io/github/replica-hub:1 ghcr.io/github/replica-hub:latest]
  [
    ["stable release", {}, tags.join("\n"), true],
    ["prerelease", {}, "ghcr.io/github/replica-hub:2.0.0-rc.1", true],
    ["missing arm64", { "arm64" => [] }, tags.join("\n"), false],
    ["missing amd64", { "amd64" => [] }, tags.join("\n"), false],
    ["multiple digests", { "arm64" => ["b" * 64, "c" * 64] }, tags.join("\n"), false],
    ["invalid digest", { "arm64" => ["not-a-digest"] }, tags.join("\n"), false],
    ["short digest", { "amd64" => ["a" * 63] }, tags.join("\n"), false],
    ["missing tags", {}, nil, false],
    ["empty tags", {}, "", false],
    ["leading blank tag", {}, "\n#{tags.join("\n")}", false],
    ["interior blank tag", {}, tags.join("\n\n"), false],
    ["trailing blank tag", {}, "#{tags.join("\n")}\n", false]
  ].each do |name, overrides, image_tags, expected|
    runner = File.join(directory, "runner")
    FileUtils.rm_rf(runner)
    digests.each do |architecture, digest|
      files = overrides.fetch(architecture, [digest])
      next if files.empty?

      path = File.join(runner, "digests", "image-digest-#{architecture}")
      FileUtils.mkdir_p(path)
      files.each { |filename| File.write(File.join(path, filename), "") }
    end
    args_file = File.join(directory, "docker-args")
    FileUtils.rm_f(args_file)
    stdout, stderr, status = Open3.capture3(shell_env.merge("RUNNER_TEMP" => runner, "IMAGE_TAGS" => image_tags, "DOCKER_ARGS" => args_file), "bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", publish_step.fetch("run"), chdir: root)
    check(status.success? == expected, "Manifest publication with #{name}: expected #{expected}, exit #{status.exitstatus}\n#{stdout}#{stderr}")
    args = File.exist?(args_file) ? File.binread(args_file).split("\0") : []
    if expected
      check(args.count("__END__") == 1 && args.first(3) == %w[buildx imagetools create], "Publication must create exactly one multiarchitecture manifest")
      remaining = args.drop(3).reject { |argument| argument == "__END__" }
      actual_tags = []
      refs = []
      until remaining.empty?
        argument = remaining.shift
        argument == "--tag" ? actual_tags << remaining.shift : refs << argument
      end
      check(actual_tags.sort == image_tags.split("\n").sort, "Manifest publication must apply exactly the prepared release tags")
      check(refs.sort == digests.values.map { |digest| "ghcr.io/github/replica-hub@sha256:#{digest}" }.sort, "Manifest publication must combine exactly both immutable architecture digests")
    else
      check(args.empty?, "Invalid tags or architecture artifacts must fail before invoking Docker")
    end
    release_checks += 1
  end
end
puts "Release workflow wiring and scripts passed (#{release_checks} shell cases)."
