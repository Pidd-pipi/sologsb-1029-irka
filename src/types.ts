export type ErrorCategory = 'unclassified' | 'spelling' | 'omitted' | 'extra' | 'punctuation' | 'grammar';
export type PracticeView = 'library' | 'practice' | 'result' | 'teacher' | 'review';
export type ThemeMode = 'light' | 'dark';

export interface Sentence {
  id: string;
  text: string;
  translation: string;
  note: string;
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  subtitle: string;
  level: string;
  estimatedMinutes: number;
  downloaded: boolean;
  sentences: Sentence[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  level: string;
  accent: string;
  lessons: Lesson[];
}

export interface TokenResult {
  index: number;
  expected: string;
  actual: string;
  correct: boolean;
  category: ErrorCategory;
  reason: string;
}

export interface SentenceAttempt {
  sentenceId: string;
  source: string;
  answer: string;
  tokens: TokenResult[];
  score: number;
}

export interface PracticeAttempt {
  id: string;
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
  submittedAt: string;
  score: number;
  sentenceAttempts: SentenceAttempt[];
  teacherFeedback: string;
}

export interface LessonProgress {
  answers: Record<string, string>;
  activeSentenceId: string;
  updatedAt: string;
}

export interface ReviewLog {
  at: string;
  correct: boolean;
}

export interface ReviewItem {
  id: string;
  attemptId: string;
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
  sentenceId: string;
  source: string;
  /** 待掌握的目标词（正确拼写）；多词类错误没有目标词，不收入复习台 */
  target: string;
  /** 目标词在来源句分词结果中的位置，用于定位与片段播放 */
  targetIndex: number;
  studentAnswer: string;
  category: ErrorCategory;
  createdAt: string;
  /** 本地日期 YYYY-MM-DD，达到该日期才可练习 */
  dueAt: string;
  mastered: boolean;
  /** 当前连续答对次数，答错清零，达到 2 即掌握 */
  streak: number;
  practiceCount: number;
  correctCount: number;
  lastPracticedAt: string;
  masteredAt: string;
  logs: ReviewLog[];
}

export interface PersistedState {
  schemaVersion: 1;
  courses: Course[];
  attempts: PracticeAttempt[];
  progress: Record<string, LessonProgress>;
  reviewItems: ReviewItem[];
  /** 已收入复习台的作答 token 键，防止重复收集 */
  collectedReviewKeys: string[];
  activeLessonId: string;
  activeSentenceId: string;
  theme: ThemeMode;
  fontScale: number;
  role: 'learner' | 'teacher';
}

export interface TextSegment {
  index: number;
  display: string;
  normalized: string;
}
