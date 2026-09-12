import axios from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const api = axios.create({
  baseURL: 'https://api.deepseek.com',
  timeout: config.deepseek.timeout,
  headers: {
    Authorization: `Bearer ${config.deepseek.apiKey}`,
    'Content-Type': 'application/json',
  },
});

const SYSTEM_PROMPT = `You are an expert at understanding and summarizing GitHub Pull Requests.

Your task is to create a clear, concise summary of a PR that helps developers understand what changed and why.

CRITICAL RULES:
1. Only use information provided in the PR data. Do NOT invent details.
2. If something cannot be determined from the data, say "Details not provided" rather than guessing.
3. Do NOT claim to understand architectural decisions, security implications, or testing results unless the PR data explicitly supports them.
4. Focus on WHAT changed, not just WHICH files changed.
5. Highlight the progression/evolution of changes across commits when meaningful.
6. Note reviewer feedback and how the PR evolved in response.
7. Be concise but thorough - developers should understand the PR without reading every commit.

Format your response as follows:
## Summary
[One-paragraph overview of what this PR does and why]

## What Changed
[Key files, components, and functionality affected - be specific]

## Evolution & Reviews
[If there are multiple commits or reviews, explain how the PR evolved]

## Current State
[Is it ready to merge? Any noted issues or TODOs?]

## Important Notes
[Any caveats, known limitations, or things reviewers flagged that are worth highlighting]`;

async function callDeepSeek(messages: DeepSeekMessage[]): Promise<DeepSeekResponse> {
  try {
    const response = await api.post<DeepSeekResponse>('/chat/completions', {
      model: config.deepseek.model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 429) {
        logger.warn('DeepSeek rate limit hit');
        throw new Error('DEEPSEEK_RATE_LIMITED');
      }
      if (error.code === 'ECONNABORTED') {
        logger.warn('DeepSeek request timeout');
        throw new Error('DEEPSEEK_TIMEOUT');
      }
    }
    logger.error('DeepSeek API error', error);
    throw error;
  }
}

export interface PRContextData {
  title: string;
  description: string | null;
  author: string;
  createdAt: string;
  updatedAt: string;
  state: string;
  commits: Array<{
    sha: string;
    message: string;
    author: string;
    date: string;
  }>;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
  reviews: Array<{
    author: string;
    state: string;
    body: string | null;
    submittedAt: string;
  }>;
  comments: Array<{
    author: string;
    body: string;
    createdAt: string;
  }>;
}

function truncateDiff(
  patch: string | undefined,
  maxChars: number
): string {
  if (!patch) return '';
  if (patch.length <= maxChars) return patch;
  return patch.substring(0, maxChars) + '\n[... diff truncated ...]';
}

function buildContextPrompt(context: PRContextData, maxDiffSize: number): string {
  const lines: string[] = [];

  lines.push('# Pull Request Information\n');
  lines.push(`**Title:** ${context.title}`);
  lines.push(`**Author:** ${context.author}`);
  lines.push(`**State:** ${context.state}`);
  lines.push(`**Created:** ${context.createdAt}`);
  lines.push(`**Updated:** ${context.updatedAt}`);

  if (context.description) {
    lines.push(`\n**Description:**\n${context.description}`);
  }

  lines.push('\n# Commits\n');
  context.commits.forEach((commit, idx) => {
    lines.push(`${idx + 1}. [${commit.sha.substring(0, 7)}] ${commit.message}`);
    lines.push(`   Author: ${commit.author} | Date: ${commit.date}`);
  });

  lines.push('\n# Files Changed\n');
  let totalDiffSize = 0;
  const filesWithPatches: Array<{ filename: string; patch: string }> = [];

  context.files.forEach((file) => {
    const status = file.status === 'added' ? '✚' : file.status === 'deleted' ? '✖' : '✏';
    lines.push(
      `${status} ${file.filename} (+${file.additions}/-${file.deletions})`
    );

    if (file.patch) {
      totalDiffSize += file.patch.length;
      if (totalDiffSize <= maxDiffSize) {
        filesWithPatches.push({
          filename: file.filename,
          patch: file.patch,
        });
      }
    }
  });

  if (filesWithPatches.length > 0) {
    lines.push('\n# Detailed Diffs\n');
    filesWithPatches.forEach(({ filename, patch }) => {
      lines.push(`\n## ${filename}`);
      lines.push(truncateDiff(patch, maxDiffSize / filesWithPatches.length));
    });
  }

  if (context.reviews.length > 0) {
    lines.push('\n# Reviews\n');
    context.reviews.forEach((review) => {
      lines.push(
        `**${review.author}** (${review.state}) - ${review.submittedAt}`
      );
      if (review.body) {
        lines.push(`> ${review.body}`);
      }
    });
  }

  if (context.comments.length > 0) {
    lines.push('\n# PR Conversation\n');
    context.comments.slice(0, 10).forEach((comment) => {
      lines.push(
        `**${comment.author}** (${comment.createdAt}): ${comment.body}`
      );
    });
    if (context.comments.length > 10) {
      lines.push(
        `\n[... ${context.comments.length - 10} more comments omitted ...]`
      );
    }
  }

  return lines.join('\n');
}

export async function generatePRSummary(
  context: PRContextData
): Promise<{
  summary: string;
  tokensUsed: number;
}> {
  try {
    logger.info('Starting PR summarization', {
      title: context.title,
      commitsCount: context.commits.length,
      filesCount: context.files.length,
    });

    const contextPrompt = buildContextPrompt(context, config.app.maxDiffSize);

    const messages: DeepSeekMessage[] = [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: contextPrompt,
      },
    ];

    const response = await callDeepSeek(messages);
    const summary =
      response.choices[0]?.message?.content ||
      'Failed to generate summary';
    const tokensUsed = response.usage.total_tokens;

    logger.info('PR summarization completed', {
      title: context.title,
      tokensUsed,
    });

    return {
      summary,
      tokensUsed,
    };
  } catch (error) {
    logger.error('PR summarization failed', error);
    throw error;
  }
}
