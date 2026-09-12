import { logger } from '../utils/logger';
import { config } from '../utils/config';
import {
  getInstallation,
  getRepository,
  getPR,
  updateCheckRunId,
  storeSummary,
  getPool,
} from '../db/models';
import { getInstallationAccessToken, createGitHubAPI } from '../github/auth';
import {
  getPRData,
  getPRCommits,
  getPRFiles,
  getPRReviews,
  getPRComments,
  createCheckRun,
  updateCheckRun,
  GitHubFile,
  GitHubCommit,
} from '../github/api';
import { generatePRSummary, PRContextData } from '../ai/deepseek';

export async function processPR(
  githubInstallationId: number,
  githubRepoId: number,
  prNumber: number,
  owner: string,
  repo: string
): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Starting PR processing', {
      installation: githubInstallationId,
      repo: `${owner}/${repo}`,
      prNumber,
    });

    // Get installation
    const installation = await getInstallation(githubInstallationId);
    if (!installation) {
      throw new Error('Installation not found');
    }

    // Get repository
    const repository = await getRepository(installation.id, githubRepoId);
    if (!repository) {
      throw new Error('Repository not found');
    }

    // Get or create PR record
    const prData = await getPRData(
      createGitHubAPI(
        await getInstallationAccessToken(githubInstallationId)
      ),
      owner,
      repo,
      prNumber
    );

    const pr = await getPR(installation.id, repository.id, prNumber);
    if (!pr) {
      throw new Error('PR record not found');
    }

    // Skip if already processing
    if (pr.state === 'closed' && pr.last_processed_commit_sha === prData.head.sha) {
      logger.info('PR already fully processed', { prNumber });
      return;
    }

    // Collect context
    logger.debug('Collecting PR context', { prNumber });
    const token = await getInstallationAccessToken(githubInstallationId);
    const api = createGitHubAPI(token);

    const [commits, files, reviews, comments] = await Promise.all([
      getPRCommits(api, owner, repo, prNumber),
      getPRFiles(api, owner, repo, prNumber),
      getPRReviews(api, owner, repo, prNumber),
      getPRComments(api, owner, repo, prNumber),
    ]);

    // Build context for AI
    const context: PRContextData = {
      title: prData.title,
      description: prData.body,
      author: prData.user.login,
      createdAt: prData.created_at,
      updatedAt: prData.updated_at,
      state: prData.state,
      commits: commits.map((c: GitHubCommit) => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.author?.login || c.commit.author.name,
        date: c.commit.author.date,
      })),
      files: files.map((f: GitHubFile) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
      reviews: reviews.map((r) => ({
        author: r.user.login,
        state: r.state,
        body: r.body,
        submittedAt: r.submitted_at,
      })),
      comments: comments.map((c) => ({
        author: c.user.login,
        body: c.body,
        createdAt: c.created_at,
      })),
    };

    // Generate summary
    logger.debug('Generating AI summary', { prNumber });
    const { summary, tokensUsed } = await generatePRSummary(context);

    // Calculate metrics
    const diffSize = files.reduce((acc, f: GitHubFile) => {
      return acc + (f.patch?.length || 0);
    }, 0);

    // Create or update check run
    logger.debug('Updating check run', { prNumber });

    const checkRunData = {
      name: 'PR Summary',
      status: 'completed' as const,
      conclusion: 'neutral' as const,
      external_id: `pr-summary-${prNumber}`,
      output: {
        title: 'AI-Generated PR Summary',
        summary: summary.substring(0, 65536), // GitHub API limit
        text: `Generated from ${commits.length} commits across ${files.length} files.`,
      },
    };

    if (pr.check_run_id) {
      // Update existing check run
      await updateCheckRun(api, owner, repo, pr.check_run_id, {
        status: 'completed',
        conclusion: 'neutral',
        output: checkRunData.output,
      });
    } else {
      // Create new check run
      const checkRun = await createCheckRun(
        api,
        owner,
        repo,
        prData.head.sha,
        checkRunData
      );
      await updateCheckRunId(pr.id, checkRun.id, checkRunData.external_id);
    }

    // Store summary
    logger.debug('Storing summary', { prNumber });
    await storeSummary(
      pr.id,
      summary,
      null,
      commits.length,
      diffSize,
      Date.now() - startTime,
      config.deepseek.model,
      tokensUsed
    );

    // Update PR processed state
    await getPool().query(
      `UPDATE pull_requests
       SET last_processed_at = CURRENT_TIMESTAMP, last_processed_commit_sha = $1
       WHERE id = $2`,
      [prData.head.sha, pr.id]
    );

    logger.info('PR processing completed', {
      prNumber,
      durationMs: Date.now() - startTime,
      commitsCount: commits.length,
      filesCount: files.length,
      tokensUsed,
    });
  } catch (error) {
    logger.error('PR processing failed', {
      prNumber,
      error,
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
}
