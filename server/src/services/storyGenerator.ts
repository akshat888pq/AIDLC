import type { LLMAdapter } from './llm/adapter.js';
import type { Epic, Session, UserStory } from '../types/index.js';
import {
  buildEpicStoriesPrompt,
  FIBONACCI_POINTS,
  MAX_STORIES,
  MIN_STORIES,
} from '../prompts/epicStories.js';
import { buildSecondBrainContextBlock, readBrain } from './secondBrain.js';
import { parseLlmJson, readParsedDocuments } from './sessionContext.js';

const VALID_PRIORITIES = ['High', 'Medium', 'Low'] as const;

function toStringArray(value: any): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' && value.trim() ? [value.trim()] : [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()))
    .filter((v) => v.length > 0);
}

/** Snap any number the model returns to the nearest allowed Fibonacci point. */
function snapToFibonacci(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 3;
  return FIBONACCI_POINTS.reduce((best, candidate) =>
    Math.abs(candidate - n) < Math.abs(best - n) ? candidate : best
  );
}

function normalizePriority(value: any): 'High' | 'Medium' | 'Low' {
  const text = String(value ?? '').trim().toLowerCase();
  if (text.startsWith('h') || text.includes('must') || text.includes('critical')) return 'High';
  if (text.startsWith('l') || text.includes('could') || text.includes('nice')) return 'Low';
  return 'Medium';
}

/** Ensure each AC reads as Given/When/Then; wrap anything that doesn't. */
function normalizeAcceptanceCriteria(items: string[], story: string): string[] {
  const normalized = items
    .map((ac) => ac.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((ac) => {
      const lower = ac.toLowerCase();
      if (lower.includes('given') && lower.includes('when') && lower.includes('then')) return ac;
      // Keep the model's content but make the missing structure explicit rather than
      // silently shipping a malformed criterion.
      return `Given the feature is available When ${ac.charAt(0).toLowerCase()}${ac.slice(1)} Then the expected outcome is met`;
    });

  if (normalized.length >= 2) return normalized;

  const filler = `Given a valid user context When the behaviour described in "${story}" is exercised Then the system responds successfully and the result is persisted`;
  return [...normalized, filler].slice(0, Math.max(2, normalized.length + 1));
}

export interface GeneratedStories {
  epic: Epic;
  stories: UserStory[];
}

export async function generateEpicAndStories(
  llm: LLMAdapter,
  session: Session
): Promise<GeneratedStories> {
  const brain = readBrain(session.id);
  const parsedDocuments = await readParsedDocuments(session, 40_000);

  const prompt = buildEpicStoriesPrompt({
    secondBrainContext: buildSecondBrainContextBlock(session.id),
    parsedDocuments,
  });

  const raw = await llm.analyze(prompt, '');
  const parsed = parseLlmJson<any>(raw, 'epic and stories');

  const fallbackTitle =
    brain?.projectName && brain.projectName !== 'Untitled Project'
      ? brain.projectName
      : 'Project Delivery Epic';

  const epic: Epic = {
    title: (typeof parsed.epic?.title === 'string' && parsed.epic.title.trim()) || fallbackTitle,
    description:
      (typeof parsed.epic?.description === 'string' && parsed.epic.description.trim()) ||
      brain?.understandingSummary?.projectOverview ||
      'No epic description was produced.',
    businessValue:
      (typeof parsed.epic?.businessValue === 'string' && parsed.epic.businessValue.trim()) ||
      'Business value not stated.',
    acceptanceCriteria: toStringArray(parsed.epic?.acceptanceCriteria),
  };

  const rawStories: any[] = Array.isArray(parsed.stories) ? parsed.stories : [];
  if (rawStories.length === 0) {
    throw new Error('The model returned no user stories. Try generating the report again.');
  }

  let stories: UserStory[] = rawStories.slice(0, MAX_STORIES).map((s, index) => {
    const title = (typeof s.title === 'string' && s.title.trim()) || `User story ${index + 1}`;
    const userStory =
      (typeof s.userStory === 'string' && s.userStory.trim()) ||
      `As a user, I want ${title.toLowerCase()}, so that the project objective is met`;

    return {
      id: `US-${String(index + 1).padStart(3, '0')}`,
      title,
      userStory,
      acceptanceCriteria: normalizeAcceptanceCriteria(
        toStringArray(s.acceptanceCriteria),
        userStory
      ),
      storyPoints: snapToFibonacci(s.storyPoints),
      priority: normalizePriority(s.priority),
      epic: epic.title,
      labels: toStringArray(s.labels).map((l) => l.toLowerCase()).slice(0, 3),
      component: (typeof s.component === 'string' && s.component.trim()) || 'General',
      status: (typeof s.status === 'string' && s.status.trim()) || 'To Do',
    };
  });

  if (stories.length < MIN_STORIES) {
    console.warn(
      `[storyGenerator] session=${session.id} model returned ${stories.length} stories, below the minimum of ${MIN_STORIES}`
    );
  }

  // Guard against duplicate labels within a story.
  stories = stories.map((s) => ({ ...s, labels: [...new Set(s.labels)] }));

  if (epic.acceptanceCriteria.length === 0) {
    epic.acceptanceCriteria = [
      `All ${stories.length} user stories in this epic are delivered and accepted`,
    ];
  }

  return { epic, stories };
}

export { MIN_STORIES, MAX_STORIES, VALID_PRIORITIES };
