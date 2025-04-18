const core = require("@actions/core");
const github = require("@actions/github");
const { execSync } = require("child_process");

function runCommand(command) {
  try {
    return execSync(command).toString().trim();
  } catch (error) {
    core.debug(`Command failed: ${command}`);
    core.debug(error.message);
    return "";
  }
}

async function determineVersion() {
  const versionIncrement = process.env.VERSION_INCREMENT || "auto";
  const svuCommand = versionIncrement === "auto" ? "next" : versionIncrement;

  const nextVersion = runCommand(`svu ${svuCommand}`);
  core.info(`Next version: ${nextVersion}`);

  const currentVersion = runCommand("svu current") || "none";
  core.info(`Current version: ${currentVersion}`);

  await core.summary
    .addHeading("📊 Version Information")
    .addTable([
      [
        { data: "**Version Type**", header: true },
        { data: "**Value**", header: true },
      ],
      ["Current Version", `\`${currentVersion}\``],
      ["Next Version", `\`${nextVersion}\``],
      ["Increment Strategy", `\`${versionIncrement}\``],
    ])
    .addEOL()
    .write();

  return { nextVersion, currentVersion };
}

async function analyzeCommits() {
  const prevTag = runCommand("git describe --tags --abbrev=0");

  let notes;
  let commitCount;
  let commitRange;

  if (!prevTag) {
    notes = runCommand('git log --pretty=format:"* %s (%h)" --no-merges');
    commitCount = parseInt(
      runCommand("git rev-list --count --no-merges HEAD"),
      10
    );
    commitRange = "Initial commit to `HEAD`";
  } else {
    notes = runCommand(
      `git log ${prevTag}..HEAD --pretty=format:"* %s (%h)" --no-merges`
    );
    commitCount = parseInt(
      runCommand(`git rev-list --count --no-merges ${prevTag}..HEAD`),
      10
    );
    commitRange = `\`${prevTag}\` to \`HEAD\``;
  }

  const commitTypes = {
    breaking: 0,
    feat: 0,
    fix: 0,
    docs: 0,
    refactor: 0,
    test: 0,
    chore: 0,
    ci: 0,
  };

  const lines = notes.split("\n").filter((line) => line.trim());

  lines.forEach((line) => {
    if (line.includes("!:")) commitTypes.breaking++;
    if (line.match(/^\* feat/)) commitTypes.feat++;
    if (line.match(/^\* fix/)) commitTypes.fix++;
    if (line.match(/^\* docs/)) commitTypes.docs++;
    if (line.match(/^\* refactor/)) commitTypes.refactor++;
    if (line.match(/^\* test/)) commitTypes.test++;
    if (line.match(/^\* chore/)) commitTypes.chore++;
    if (line.match(/^\* ci/)) commitTypes.ci++;
  });

  const conventionalCount = Object.values(commitTypes).reduce(
    (a, b) => a + b,
    0
  );
  const unrecognizedCount = Math.max(0, commitCount - conventionalCount);

  const summaryTable = [
    [
      { data: "**Commit Type**", header: true },
      { data: "**Count**", header: true },
    ],
    ["💥 Breaking Changes", commitTypes.breaking.toString()],
    ["✨ Features", commitTypes.feat.toString()],
    ["🐛 Bug Fixes", commitTypes.fix.toString()],
    ["📚 Documentation", commitTypes.docs.toString()],
    ["♻️ Refactoring", commitTypes.refactor.toString()],
    ["🧪 Tests", commitTypes.test.toString()],
    ["🔧 Chores", commitTypes.chore.toString()],
    ["👷 CI", commitTypes.ci.toString()],
    ["❓ Unrecognized", unrecognizedCount.toString()],
    ["**Total Commits**", `**${commitCount}**`],
  ];

  await core.summary
    .addHeading("📝 Release Notes Summary")
    .addRaw(`Analyzed commits from ${commitRange}`)
    .addEOL()
    .addTable(summaryTable)
    .addEOL()
    .addHeading("📋 Release Notes", 3)
    .addDetails("Click to expand", `\`\`\`markdown\n${notes}\n\`\`\``)
    .addEOL()
    .write();

  return { notes, commitCount, commitRange };
}

async function createRelease(nextVersion, notes) {
  try {
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
    const { owner, repo } = github.context.repo;

    const release = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: nextVersion,
      name: nextVersion,
      body: notes,
    });

    const releaseUrl = release.data.html_url;

    await core.summary
      .addHeading("🚀 Release Status")
      .addRaw("✅ **Release successfully created!**")
      .addEOL()
      .addTable([
        [
          { data: "**Release Info**", header: true },
          { data: "**Details**", header: true },
        ],
        ["Version", `\`${nextVersion}\``],
        ["URL", releaseUrl],
      ])
      .addEOL()
      .write();

    core.info(`Release created successfully: ${nextVersion}`);
    return { success: true, url: releaseUrl };
  } catch (error) {
    core.setFailed(`Failed to create release: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function addDryRunSummary(nextVersion) {
  await core.summary
    .addHeading("🔍 Dry Run Mode")
    .addRaw("⚠️ **This was a dry run. No release was created.**")
    .addEOL()
    .addRaw(
      `If this was a real run, version \`${nextVersion}\` would have been created.`
    )
    .addEOL()
    .addRaw("To create an actual release, run with `dry-run` set to `false`.")
    .addEOL()
    .write();

  core.info(`Dry run completed for version: ${nextVersion}`);
}

async function addSetupSummary() {
  await core.summary
    .addHeading("🔨 Setting up the environment")
    .addRaw("✅ Installed SVU (Semantic Version Util)")
    .addEOL()
    .write();
}

async function main() {
  try {
    await addSetupSummary();

    const { nextVersion } = await determineVersion();
    const { notes } = await analyzeCommits();
    const isDryRun = process.env.DRY_RUN === "true";

    if (!isDryRun) {
      await createRelease(nextVersion, notes);
    } else {
      await addDryRunSummary(nextVersion);
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

// Export functions for testing
module.exports = {
  determineVersion,
  analyzeCommits,
  createRelease,
  addDryRunSummary,
  main,
};

// Run the main function if this file is executed directly
if (require.main === module) {
  main();
}
