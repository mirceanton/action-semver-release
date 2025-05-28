const core = require('@actions/core');
const semver = require('semver');
const { getLatestReleaseData, getCommitsSinceDate, calculateNextVersion, generateReleaseNotes } = require('./index.js');

jest.mock('@actions/core');

describe('GitHub Action - Semantic Version Release Functions', () => {
  let mockOctokit;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOctokit = {
      rest: {
        repos: {
          getLatestRelease: jest.fn(),
          listCommits: jest.fn()
        }
      }
    };
  });

  describe('getLatestReleaseData', () => {
    it('should return latest release data when release exists', async () => {
      mockOctokit.rest.repos.getLatestRelease.mockResolvedValue({
        data: {
          created_at: '2024-01-15T10:30:00Z',
          tag_name: 'v1.2.3'
        }
      });

      const result = await getLatestReleaseData(mockOctokit, 'owner', 'repo', '0.0.0');
      expect(result).toEqual({
        currentReleaseDate: new Date('2024-01-15T10:30:01Z'), // note the 1 sec added
        currentReleaseTag: '1.2.3'
      });
    });

    it('should use default version when semver.clean returns null', async () => {
      mockOctokit.rest.repos.getLatestRelease.mockResolvedValue({
        data: {
          created_at: '2024-01-15T10:30:00Z',
          tag_name: 'invalid-tag'
        }
      });

      const result = await getLatestReleaseData(mockOctokit, 'owner', 'repo', '0.1.0');
      expect(result).toEqual({
        currentReleaseDate: new Date('2024-01-15T10:30:01Z'), // note the 1 sec added
        currentReleaseTag: '0.1.0'
      });
    });

    it('should return default version when no previous release exists', async () => {
      mockOctokit.rest.repos.getLatestRelease.mockRejectedValue(new Error('Not Found'));

      const result = await getLatestReleaseData(mockOctokit, 'owner', 'repo', '1.0.0');
      expect(result.currentReleaseTag).toBe('1.0.0');
    });

    it('should return default version when no created_at date exists', async () => {
      mockOctokit.rest.repos.getLatestRelease.mockResolvedValue({ data: {} });

      const result = await getLatestReleaseData(mockOctokit, 'owner', 'repo', '0.5.0');
      const afterCall = Date.now();

      expect(result.currentReleaseTag).toBe('0.5.0');
      expect(result.currentReleaseDate).toBeInstanceOf(Date);
      expect(result.currentReleaseDate.getTime()).toBeLessThanOrEqual(afterCall);
    });

    it('should return default version when created_at is null', async () => {
      mockOctokit.rest.repos.getLatestRelease.mockResolvedValue({ data: { created_at: null, tag_name: 'v1.0.0' } });

      const result = await getLatestReleaseData(mockOctokit, 'owner', 'repo', '1.0.0');
      expect(result.currentReleaseTag).toBe('1.0.0');
    });

    it('should throw descriptive error when API call fails', async () => {
      mockOctokit.rest.repos.getLatestRelease.mockRejectedValue(new Error('Unknown error'));

      await expect(getLatestReleaseData(mockOctokit, 'owner', 'repo', '0.0.0')).rejects.toThrow(
        'Failed to get latest release: Unknown error'
      );
    });
  });

  describe('getCommitsSinceDate', () => {
    it('should parse conventional commits with all variations', async () => {
      mockOctokit.rest.repos.listCommits.mockResolvedValue({
        data: [
          {
            sha: '1234567890abcdef1234567890abcdef12345678',
            commit: {
              message: 'feat(auth): add OAuth 2.0 support\n\nImplemented full OAuth 2.0 flow with refresh tokens',
              author: { name: 'John Doe' }
            }
          },
          {
            sha: 'abcdef1234567890abcdef1234567890abcdef12',
            commit: {
              message: 'fix: resolve memory leak in worker threads\n\nBREAKING CHANGE: Worker API has been redesigned',
              author: { name: 'Jane Smith' }
            }
          },
          {
            sha: 'fedcba0987654321fedcba0987654321fedcba09',
            commit: {
              message: 'feat!: redesign user authentication system',
              author: { name: 'Alice Brown' }
            }
          },
          {
            sha: 'abcd1234efgh5678ijkl9012mnop3456qrst7890',
            commit: {
              message: 'perf(database): optimize query performance\n\nReduced query time by 40%',
              author: { name: 'Bob Wilson' }
            }
          }
        ]
      });
      const sinceDate = new Date('2024-01-01T00:00:00Z');

      const result = await getCommitsSinceDate(mockOctokit, 'owner', 'repo', sinceDate);

      expect(result).toHaveLength(4);

      // Test feat commit with scope
      expect(result[0]).toMatchObject({
        sha: '1234567',
        type: 'feat',
        scope: 'auth',
        description: 'add OAuth 2.0 support',
        body: 'Implemented full OAuth 2.0 flow with refresh tokens',
        isBreaking: false,
        fullMessage: 'feat(auth): add OAuth 2.0 support\n\nImplemented full OAuth 2.0 flow with refresh tokens',
        author: 'John Doe'
      });

      // Test fix with breaking change in body
      expect(result[1]).toMatchObject({
        sha: 'abcdef1',
        type: 'fix',
        scope: '',
        description: 'resolve memory leak in worker threads',
        body: 'BREAKING CHANGE: Worker API has been redesigned',
        isBreaking: true,
        author: 'Jane Smith'
      });

      // Test breaking change with ! notation
      expect(result[2]).toMatchObject({
        sha: 'fedcba0',
        type: 'feat',
        scope: '',
        description: 'redesign user authentication system',
        isBreaking: true,
        author: 'Alice Brown'
      });

      // Test perf commit with scope
      expect(result[3]).toMatchObject({
        sha: 'abcd123',
        type: 'perf',
        scope: 'database',
        description: 'optimize query performance',
        body: 'Reduced query time by 40%',
        isBreaking: false,
        author: 'Bob Wilson'
      });
    });

    it('should handle non-conventional commit formats', async () => {
      mockOctokit.rest.repos.listCommits.mockResolvedValue({
        data: [
          {
            sha: '1111222233334444555566667777888899990000',
            commit: {
              message: 'Update README with new installation instructions',
              author: { name: 'Test User' }
            }
          },
          {
            sha: '2222333344445555666677778888999900001111',
            commit: {
              message: '',
              author: { name: 'Empty Commit' }
            }
          },
          {
            sha: '3333444455556666777788889999000011112222',
            commit: {
              message: 'fix(api) missing colon after type',
              author: { name: 'Malformed User' }
            }
          }
        ]
      });

      const result = await getCommitsSinceDate(mockOctokit, 'owner', 'repo', new Date());
      expect(result).toHaveLength(3);

      // Non-conventional commit
      expect(result[0]).toMatchObject({
        sha: '1111222',
        type: 'other',
        scope: '',
        description: 'Update README with new installation instructions',
        body: '',
        isBreaking: false
      });

      // Empty commit message
      expect(result[1]).toMatchObject({
        sha: '2222333',
        type: 'other',
        scope: '',
        description: '',
        body: '',
        isBreaking: false
      });

      // Malformed conventional commit (missing colon)
      expect(result[2]).toMatchObject({
        sha: '3333444',
        type: 'other',
        scope: '',
        description: 'fix(api) missing colon after type',
        body: '',
        isBreaking: false
      });
    });

    it('should handle complex scopes and multiline bodies', async () => {
      mockOctokit.rest.repos.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
            commit: {
              message:
                'feat(api/v2/auth/oauth): add complex nested scope\n\nLine 1 of body\nLine 2 of body\n\nBREAKING CHANGE: This breaks things\nMore breaking info',
              author: { name: 'Complex User' }
            }
          }
        ]
      });

      const result = await getCommitsSinceDate(mockOctokit, 'owner', 'repo', new Date());
      expect(result).toHaveLength(1);

      // Test complex scope with multiline body and breaking change
      expect(result[0]).toMatchObject({
        type: 'feat',
        scope: 'api/v2/auth/oauth',
        description: 'add complex nested scope',
        body: 'Line 1 of body\nLine 2 of body\n\nBREAKING CHANGE: This breaks things\nMore breaking info',
        isBreaking: true
      });
    });

    it('should call GitHub API with correct parameters', async () => {
      mockOctokit.rest.repos.listCommits.mockResolvedValue({ data: [] });
      const sinceDate = new Date('2024-03-15T14:30:45.123Z');

      await getCommitsSinceDate(mockOctokit, 'test-owner', 'test-repo', sinceDate);

      expect(mockOctokit.rest.repos.listCommits).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        since: '2024-03-15T14:30:45.123Z'
      });
    });

    it('should throw descriptive error when API call fails', async () => {
      mockOctokit.rest.repos.listCommits.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(getCommitsSinceDate(mockOctokit, 'owner', 'repo', new Date())).rejects.toThrow(
        'Failed to get commits: Rate limit exceeded'
      );
    });
  });

  describe('calculateNextVersion', () => {
    beforeEach(() => {
      core.info.mockClear();
    });

    it('should bump major version for breaking changes', () => {
      const commits = [
        { type: 'feat', isBreaking: true, sha: 'abc123' },
        { type: 'feat', isBreaking: false, sha: 'def456' },
        { type: 'fix', isBreaking: false, sha: 'ghi789' }
      ];

      const result = calculateNextVersion(commits, '1.5.3');
      expect(result).toBe('2.0.0');
    });

    it('should bump minor version for features without breaking changes', () => {
      const commits = [
        { type: 'feat', isBreaking: false, sha: 'abc123' },
        { type: 'feat', isBreaking: false, sha: 'def456' },
        { type: 'fix', isBreaking: false, sha: 'ghi789' },
        { type: 'docs', isBreaking: false, sha: 'jkl012' }
      ];

      const result = calculateNextVersion(commits, '2.1.4');
      expect(result).toBe('2.2.0');
    });

    it('should bump patch version for fixes only', () => {
      const commits = [
        { type: 'fix', isBreaking: false, sha: 'abc123' },
        { type: 'fix', isBreaking: false, sha: 'def456' },
        { type: 'docs', isBreaking: false, sha: 'ghi789' },
        { type: 'style', isBreaking: false, sha: 'jkl012' }
      ];

      const result = calculateNextVersion(commits, '1.0.0');
      expect(result).toBe('1.0.1');
    });

    it('should not bump version for non-significant commits', () => {
      const commits = [
        { type: 'docs', isBreaking: false, sha: 'abc123' },
        { type: 'style', isBreaking: false, sha: 'def456' },
        { type: 'refactor', isBreaking: false, sha: 'ghi789' },
        { type: 'test', isBreaking: false, sha: 'jkl012' },
        { type: 'chore', isBreaking: false, sha: 'mno345' }
      ];

      const result = calculateNextVersion(commits, '3.2.1');
      expect(result).toBe('3.2.1');
    });

    it('should prioritize breaking changes over features and fixes', () => {
      const commits = [
        { type: 'feat', isBreaking: false, sha: 'feature1' },
        { type: 'fix', isBreaking: true, sha: 'breaking1' },
        { type: 'feat', isBreaking: false, sha: 'feature2' },
        { type: 'fix', isBreaking: false, sha: 'fix1' }
      ];

      const result = calculateNextVersion(commits, '1.0.0');
      expect(result).toBe('2.0.0');
    });

    it('should prioritize features over fixes', () => {
      const commits = [
        { type: 'fix', isBreaking: false, sha: 'fix1' },
        { type: 'feat', isBreaking: false, sha: 'feat1' },
        { type: 'fix', isBreaking: false, sha: 'fix2' }
      ];

      const result = calculateNextVersion(commits, '0.5.0');
      expect(result).toBe('0.6.0');
    });

    it('should handle empty commits array', () => {
      const commits = [];

      const result = calculateNextVersion(commits, '1.2.3');
      expect(result).toBe('1.2.3');
    });
  });

  describe('generateReleaseNotes', () => {
    it('should generate comprehensive release notes with all commit types', () => {
      const commits = [
        {
          type: 'feat',
          scope: 'auth',
          description: 'add OAuth 2.0 support',
          isBreaking: false,
          sha: 'feat123'
        },
        {
          type: 'fix',
          scope: 'api',
          description: 'resolve timeout issues',
          isBreaking: true,
          sha: 'break123'
        },
        {
          type: 'perf',
          scope: '',
          description: 'optimize database queries',
          isBreaking: false,
          sha: 'perf123'
        },
        {
          type: 'docs',
          scope: 'readme',
          description: 'update installation guide',
          isBreaking: false,
          sha: 'docs123'
        },
        {
          type: 'build',
          scope: 'webpack',
          description: 'update build configuration',
          isBreaking: false,
          sha: 'build123'
        },
        {
          type: 'ci',
          scope: '',
          description: 'add automated testing',
          isBreaking: false,
          sha: 'ci123'
        },
        {
          type: 'test',
          scope: 'unit',
          description: 'improve test coverage',
          isBreaking: false,
          sha: 'test123'
        },
        {
          type: 'refactor',
          scope: 'auth',
          description: 'simplify authentication logic',
          isBreaking: false,
          sha: 'refactor123'
        },
        {
          type: 'style',
          scope: '',
          description: 'fix code formatting',
          isBreaking: false,
          sha: 'style123'
        },
        {
          type: 'chore',
          scope: 'deps',
          description: 'update dependencies',
          isBreaking: false,
          sha: 'chore123'
        }
      ];

      const result = generateReleaseNotes(commits, '2.1.0');

      expect(result).toContain('# Release 2.1.0');

      // Check breaking changes section
      expect(result).toContain('## 💥 Breaking Changes');
      expect(result).toContain('- **api**: resolve timeout issues (break123)');

      // Check features section
      expect(result).toContain('## ✨ New Features');
      expect(result).toContain('- **auth**: add OAuth 2.0 support (feat123)');

      // Check performance section
      expect(result).toContain('## ⚡ Performance Improvements');
      expect(result).toContain('- optimize database queries (perf123)');

      // Check other sections
      expect(result).toContain('## 📚 Documentation');
      expect(result).toContain('- **readme**: update installation guide (docs123)');

      expect(result).toContain('## 📦 Build System');
      expect(result).toContain('- **webpack**: update build configuration (build123)');

      expect(result).toContain('## 👷 CI/CD');
      expect(result).toContain('- add automated testing (ci123)');

      expect(result).toContain('## 🧪 Tests');
      expect(result).toContain('- **unit**: improve test coverage (test123)');

      expect(result).toContain('## ♻️ Code Refactoring');
      expect(result).toContain('- **auth**: simplify authentication logic (refactor123)');

      expect(result).toContain('## 💄 Code Style');
      expect(result).toContain('- fix code formatting (style123)');

      expect(result).toContain('## 🧹 Chores');
      expect(result).toContain('- **deps**: update dependencies (chore123)');
    });

    it('should handle commits without scope correctly', () => {
      const commits = [
        {
          type: 'feat',
          scope: '',
          description: 'add new feature without scope',
          isBreaking: false,
          sha: 'noscope1'
        },
        {
          type: 'fix',
          scope: null,
          description: 'fix with null scope',
          isBreaking: false,
          sha: 'noscope2'
        }
      ];

      const result = generateReleaseNotes(commits, '1.1.0');

      expect(result).toContain('- add new feature without scope (noscope1)');
      expect(result).toContain('- fix with null scope (noscope2)');
      expect(result).not.toContain('**:**');
      expect(result).not.toContain('**null**:');
    });

    it('should categorize unknown commit types as "Other Changes"', () => {
      const commits = [
        {
          type: 'unknown',
          scope: 'test',
          description: 'some unknown change',
          isBreaking: false,
          sha: 'unknown1'
        },
        {
          type: 'custom',
          scope: '',
          description: 'custom commit type',
          isBreaking: false,
          sha: 'custom1'
        }
      ];

      const result = generateReleaseNotes(commits, '1.0.1');

      expect(result).toContain('## 🔧 Other Changes');
      expect(result).toContain('- **test**: some unknown change (unknown1)');
      expect(result).toContain('- custom commit type (custom1)');
    });

    it('should show "No significant changes" message when no commits', () => {
      const commits = [];

      const result = generateReleaseNotes(commits, '1.0.1');

      expect(result).toContain('# Release 1.0.1');
      expect(result).toContain('No significant changes in this release.');
      expect(result).not.toContain('##');
    });

    it('should properly handle breaking changes mixed with regular commits of same type', () => {
      const commits = [
        {
          type: 'feat',
          scope: 'auth',
          description: 'add login feature',
          isBreaking: false,
          sha: 'feat1'
        },
        {
          type: 'feat',
          scope: 'auth',
          description: 'redesign auth system',
          isBreaking: true,
          sha: 'breaking1'
        },
        {
          type: 'fix',
          scope: 'api',
          description: 'fix bug',
          isBreaking: false,
          sha: 'fix1'
        }
      ];

      const result = generateReleaseNotes(commits, '2.0.0');

      // Breaking change should be in breaking section, not features
      expect(result).toContain('## 💥 Breaking Changes');
      expect(result).toContain('- **auth**: redesign auth system (breaking1)');

      // Regular feature should be in features section
      expect(result).toContain('## ✨ New Features');
      expect(result).toContain('- **auth**: add login feature (feat1)');

      // Fix should be in fixes section
      expect(result).toContain('## 🐛 Bug Fixes');
      expect(result).toContain('- **api**: fix bug (fix1)');
    });

    it('should maintain proper section order', () => {
      const commits = [
        { type: 'chore', scope: '', description: 'update deps', isBreaking: false, sha: 'chore1' },
        { type: 'feat', scope: '', description: 'new feature', isBreaking: true, sha: 'breaking1' },
        { type: 'docs', scope: '', description: 'update docs', isBreaking: false, sha: 'docs1' }
      ];

      const result = generateReleaseNotes(commits, '1.0.0');

      const breakingIndex = result.indexOf('## 💥 Breaking Changes');
      const choresIndex = result.indexOf('## 🧹 Chores');
      const docsIndex = result.indexOf('## 📚 Documentation');

      // Breaking changes should come first
      expect(breakingIndex).toBeLessThan(docsIndex);
      expect(breakingIndex).toBeLessThan(choresIndex);
    });

    it('should handle edge cases in commit descriptions', () => {
      const commits = [
        {
          type: 'feat',
          scope: 'complex/nested/scope',
          description: 'handle very long description that might wrap lines and contain special characters like & < >',
          isBreaking: false,
          sha: 'edge1'
        },
        {
          type: 'fix',
          scope: '',
          description: '',
          isBreaking: false,
          sha: 'edge2'
        }
      ];

      const result = generateReleaseNotes(commits, '1.0.0');

      expect(result).toContain(
        '- **complex/nested/scope**: handle very long description that might wrap lines and contain special characters like & < > (edge1)'
      );
      expect(result).toContain('-  (edge2)');
    });
  });
});
