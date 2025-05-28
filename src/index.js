const core = require('@actions/core');
const github = require('@actions/github');
const semver = require('semver');

async function getLatestReleaseData(octokit, owner, repo, defaultVersion) {
  try {
    const latestRelease = await octokit.rest.repos.getLatestRelease({ owner, repo });
    core.debug(`Latest release data: ${JSON.stringify(latestRelease.data, null, 2)}`);

    if (!latestRelease.data.created_at) {
      core.warning('No previous releases found, using default version');
      return {
        currentReleaseDate: new Date(0),
        currentReleaseTag: defaultVersion
      };
    }

    return {
      currentReleaseDate: new Date(latestRelease.data.created_at),
      currentReleaseTag: semver.clean(latestRelease.data.tag_name) || defaultVersion
    };
  } catch (error) {
    if (error.message.includes('Not Found')) {
      core.warning('No previous releases found, using default version');
      return {
        currentReleaseDate: new Date(0),
        currentReleaseTag: defaultVersion
      };
    }
    throw new Error(`Failed to get latest release: ${error.message}`);
  }
}

async function getCommitsSinceDate(octokit, owner, repo, sinceDate) {
  try {
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      since: sinceDate.toISOString()
    });

    const parsedCommits = commits.map((commit) => {
      const message = commit.commit.message;
      const shortSha = commit.sha.substring(0, 7);

      // Parse conventional commit format: <type>[optional scope]: <description>\n[optional body]
      const lines = message.split('\n');
      const firstLine = lines[0];
      const body = lines.slice(1).join('\n').trim();

      // Regex to parse: type(scope)!: description
      const conventionalCommitRegex = /^(\w+)(\(([^)]+)\))?(!)?:\s*(.+)$/;
      const match = firstLine.match(conventionalCommitRegex);

      let type, scope, isBreaking, description;

      if (match) {
        type = match[1]; // feat, fix, docs, etc.
        scope = match[3] || ''; // optional scope
        isBreaking = !!match[4]; // ! indicates breaking change
        description = match[5]; // commit description
      } else {
        type = 'other';
        scope = '';
        isBreaking = false;
        description = firstLine;
      }

      // Check for breaking changes in body (BREAKING CHANGE: footer)
      const hasBreakingChangeInBody = message.includes('BREAKING CHANGE');
      if (hasBreakingChangeInBody) {
        isBreaking = true;
      }

      return {
        sha: shortSha,
        type: type,
        scope: scope,
        description: description,
        body: body,
        isBreaking: isBreaking,
        fullMessage: message,
        author: commit.commit.author.name
      };
    });

    return parsedCommits;
  } catch (error) {
    throw new Error(`Failed to get commits: ${error.message}`);
  }
}

function calculateNextVersion(parsedCommits, currentVersion) {
  let shouldBumpMajor = false;
  let shouldBumpMinor = false;
  let shouldBumpPatch = false;

  for (const commit of parsedCommits) {
    if (commit.isBreaking) {
      shouldBumpMajor = true;
      core.info(`Breaking change found: ${commit.sha}`);
      continue;
    }

    switch (commit.type) {
      case 'feat':
        shouldBumpMinor = true;
        core.info(`Feature commit found: ${commit.sha}`);
        break;

      case 'fix':
        shouldBumpPatch = true;
        core.info(`Fix commit found: ${commit.sha}`);
        break;

      default:
        core.info(`${commit.type} commit found: ${commit.sha}`);
        break;
    }
  }

  if (shouldBumpMajor) {
    return semver.inc(currentVersion, 'major');
  } else if (shouldBumpMinor) {
    return semver.inc(currentVersion, 'minor');
  } else if (shouldBumpPatch) {
    return semver.inc(currentVersion, 'patch');
  }

  return currentVersion;
}

function generateReleaseNotes(parsedCommits, version) {
  const commitTypes = {
    breaking: {
      title: '## 💥 Breaking Changes',
      commits: []
    },
    feat: {
      title: '## ✨ New Features',
      commits: []
    },
    fix: {
      title: '## 🐛 Bug Fixes',
      commits: []
    },
    perf: {
      title: '## ⚡ Performance Improvements',
      commits: []
    },
    docs: {
      title: '## 📚 Documentation',
      commits: []
    },
    build: {
      title: '## 📦 Build System',
      commits: []
    },
    ci: {
      title: '## 👷 CI/CD',
      commits: []
    },
    test: {
      title: '## 🧪 Tests',
      commits: []
    },
    refactor: {
      title: '## ♻️ Code Refactoring',
      commits: []
    },
    style: {
      title: '## 💄 Code Style',
      commits: []
    },
    chore: {
      title: '## 🧹 Chores',
      commits: []
    },
    other: {
      title: '## 🔧 Other Changes',
      commits: []
    }
  };

  parsedCommits.forEach((commit) => {
    if (commit.isBreaking) {
      commitTypes.breaking.commits.push(commit);
    } else {
      const type = commit.type;
      if (type in commitTypes) {
        commitTypes[type].commits.push(commit);
      } else {
        commitTypes.other.commits.push(commit);
      }
    }
  });

  let releaseNotes = `# Release ${version}\n\n`;
  for (const [typeName, typeConfig] of Object.entries(commitTypes)) {
    if (typeConfig.commits.length > 0) {
      releaseNotes += `${typeConfig.title}\n\n`;
      typeConfig.commits.forEach((commit) => {
        const scopeText = commit.scope ? `**${commit.scope}**: ` : '';
        const description = commit.description;
        releaseNotes += `- ${scopeText}${description} (${commit.sha})\n`;
      });
      releaseNotes += '\n';
    }
  }

  const hasAnyCommits = Object.values(commitTypes).some((typeConfig) => typeConfig.commits.length > 0);
  if (!hasAnyCommits) {
    releaseNotes += 'No significant changes in this release.\n\n';
  }

  return releaseNotes;
}

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const defaultVersion = core.getInput('default-version') || '0.0.0';

    // Create octokit client
    const octokit = github.getOctokit(token);
    const context = github.context;
    const { owner, repo } = context.repo;
    core.debug(`Repository: ${owner}/${repo}`);

    // Get latest release data
    const { currentReleaseDate, currentReleaseTag } = await getLatestReleaseData(octokit, owner, repo, defaultVersion);
    core.info(`Current release: ${currentReleaseTag} at ${currentReleaseDate.toISOString()}`);

    // Get all commits since the latest release and parse them
    const parsedCommits = await getCommitsSinceDate(octokit, owner, repo, currentReleaseDate);
    core.info(`Found ${parsedCommits.length} commits since last release`);

    // Calculate next version based on parsed commits
    const nextVersion = calculateNextVersion(parsedCommits, currentReleaseTag);
    core.info(`Next version determined to be: ${nextVersion}`);
    const shouldRelease = nextVersion !== currentReleaseTag;
    core.info(`Should release: ${shouldRelease}`);

    // Generate release notes from parsed commits
    const releaseNotes = generateReleaseNotes(parsedCommits, nextVersion);
    core.info('Generated release notes:');
    core.info(releaseNotes);

    // Set outputs
    core.setOutput('next-version', nextVersion);
    core.setOutput('should-release', shouldRelease);
    core.setOutput('release-notes', releaseNotes);

    // Set Summary
    const current = {
      major: semver.major(currentReleaseTag),
      minor: semver.minor(currentReleaseTag),
      patch: semver.patch(currentReleaseTag)
    };
    const next = {
      major: semver.major(nextVersion),
      minor: semver.minor(nextVersion),
      patch: semver.patch(nextVersion)
    };

    // Determine what changed and add appropriate icons
    const majorIcon = next.major > current.major ? ' 🔼' : '';
    const minorIcon = next.minor > current.minor ? ' 🔼' : next.minor < current.minor ? ' 🔄' : '';
    const patchIcon = next.patch > current.patch ? ' 🔼' : next.patch < current.patch ? ' 🔄' : '';
    const releaseIcon = shouldRelease ? '✅' : '❌';

    await core.summary
      .addHeading('Release Summary', 1)
      .addTable([
        ['', 'Major', 'Minor', 'Patch'],
        ['Current', current.major.toString(), current.minor.toString(), current.patch.toString()],
        ['Next', `${next.major}${majorIcon}`, `${next.minor}${minorIcon}`, `${next.patch}${patchIcon}`]
      ])
      .addRaw(`\n**Should Release:** ${releaseIcon}\n\n`)
      .addHeading('Release Notes', 2)
      .addCodeBlock(releaseNotes, 'markdown')
      .write();
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run, getLatestReleaseData, getCommitsSinceDate, calculateNextVersion, generateReleaseNotes };
