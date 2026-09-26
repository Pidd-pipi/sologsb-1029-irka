import { reactive, watch } from 'vue';
import { createInitialState } from './data';
import type { Lesson, PersistedState, PracticeAttempt, ReviewItem, TokenResult } from './types';
import { addDaysKey, localDateKey, normalizeToken, segmentText } from './utils';

const STORAGE_KEY = 'sologsb-1029-dictation-state-v1';

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.schemaVersion === 1) {
        // 兼容复习台上线前保存的状态：仅补齐字段，不改动原成绩与反馈。
        if (!Array.isArray(parsed.reviewItems)) parsed.reviewItems = [];
        if (!Array.isArray(parsed.collectedReviewKeys)) parsed.collectedReviewKeys = [];
        return parsed;
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

/**
 * 提交后把错词收进复习台。
 * 同一句的多个错词按 token 各自生成一条进度；标点类与"多词"（无目标词）跳过。
 * 同一作答内同一位置去重，重复提交整节课会生成各自独立的新条目。
 */
export function collectReviewItems(attempt: PracticeAttempt): ReviewItem[] {
  const today = localDateKey();
  const added: ReviewItem[] = [];
  for (const sentence of attempt.sentenceAttempts) {
    const sourceTokens = segmentText(sentence.source);
    for (const token of sentence.tokens) {
      if (token.correct || token.category === 'extra') continue;
      // token.index 在插入/替换对齐后可能偏移，用目标词在原句中重新定位。
      const targetIndex = locateTokenIndex(sourceTokens, token);
      if (targetIndex < 0) continue; // 纯标点或找不到实词目标，不收入
      const dedupeKey = `${attempt.id}:${sentence.sentenceId}:${targetIndex}`;
      if (state.collectedReviewKeys.includes(dedupeKey)) continue;
      state.collectedReviewKeys.push(dedupeKey);
      const item: ReviewItem = {
        id: `review-${attempt.id}-${sentence.sentenceId}-${targetIndex}-${state.reviewItems.length + added.length}`,
        attemptId: attempt.id,
        lessonId: attempt.lessonId,
        lessonTitle: attempt.lessonTitle,
        courseTitle: attempt.courseTitle,
        sentenceId: sentence.sentenceId,
        source: sentence.source,
        target: sourceTokens[targetIndex].display,
        targetIndex,
        studentAnswer: token.actual,
        category: token.category,
        createdAt: attempt.submittedAt,
        dueAt: today, // 新错词当天即到期
        mastered: false,
        streak: 0,
        practiceCount: 0,
        correctCount: 0,
        lastPracticedAt: '',
        masteredAt: '',
        logs: []
      };
      added.push(item);
    }
  }
  if (added.length) state.reviewItems.unshift(...added);
  return added;
}

function locateTokenIndex(sourceTokens: ReturnType<typeof segmentText>, token: TokenResult): number {
  if (token.expected && normalizeToken(token.expected)) {
    // 对齐后的 index 通常就是原句位置；偏移时按目标词就近匹配。
    const expected = normalizeToken(token.expected);
    if (sourceTokens[token.index]?.normalized === expected) return token.index;
    const nearby = [token.index - 1, token.index + 1, token.index + 2].filter((i) => i >= 0);
    for (const i of nearby) {
      if (sourceTokens[i]?.normalized === expected) return i;
    }
    return sourceTokens.findIndex((item) => item.normalized === expected);
  }
  return -1;
}

/** 记录一次复习判定：答对累加连击（连续两次掌握），答错清零并顺延到第二天。 */
export function recordReviewResult(item: ReviewItem, correct: boolean, at: string = new Date().toISOString()): void {
  item.lastPracticedAt = at;
  item.practiceCount += 1;
  item.logs.push({ at, correct });
  if (correct) {
    item.correctCount += 1;
    item.streak += 1;
    if (item.streak >= 2) {
      item.mastered = true;
      item.masteredAt = at;
    }
    // 只答对一次时仍保持当天到期，会话中再次出现以完成第二次确认。
  } else {
    item.streak = 0;
    item.mastered = false;
    item.masteredAt = '';
    item.dueAt = addDaysKey(localDateKey(), 1);
  }
}

export function reviewWordMatches(item: ReviewItem, answer: string): boolean {
  return normalizeToken(answer) === normalizeToken(item.target);
}

export function exportRecords(): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    attempts: state.attempts,
    progress: state.progress,
    reviewItems: state.reviewItems.map((item) => ({
      ...item,
      // 显式带出练习次数与下次日期，方便外部学习分析直接读取
      practiceCount: item.practiceCount,
      nextDueAt: item.mastered ? null : item.dueAt
    }))
  }, null, 2);
}

export function resetDemo() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}
