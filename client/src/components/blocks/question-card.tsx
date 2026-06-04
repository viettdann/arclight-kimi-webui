import { ArrowLeft, ArrowRight, Check, HelpCircle } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams } from 'react-router';
import remarkGfm from 'remark-gfm';
import type { QuestionItemDTO } from 'shared/types';
import { Button } from '@/components/ui/button';
import { useChatStore } from '../../lib/chat-store';
import { sendWS } from '../../lib/ws-send';
import { markdownComponents } from './markdown';

interface QuestionCardProps {
  requestId: string;
  questions: QuestionItemDTO[];
  /** True when the matching tool_result has been seen — question already answered. */
  resolved?: boolean;
  /** Submitted answers keyed by question text, echoed into the block on submit. */
  answers?: Record<string, string>;
  /**
   * `dock` hosts the interactive answer flow (pinned above the chat input,
   * mirroring tool approvals); `inline` is the transcript anchor — passive
   * while pending, answer summary once resolved.
   */
  variant?: 'inline' | 'dock';
}

/** Positional key for local (per-instance) answer state — wire keys are question text. */
const localKey = (i: number) => `q_${i}`;

/**
 * Map index-keyed local UI state (`q_<idx>`) to the wire/SDK contract:
 * answers keyed by QUESTION TEXT. The SDK's AskUserQuestion tool resolves
 * `answers[question.question]` — any other key reads as "did not answer".
 * Empty/whitespace-only answers are dropped.
 */
export function buildWireAnswers(
  questions: QuestionItemDTO[],
  indexed: Record<string, string>,
): Record<string, string> {
  const wire: Record<string, string> = {};
  questions.forEach((q, i) => {
    const val = (indexed[localKey(i)] || '').trim();
    if (val) wire[q.question] = val;
  });
  return wire;
}

/** Shared card chrome: HelpCircle + title on the left, status slot on the right. */
function CardHeader({
  tone,
  title,
  right,
}: {
  tone: 'success' | 'primary';
  title: string;
  right?: ReactNode;
}) {
  const toneClass = tone === 'success' ? 'text-success' : 'text-primary';
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 select-none border-b border-border/20">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <HelpCircle className={`h-4.5 w-4.5 ${toneClass}`} />
        <span className={toneClass}>{title}</span>
      </div>
      {right}
    </div>
  );
}

export function QuestionCard({
  requestId,
  questions,
  resolved,
  answers: storeAnswers,
  variant = 'inline',
}: QuestionCardProps) {
  const { id: sessionId } = useParams<{ id: string }>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  // Set by the local `answer_question` echo on submit, or by the matching
  // tool_result — the store flips it synchronously, so no local mirror needed.
  const isSubmitted = !!resolved;

  const total = questions.length;
  const safeIdx = Math.min(activeIdx, total - 1);
  const q = questions[safeIdx];
  if (!q) return null;
  const qKey = localKey(safeIdx);
  const currentAnswer = answers[qKey] || '';
  const hasOptions = q.options && q.options.length > 0;
  const isLast = safeIdx === total - 1;

  const updateAnswer = (next: string) => {
    setAnswers((prev) => ({ ...prev, [qKey]: next }));
  };

  const handleSelectOption = (optionLabel: string) => {
    if (isSubmitted) return;
    if (q.multiSelect) {
      const selected = currentAnswer ? currentAnswer.split(', ').filter(Boolean) : [];
      const next = selected.includes(optionLabel)
        ? selected.filter((o) => o !== optionLabel)
        : [...selected, optionLabel];
      updateAnswer(next.join(', '));
    } else {
      updateAnswer(optionLabel);
      // single-select auto-advances on next tick for nicer flow
      if (!isLast) {
        setTimeout(() => setActiveIdx((i) => Math.min(i + 1, total - 1)), 120);
      }
    }
  };

  const handleTextChange = (text: string) => {
    if (isSubmitted) return;
    updateAnswer(text);
  };

  const goBack = () => {
    if (isSubmitted) return;
    setActiveIdx((i) => Math.max(0, i - 1));
  };

  const goNext = () => {
    if (isSubmitted) return;
    setActiveIdx((i) => Math.min(total - 1, i + 1));
  };

  const submit = () => {
    if (!sessionId || isSubmitted) return;
    const wireAnswers = buildWireAnswers(questions, answers);
    if (Object.keys(wireAnswers).length === 0) return;
    // Local echo first (marks the block resolved + records the answers) so the
    // dock advances and the inline anchor flips to the summary immediately.
    useChatStore.getState().applyEvent(sessionId, 'answer_question', {
      requestId,
      answers: wireAnswers,
    });
    sendWS('answer_question', { requestId, answers: wireAnswers }, sessionId);
  };

  if (isSubmitted) {
    return (
      <div className="rounded-xl border border-success/30 bg-success-wash shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200">
        <CardHeader
          tone="success"
          title="Response Submitted"
          right={
            <div className="flex items-center gap-1.5 text-xs text-success font-bold select-none font-sans">
              <Check className="h-3.5 w-3.5 stroke-[3]" />
              <span>Answers Recorded</span>
            </div>
          }
        />
        <ul className="px-4 py-3 space-y-2">
          {questions.map((qi, i) => {
            // Question-text keyed store echo; absent (e.g. answered from
            // another tab) reads as "no answer".
            const ans = (storeAnswers?.[qi.question] ?? '').trim();
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional question list
              <li key={i} className="text-xs leading-relaxed">
                {qi.header && (
                  <span className="block text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                    {qi.header}
                  </span>
                )}
                <span className="font-semibold text-foreground/85">{qi.question}</span>
                <span className="mx-1.5 text-muted-foreground/60">→</span>
                <span className="font-medium text-success">
                  {ans || <em className="text-muted-foreground/70">no answer</em>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // Inline anchor while pending: passive echo of the questions. The decision
  // UI lives in the bottom dock (PendingApprovalDock) — same pattern as tool
  // approvals, so the prompt is visible without scrolling.
  if (variant === 'inline') {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200">
        <CardHeader
          tone="primary"
          title="Question from Assistant"
          right={
            <span className="text-[10px] font-mono uppercase tracking-wider text-primary/80 animate-pulse">
              Awaiting answer
            </span>
          }
        />
        <ul className="px-4 py-3 space-y-1.5">
          {questions.map((qi, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional question list
            <li key={i} className="text-xs leading-relaxed">
              {qi.header && (
                <span className="block text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                  {qi.header}
                </span>
              )}
              <span className="font-medium text-foreground/85">{qi.question}</span>
            </li>
          ))}
        </ul>
        <div className="px-4 pb-2.5 text-[11px] text-muted-foreground select-none">
          Answer in the panel above the chat input ↓
        </div>
      </div>
    );
  }

  const answeredCount = questions.reduce(
    (acc, _, i) => acc + ((answers[localKey(i)] || '').trim() ? 1 : 0),
    0,
  );

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200">
      <CardHeader
        tone="primary"
        title="Question from Assistant"
        right={
          total > 1 ? (
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {safeIdx + 1} / {total}
            </span>
          ) : undefined
        }
      />

      {/* Progress dots */}
      {total > 1 && (
        <div className="flex items-center gap-1.5 px-4 pt-3">
          {questions.map((_, i) => {
            const hasAns = !!(answers[localKey(i)] || '').trim();
            const isActive = i === safeIdx;
            return (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: answers keyed by question index
                key={i}
                type="button"
                onClick={() => setActiveIdx(i)}
                aria-label={`Go to question ${i + 1}`}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  isActive
                    ? 'bg-primary'
                    : hasAns
                      ? 'bg-primary/40'
                      : 'bg-muted-foreground/20 hover:bg-muted-foreground/40'
                }`}
              />
            );
          })}
        </div>
      )}

      {/* Body — single question at a time */}
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          {q.header && (
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
              {q.header}
            </span>
          )}
          <h4 className="text-sm font-semibold text-foreground leading-relaxed font-sans">
            {q.question}
          </h4>
        </div>

        {hasOptions ? (
          <div className="grid gap-2">
            {q.options.map((opt) => {
              const isSelected = q.multiSelect
                ? currentAnswer.split(', ').includes(opt.label)
                : currentAnswer === opt.label;

              const hasPreview = !!opt.preview?.trim();

              return (
                <div
                  key={opt.label}
                  className={`rounded-xl border transition-all overflow-hidden ${
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : 'border-border/80 bg-background/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectOption(opt.label)}
                    className={`flex w-full flex-col items-start text-left p-3 transition-all text-xs font-medium cursor-pointer ${
                      isSelected ? 'text-primary' : 'hover:bg-muted/30 text-foreground/80'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <div
                        className={`h-4 w-4 shrink-0 rounded-md border flex items-center justify-center ${
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30 bg-background'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                      </div>
                      <span>{opt.label}</span>
                    </div>
                    {opt.description && (
                      <span className="mt-1 text-[10px] text-muted-foreground pl-6">
                        {opt.description}
                      </span>
                    )}
                  </button>
                  {/* Per-option preview (markdown), rendered outside the button to
                      keep block-level markup out of an invalid button descendant. */}
                  {hasPreview && (
                    <div className="border-t border-border/30 px-3 py-2 pl-9 text-[10px] text-muted-foreground/85 [&_p]:my-1 [&_*]:text-[10px] select-text">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {opt.preview ?? ''}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <textarea
            value={currentAnswer}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Type your response..."
            className="w-full text-xs font-medium border border-border/80 bg-background/60 p-3 rounded-xl min-h-16 outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary resize-none placeholder:text-muted-foreground/60 leading-relaxed"
          />
        )}

        {/* Footer / Nav */}
        <div className="pt-2 border-t border-border/20 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={goBack}
            disabled={safeIdx === 0}
            className="flex items-center gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </Button>

          {isLast ? (
            <Button
              type="button"
              onClick={submit}
              disabled={answeredCount === 0}
              className="flex items-center gap-1.5"
            >
              <span>Submit Answer</span>
              <Check className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={goNext}
              variant="default"
              size="sm"
              className="flex items-center gap-1.5"
            >
              <span>Next</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
