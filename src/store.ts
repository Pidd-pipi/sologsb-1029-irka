import { reactive, watch } from 'vue';
import { createInitialState } from './data';
import type { Lesson, PersistedState, PracticeAttempt, ReviewCard, SentenceAttempt, TokenResult } from './types';
import { dayKey, normalizeToken, segmentText } from './utils';

const STORAGE_KEY = 'sologsb-1029-dictation-state-v1';

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.schemaVersion === 1) {
        const hadReviewCards = Array.isArray(parsed.reviewCards);
        const migrated: PersistedState = { ...parsed, reviewCards: hadReviewCards ? parsed.reviewCards : [] };
        if (!hadReviewCards && Array.isArray(migrated.attempts)) {
          // Backfill the review deck from earlier submissions, oldest first.
          [...migrated.attempts].reverse().forEach((attempt) => ingestCards(migrated.reviewCards, attempt));
        }
        return migrated;
      }
    }
  } catch {
    // Falls back to the sample course when the local draft is malformed.
  }
  return createInitialState();
}

export const state = reactive<PersistedState>(loadState());

export const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
};

watch(state, persist, { deep: true });

export const lessons = (): Lesson[] => state.courses.flatMap((course) => course.lessons);
export const lessonById = (id: string): Lesson | undefined => lessons().find((lesson) => lesson.id === id);
export const courseForLesson = (lessonId: string) => state.courses.find((course) => course.id === lessonById(lessonId)?.courseId);

export function setDownloaded(lessonId: string, value: boolean) {
  const lesson = lessonById(lessonId);
  if (lesson) lesson.downloaded = value;
}

export function saveAttempt(attempt: PracticeAttempt) {
  state.attempts.unshift(attempt);
}

export function updateTokenClassification(attemptId: string, sentenceId: string, tokenIndex: number, patch: { category?: PracticeAttempt['sentenceAttempts'][number]['tokens'][number]['category']; reason?: string }) {
  const attempt = state.attempts.find((item) => item.id === attemptId);
  const token = attempt?.sentenceAttempts.find((item) => item.sentenceId === sentenceId)?.tokens.find((item) => item.index === tokenIndex);
  if (token) Object.assign(token, patch);
}

function upsertReviewCard(cards: ReviewCard[], attempt: PracticeAttempt, sentenceAttempt: SentenceAttempt, token: TokenResult, sourceTokenIndex: number): boolean {
  // Fall back to the typed word when the expected token is punctuation or absent (extra word).
  const word = normalizeToken(token.expected) ? token.expected : token.actual;
  const wordKey = normalizeToken(word);
  if (!wordKey) return false;
  const existing = cards.find((card) => card.sentenceId === sentenceAttempt.sentenceId && card.wordKey === wordKey);
  if (existing) {
    // The word was missed again: restart its streak and pull it back to today.
    existing.attemptId = attempt.id;
    existing.actual = token.actual;
    existing.category = token.category;
    existing.tokenIndex = token.index;
    existing.sourceTokenIndex = sourceTokenIndex;
    existing.streak = 0;
    existing.mastered = false;
    existing.dueDate = dayKey();
  } else {
    cards.push({
      id: `review-${attempt.id}-${sentenceAttempt.sentenceId}-${token.index}`,
      attemptId: attempt.id,
      lessonId: attempt.lessonId,
      lessonTitle: attempt.lessonTitle,
      courseTitle: attempt.courseTitle,
      sentenceId: sentenceAttempt.sentenceId,
      source: sentenceAttempt.source,
      word,
      wordKey,
      actual: token.actual,
      category: token.category,
      tokenIndex: token.index,
      sourceTokenIndex,
      streak: 0,
      practiceCount: 0,
      correctCount: 0,
      wrongCount: 0,
      mastered: false,
      dueDate: dayKey(),
      createdAt: new Date().toISOString(),
      lastPracticedAt: ''
    });
  }
  return true;
}

function ingestCards(cards: ReviewCard[], attempt: PracticeAttempt): number {
  let touched = 0;
  for (const sentenceAttempt of attempt.sentenceAttempts) {
    const sourceSegments = segmentText(sentenceAttempt.source);
    let sourcePos = 0;
    for (const token of sentenceAttempt.tokens) {
      const position = token.expected ? sourcePos : Math.min(sourcePos, Math.max(0, sourceSegments.length - 1));
      if (token.expected) sourcePos += 1;
      if (token.correct) continue;
      if (upsertReviewCard(cards, attempt, sentenceAttempt, token, position)) touched += 1;
    }
  }
  return touched;
}

export function ingestAttemptToReview(attempt: PracticeAttempt): number {
  return ingestCards(state.reviewCards, attempt);
}

export function recordReviewResult(cardId: string, correct: boolean): ReviewCard | undefined {
  const card = state.reviewCards.find((item) => item.id === cardId);
  if (!card) return undefined;
  card.practiceCount += 1;
  card.lastPracticedAt = new Date().toISOString();
  if (correct) {
    card.correctCount += 1;
    card.streak += 1;
    if (card.streak >= 2) {
      card.mastered = true;
      card.dueDate = '';
    } else {
      card.dueDate = dayKey(1);
    }
  } else {
    card.wrongCount += 1;
    card.streak = 0;
    card.mastered = false;
    card.dueDate = dayKey(1);
  }
  return card;
}

export const reviewCardsDue = (): ReviewCard[] => {
  const today = dayKey();
  return state.reviewCards
    .filter((card) => !card.mastered && card.dueDate && card.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt));
};

export const reviewCardsUpcoming = (): ReviewCard[] => {
  const today = dayKey();
  return state.reviewCards
    .filter((card) => !card.mastered && card.dueDate && card.dueDate > today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt));
};

export const reviewCardsMastered = (): ReviewCard[] => state.reviewCards
  .filter((card) => card.mastered)
  .sort((a, b) => b.lastPracticedAt.localeCompare(a.lastPracticedAt));

export function exportRecords(): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    attempts: state.attempts,
    progress: state.progress,
    reviewCards: state.reviewCards,
    reviewSummary: {
      total: state.reviewCards.length,
      mastered: state.reviewCards.filter((card) => card.mastered).length,
      dueToday: reviewCardsDue().length
    }
  }, null, 2);
}

export function resetDemo() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}
