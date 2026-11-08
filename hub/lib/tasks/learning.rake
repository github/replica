namespace :replica do
  namespace :learning do
    desc "Copy a repository's published Builds and screenshots for replica-learning decision taskset"
    task :decision_builds, %i[repository_id directory] => :environment do |_task, arguments|
      if arguments[:repository_id].blank? || arguments[:directory].blank?
        abort "Usage: bin/rails 'replica:learning:decision_builds[<Hub repository ID>,<new directory>]'"
      end

      repository = Repository.find(arguments[:repository_id])
      counts = Learning::DecisionBuilds.new(repository).write(arguments[:directory])
      puts "Wrote #{counts.fetch(:builds)} Builds with #{counts.fetch(:screenshots)} screenshots to " \
        "#{File.join(File.expand_path(arguments[:directory]), "builds.json")}"
    end
  end
end
