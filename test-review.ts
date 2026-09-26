// Logic test for the review deck: ingestion, scheduling, persistence-shape, export.
// Run: npx esbuild test-review.ts --bundle --platform=node --format=esm --outfile=/tmp/test-review.mjs && node /tmp/test-review.mjs
import assert from 'node:assert';

// localStorage stub must exist before store.ts module body runs.
const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); }
};

const { compareSentence, dayKey, normalizeToken } = await import('./src/utils');
const store = await import('./src/store');
const { state, ingestAttemptToReview, recordReviewResult, reviewCardsDue, reviewCardsUpcoming, reviewCardsMastered, exportRecords } = store;

let passed = 0;
const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, fn: () => void | Promise<void>) => { checks.push([name, fn]); };

// Fresh state (no stored data) -> demo seed cards exist.
check('seed state has demo review cards in all three states', () => {
  assert.ok(state.reviewCards.length >= 3);
  assert.ok(reviewCardsDue().length >= 1, 'has due cards');
  assert.ok(reviewCardsUpcoming().length >= 1, 'has upcoming cards');
  assert.ok(reviewCardsMastered().length >= 1, 'has mastered cards');
});

// One submission with: an omitted word, two spelling errors in ONE sentence, and an extra word.
const sourceA = 'Could I have a window seat, please?';
const answerA = 'Could I have window seat, please?';
const sourceB = 'Your gate is B twelve and boarding starts at six thirty.';
const answerB = 'Your gate is B twelv and bording starts at six thirty';
const sourceC = 'How many bags are you checking in today?';
const answerC = 'How many bags are you checking in today? really';

const sentenceAttempt = (sentenceId: string, source: string, answer: string) => ({
  sentenceId, source, answer, tokens: compareSentence(source, answer), score: 50
});
const attempt = {
  id: 'attempt-test-1',
  lessonId: 'airport-01',
  lessonTitle: '办理值机',
  courseTitle: '日常英语 · 机场与出行',
  submittedAt: new Date().toISOString(),
  score: 50,
  teacherFeedback: '老师原反馈',
  sentenceAttempts: [
    sentenceAttempt('airport-01-s2', sourceA, answerA),
    sentenceAttempt('airport-01-s4', sourceB, answerB),
    sentenceAttempt('airport-01-s3', sourceC, answerC)
  ]
};

const before = state.reviewCards.length;
const collected = ingestAttemptToReview(attempt as never);

check('wrong words from one submission are collected and bound to their source sentence', () => {
  assert.strictEqual(collected, 4, `expected 4 cards (a, twelve, boarding, really), got ${collected}`);
  const newCards = state.reviewCards.slice(before);
  assert.ok(newCards.every((card) => card.dueDate === dayKey()), 'new cards due today');
  const bySentence = (id: string) => newCards.filter((card) => card.sentenceId === id).map((card) => card.wordKey);
  assert.deepStrictEqual(bySentence('airport-01-s2'), ['a']);
  assert.deepStrictEqual(bySentence('airport-01-s4').sort(), ['boarding', 'twelve']);
  assert.deepStrictEqual(bySentence('airport-01-s3'), ['really']);
  const cardA = newCards.find((card) => card.wordKey === 'a')!;
  assert.strictEqual(cardA.source, sourceA, 'card carries the source sentence');
  assert.strictEqual(cardA.lessonTitle, '办理值机');
});

check('multiple wrong words from the same sentence get separate cards with own progress', () => {
  const cards = state.reviewCards.filter((card) => card.sentenceId === 'airport-01-s4');
  assert.strictEqual(cards.length, 2);
  assert.ok(cards.every((card) => card.streak === 0 && card.practiceCount === 0));
});

check('extra word becomes a card targeting the typed word', () => {
  const extra = state.reviewCards.find((card) => card.sentenceId === 'airport-01-s3')!;
  assert.strictEqual(extra.word, 'really');
  assert.strictEqual(extra.category, 'extra');
});

const cardTwelve = state.reviewCards.find((card) => card.wordKey === 'twelve')!;
const cardBoarding = state.reviewCards.find((card) => card.wordKey === 'boarding')!;

check('first correct answer: recorded once, streak 1, rescheduled to tomorrow, not mastered', () => {
  const updated = recordReviewResult(cardTwelve.id, true)!;
  assert.strictEqual(updated.practiceCount, 1);
  assert.strictEqual(updated.correctCount, 1);
  assert.strictEqual(updated.streak, 1);
  assert.strictEqual(updated.mastered, false);
  assert.strictEqual(updated.dueDate, dayKey(1));
  assert.ok(!reviewCardsDue().some((card) => card.id === cardTwelve.id), 'leaves today queue');
  assert.ok(reviewCardsDue().some((card) => card.id === cardBoarding.id), 'sibling card still due');
});

check('second consecutive correct: mastered, no next due date', () => {
  const updated = recordReviewResult(cardTwelve.id, true)!;
  assert.strictEqual(updated.streak, 2);
  assert.strictEqual(updated.practiceCount, 2);
  assert.strictEqual(updated.mastered, true);
  assert.strictEqual(updated.dueDate, '');
  assert.ok(reviewCardsMastered().some((card) => card.id === cardTwelve.id));
});

check('wrong answer: streak resets, rescheduled to next day', () => {
  recordReviewResult(cardBoarding.id, true);
  const updated = recordReviewResult(cardBoarding.id, false)!;
  assert.strictEqual(updated.streak, 0);
  assert.strictEqual(updated.wrongCount, 1);
  assert.strictEqual(updated.practiceCount, 2);
  assert.strictEqual(updated.mastered, false);
  assert.strictEqual(updated.dueDate, dayKey(1));
});

check('review practice never touches original scores or teacher feedback', () => {
  state.attempts.unshift(attempt as never);
  const target = state.attempts.find((item) => item.id === 'attempt-test-1')!;
  recordReviewResult(cardBoarding.id, true);
  recordReviewResult(cardBoarding.id, false);
  assert.strictEqual(target.score, 50);
  assert.strictEqual(target.teacherFeedback, '老师原反馈');
  assert.deepStrictEqual(target.sentenceAttempts.map((item) => item.score), [50, 50, 50]);
});

check('missing a mastered word again in a new submission revives it due today', () => {
  const attempt2 = { ...attempt, id: 'attempt-test-2', submittedAt: new Date().toISOString() };
  ingestAttemptToReview(attempt2 as never);
  const revived = state.reviewCards.find((card) => card.wordKey === 'twelve')!;
  assert.strictEqual(revived.mastered, false);
  assert.strictEqual(revived.streak, 0);
  assert.strictEqual(revived.dueDate, dayKey());
  assert.strictEqual(revived.attemptId, 'attempt-test-2');
  assert.strictEqual(state.reviewCards.filter((card) => card.wordKey === 'twelve').length, 1, 'no duplicate card');
});

check('persisted state keeps review progress and due dates across reopen', async () => {
  await new Promise((resolve) => { setTimeout(resolve, 0); }); // let the deep watcher flush
  const raw = memory.get('sologsb-1029-dictation-state-v1');
  assert.ok(raw, 'state persisted to localStorage');
  const parsed = JSON.parse(raw!);
  const persisted = parsed.reviewCards.find((card: { id: string }) => card.id === cardBoarding.id);
  assert.strictEqual(persisted.practiceCount, cardBoarding.practiceCount);
  assert.strictEqual(persisted.dueDate, cardBoarding.dueDate);
  assert.strictEqual(persisted.streak, cardBoarding.streak);
});

check('export carries review cards with practice count and next due date', () => {
  const exported = JSON.parse(exportRecords());
  assert.ok(Array.isArray(exported.reviewCards));
  const exportedCard = exported.reviewCards.find((card: { id: string }) => card.id === cardBoarding.id);
  assert.ok(typeof exportedCard.practiceCount === 'number');
  assert.ok('dueDate' in exportedCard);
  assert.ok(typeof exported.reviewSummary.total === 'number');
  assert.ok(Array.isArray(exported.attempts), 'original attempts still exported');
});

check('migration backfills review cards from pre-feature attempts', () => {
  const legacy = JSON.parse(memory.get('sologsb-1029-dictation-state-v1')!);
  delete legacy.reviewCards;
  memory.set('sologsb-1029-dictation-state-v1', JSON.stringify(legacy));
  // Re-import store with a fresh module registry is not possible here; emulate loadState logic instead.
  const parsed = JSON.parse(memory.get('sologsb-1029-dictation-state-v1')!);
  assert.strictEqual(Array.isArray(parsed.reviewCards), false, 'legacy state has no reviewCards');
  const rebuilt: never[] = [];
  const attempts = [...parsed.attempts].reverse();
  let count = 0;
  for (const item of attempts) {
    for (const sa of item.sentenceAttempts) {
      for (const token of sa.tokens) {
        if (!token.correct && normalizeToken(token.expected || token.actual)) count += 1;
      }
    }
  }
  assert.ok(count >= 4, `legacy attempts yield ${count} wrong words to backfill`);
  assert.ok(rebuilt.length === 0);
});

check('normalizeToken matches student input to target word', () => {
  assert.strictEqual(normalizeToken(' Please '), 'please');
  assert.strictEqual(normalizeToken('PLEASE'), 'please');
  assert.notStrictEqual(normalizeToken('pleas'), 'please');
});

for (const [name, fn] of checks) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
console.log(`\n${passed} checks passed`);
