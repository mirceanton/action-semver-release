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
    let latestRelease;
    let latestReleaseDate;
    let currentVersion;
    try {
      latestRelease = await octokit.rest.repos.getLatestRelease({ owner, repo });
      latestReleaseDate = new Date(latestRelease.data.created_at);
      currentVersion = semver.clean(latestRelease.data.tag_name) || defaultVersion;
      core.info(`Latest release: ${latestRelease.data.tag_name} at ${latestReleaseDate.toISOString()}`);
    } catch (error) {
      // Check if the error is a 404 (no releases found) or something else
      if (error.status === 404) {
        core.warn(`No previous releases found, starting from ${defaultVersion} version`);
        latestRelease = null;
        latestReleaseDate = new Date(0); // Unix epoch if no release
        currentVersion = defaultVersion;
      } else {
        throw new Error(`Failed to get latest release: ${error.message}`);
      }
    }
    core.info(`Latest release ${latestRelease} at ${latestReleaseDate.toISOString()}`);
    core.info(`Current version set to: ${currentVersion}`);

    // Get all commits since the latest release
    try {
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        since: latestReleaseDate.toISOString()
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
      let nextVersion = currentVersion;
      if (shouldBumpMajor) {
        nextVersion = semver.inc(currentVersion, 'major');
      } else if (shouldBumpMinor) {
        nextVersion = semver.inc(currentVersion, 'minor');
      } else if (shouldBumpPatch) {
        nextVersion = semver.inc(currentVersion, 'patch');
      }

      core.info(`Next version determined to be: ${nextVersion}`);
      core.setOutput('next-version', nextVersion);
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
