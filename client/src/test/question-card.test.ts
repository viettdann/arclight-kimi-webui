import type { QuestionItemDTO } from 'shared/types';
import { describe, expect, it } from 'vitest';
import { buildWireAnswers } from '@/components/blocks/question-card';

// The SDK's AskUserQuestion tool resolves answers by QUESTION TEXT
// (`answers[question.question]`). Index-style keys (`q_0`) silently read as
// "The user did not answer the questions." — these tests pin the mapping.
describe('buildWireAnswers', () => {
  const questions: QuestionItemDTO[] = [
    { question: 'Which diff mode?', header: 'Git', options: [{ label: 'read-only' }] },
    { question: 'Open agent file?', header: 'Agent', options: [{ label: 'editor' }] },
  ];

  it('keys answers by question text, not by index', () => {
    const wire = buildWireAnswers(questions, { q_0: 'read-only', q_1: 'editor' });
    expect(wire).toEqual({
      'Which diff mode?': 'read-only',
      'Open agent file?': 'editor',
    });
  });

  it('drops unanswered and whitespace-only entries', () => {
    const wire = buildWireAnswers(questions, { q_0: '  ', q_1: 'editor' });
    expect(wire).toEqual({ 'Open agent file?': 'editor' });
  });

  it('returns an empty record when nothing was answered', () => {
    expect(buildWireAnswers(questions, {})).toEqual({});
  });

  it('keeps multi-select comma-joined values verbatim', () => {
    const wire = buildWireAnswers(questions, { q_0: 'read-only, editor' });
    expect(wire).toEqual({ 'Which diff mode?': 'read-only, editor' });
  });
});
