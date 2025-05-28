const core = require('@actions/core');
const github = require('@actions/github');
const semver = require('semver');

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const defaultVersion = core.getInput('default-version') || '0.0.0';

    // Create octokit client
    const octokit = github.getOctokit(token);
    const context = github.context;
    const { owner, repo } = context.repo;
    core.debug(`Repository: ${owner}/${repo}`);

    // Get the latest release
    let currentReleaseDate, currentReleaseTag;
    try {
      const latestRelease = await octokit.rest.repos.getLatestRelease({ owner, repo });
      core.debug(`Latest release data: ${JSON.stringify(latestRelease.data, null, 2)}`);

      if (!latestRelease.data.created_at) {
        core.warning('No previous releases found, using default version');
        currentReleaseDate = new Date();
        currentReleaseTag = defaultVersion;
      } else {
        currentReleaseDate = new Date(latestRelease.data.created_at);
        currentReleaseTag = semver.clean(latestRelease.data.tag_name) || defaultVersion;
      }
    } catch (error) {
      throw new Error(`Failed to get latest release: ${error.message}`);
    }
    core.info(`Current release: ${currentReleaseTag} at ${currentReleaseDate.toISOString()}`);

    // Get all commits since the latest release
    try {
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        since: currentReleaseDate.toISOString()
      });
      core.info(`Found ${commits.length} commits since last release`);

      // Analyze commits for version bump
      let shouldBumpMajor = false;
      let shouldBumpMinor = false;
      let shouldBumpPatch = false;

      for (const commit of commits) {
        const message = commit.commit.message;
        if (message.includes('BREAKING CHANGE:')) {
          shouldBumpMajor = true;
          core.info(`Breaking change found in commit body: ${commit.sha}`);
          continue;
        }

        const hasBreakingChange = /^(feat|fix)(\([^)]*\))?!:/.test(message);
        if (hasBreakingChange) {
          shouldBumpMajor = true;
          core.info(`Breaking change found with exclamation mark syntax: ${commit.sha}`);
          continue;
        }

        if (message.startsWith('feat:') || message.startsWith('feat(')) {
          shouldBumpMinor = true;
          core.info(`Feature commit found: ${commit.sha}`);
          continue;
        }

        if (message.startsWith('fix:') || message.startsWith('fix(')) {
          shouldBumpPatch = true;
          core.info(`Fix commit found: ${commit.sha}`);
        }
      }

      // Determine next version
      let nextVersion = currentReleaseTag;
      if (shouldBumpMajor) {
        nextVersion = semver.inc(currentReleaseTag, 'major');
      } else if (shouldBumpMinor) {
        nextVersion = semver.inc(currentReleaseTag, 'minor');
      } else if (shouldBumpPatch) {
        nextVersion = semver.inc(currentReleaseTag, 'patch');
      }
      const shouldRelease = nextVersion !== currentReleaseTag;

      core.info(`Next version determined to be: ${nextVersion}`);

      core.setOutput('next-version', nextVersion);
      core.setOutput('should-release', shouldRelease);
      core.setOutput('release-notes', '');
    } catch (error) {
      throw new Error(`Failed to analyze commits: ${error.message}`);
    }
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
