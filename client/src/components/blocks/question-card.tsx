import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  HelpCircle,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
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

const hasOptions = (q: QuestionItemDTO) => !!q.options && q.options.length > 0;

/** Shared card chrome: icon + title on the left, status slot on the right. */
function CardHeader({
  tone,
  title,
  right,
  icon,
}: {
  tone: 'success' | 'primary' | 'muted';
  title: string;
  right?: ReactNode;
  icon?: ReactNode;
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'muted'
        ? 'text-muted-foreground'
        : 'text-primary';
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 select-none border-b border-border/20 shrink-0">
      <div className={`flex items-center gap-2 text-xs font-semibold ${toneClass}`}>
        {icon ?? <HelpCircle className="h-4.5 w-4.5" />}
        <span>{title}</span>
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
  // Per-question structured state, keyed by question index.
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [otherOn, setOtherOn] = useState<Record<number, boolean>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [noteOpen, setNoteOpen] = useState<Record<number, boolean>>({});
  // Step 0..total-1 = questions; step === total = the review/summary screen.
  const [step, setStep] = useState(0);
  // Set by the local `answer_question` echo on submit, or by the matching
  // tool_result — the store flips it synchronously, so no local mirror needed.
  const isSubmitted = !!resolved;

  const total = questions.length;
  if (total === 0) return null;

  /** Effective wire answer string for question `i` (option picks + Other text). */
  const effectiveAnswer = (i: number): string => {
    const q = questions[i];
    if (!q) return '';
    if (!hasOptions(q)) return (otherText[i] || '').trim();
    const parts = [...(picks[i] || [])];
    const custom = (otherText[i] || '').trim();
    if (otherOn[i] && custom) parts.push(custom);
    return parts.join(', ');
  };

  const answeredCount = questions.reduce((acc, _, i) => acc + (effectiveAnswer(i) ? 1 : 0), 0);

  // ── Submitted / dismissed (terminal) views ────────────────────────────────
  if (isSubmitted) {
    const submitted = storeAnswers ?? {};
    const dismissed =
      Object.keys(submitted).length === 0 ||
      Object.values(submitted).every((v) => !(v || '').trim());

    if (dismissed) {
      return (
        <div className="rounded-xl border border-border/50 bg-muted/20 shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200">
          <CardHeader
            tone="muted"
            title="Question Dismissed"
            icon={<X className="h-4.5 w-4.5" />}
          />
          <p className="px-4 py-3 text-xs text-muted-foreground leading-relaxed">
            You dismissed this question — the assistant continues without an answer.
          </p>
        </div>
      );
    }

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

  // ── Inline anchor while pending: passive echo; the decision UI lives in the
  // bottom dock (PendingApprovalDock), same pattern as tool approvals. ────────
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

  // ── Interactive dock flow ─────────────────────────────────────────────────
  const isSummary = step >= total;
  const idx = Math.min(step, total - 1);
  const q = questions[idx];
  if (!q) return null;

  const selectOption = (i: number, label: string) => {
    if (isSubmitted) return;
    if (questions[i]?.multiSelect) {
      setPicks((p) => {
        const cur = p[i] || [];
        return {
          ...p,
          [i]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label],
        };
      });
    } else {
      setPicks((p) => ({ ...p, [i]: [label] }));
      setOtherOn((o) => ({ ...o, [i]: false }));
      // single-select auto-advances (to the next question or the review screen)
      setTimeout(() => setStep((s) => Math.min(s + 1, total)), 120);
    }
  };

  const toggleOther = (i: number) => {
    if (isSubmitted) return;
    if (questions[i]?.multiSelect) {
      setOtherOn((o) => ({ ...o, [i]: !o[i] }));
    } else {
      // single-select: Other is mutually exclusive with the listed options
      setOtherOn((o) => ({ ...o, [i]: true }));
      setPicks((p) => ({ ...p, [i]: [] }));
    }
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const goNext = () => setStep((s) => Math.min(total, s + 1));

  const submit = () => {
    if (!sessionId || isSubmitted) return;
    const indexed: Record<string, string> = {};
    questions.forEach((_, i) => {
      indexed[localKey(i)] = effectiveAnswer(i);
    });
    const wireAnswers = buildWireAnswers(questions, indexed);
    // Empty answers would deny the tool server-side — that path is Dismiss, not Submit.
    if (Object.keys(wireAnswers).length === 0) return;
    const annotations: Record<string, { notes?: string }> = {};
    questions.forEach((qi, i) => {
      const n = (notes[i] || '').trim();
      if (n) annotations[qi.question] = { notes: n };
    });
    const hasNotes = Object.keys(annotations).length > 0;
    // Local echo first (marks the block resolved + records the answers) so the
    // dock advances and the inline anchor flips to the summary immediately.
    useChatStore.getState().applyEvent(sessionId, 'answer_question', {
      requestId,
      answers: wireAnswers,
    });
    sendWS(
      'answer_question',
      { requestId, answers: wireAnswers, ...(hasNotes ? { annotations } : {}) },
      sessionId,
    );
  };

  // Empty answers ⇒ the server denies the AskUserQuestion tool ('aborted'), so
  // the turn settles without forcing an answer.
  const dismiss = () => {
    if (!sessionId || isSubmitted) return;
    useChatStore.getState().applyEvent(sessionId, 'answer_question', { requestId, answers: {} });
    sendWS('answer_question', { requestId, answers: {} }, sessionId);
  };

  return (
    <div
      className={`rounded-xl border border-primary/20 bg-primary/5 shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200 ${
        variant === 'dock' ? 'flex flex-col max-h-[80dvh]' : ''
      }`}
    >
      <CardHeader
        tone="primary"
        title={isSummary ? 'Review & Submit' : 'Question from Assistant'}
        icon={isSummary ? <ClipboardCheck className="h-4.5 w-4.5" /> : undefined}
        right={
          isSummary ? (
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Review
            </span>
          ) : total > 1 ? (
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {idx + 1} / {total}
            </span>
          ) : undefined
        }
      />

      {/* Progress dots + review node */}
      {total > 1 && (
        <div className="flex items-center gap-1.5 px-4 pt-3 shrink-0">
          {questions.map((_, i) => {
            const hasAns = !!effectiveAnswer(i);
            const isActive = !isSummary && i === idx;
            return (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: answers keyed by question index
                key={i}
                type="button"
                onClick={() => setStep(i)}
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
          <button
            type="button"
            onClick={() => setStep(total)}
            aria-label="Review answers"
            className="ml-1 shrink-0"
          >
            <ClipboardCheck
              className={`h-3.5 w-3.5 transition-colors ${
                isSummary ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground'
              }`}
            />
          </button>
        </div>
      )}

      <div
        className={`p-4 space-y-3 ${variant === 'dock' ? 'flex-1 overflow-y-auto min-h-0' : ''}`}
      >
        {isSummary ? (
          // ── Review screen: answers + optional per-question notes ───────────
          <div className="space-y-2 max-h-[50vh] overflow-y-auto -mx-1 px-1">
            {questions.map((qi, i) => {
              const ans = effectiveAnswer(i);
              const showNote = !!noteOpen[i] || !!(notes[i] || '').trim();
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional question list
                  key={i}
                  className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {qi.header && (
                        <span className="block text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                          {qi.header}
                        </span>
                      )}
                      <span className="text-xs font-semibold text-foreground/85">
                        {qi.question}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setStep(i)}
                      className="shrink-0 h-7 px-2 text-[11px] gap-1"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </Button>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground/60 mr-1.5">→</span>
                    {ans ? (
                      <span className="font-medium text-primary">{ans}</span>
                    ) : (
                      <em className="text-muted-foreground/70">no answer</em>
                    )}
                  </div>
                  {showNote ? (
                    <textarea
                      value={notes[i] || ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [i]: e.target.value }))}
                      placeholder="Additional instructions for this answer (optional)…"
                      className="w-full text-xs font-medium border border-border/80 bg-background/60 p-2.5 rounded-lg min-h-14 outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary resize-none placeholder:text-muted-foreground/60 leading-relaxed"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setNoteOpen((o) => ({ ...o, [i]: true }))}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Add note
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          // ── Question screen ────────────────────────────────────────────────
          <>
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

            {hasOptions(q) ? (
              <div className="grid gap-2">
                {q.options.map((opt) => {
                  const isSelected = (picks[idx] || []).includes(opt.label);
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
                        onClick={() => selectOption(idx, opt.label)}
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
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {opt.preview ?? ''}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Other — free-text fallback the SDK always offers. */}
                <div
                  className={`rounded-xl border transition-all overflow-hidden ${
                    otherOn[idx]
                      ? 'border-primary bg-primary/10'
                      : 'border-border/80 bg-background/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleOther(idx)}
                    className={`flex w-full flex-col items-start text-left p-3 transition-all text-xs font-medium cursor-pointer ${
                      otherOn[idx] ? 'text-primary' : 'hover:bg-muted/30 text-foreground/80'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <div
                        className={`h-4 w-4 shrink-0 rounded-md border flex items-center justify-center ${
                          otherOn[idx]
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30 bg-background'
                        }`}
                      >
                        {otherOn[idx] && <Check className="h-3 w-3 stroke-[3]" />}
                      </div>
                      <span>Other…</span>
                    </div>
                    <span className="mt-1 text-[10px] text-muted-foreground pl-6">
                      Provide a custom answer
                    </span>
                  </button>
                  {otherOn[idx] && (
                    <div className="border-t border-border/30 px-3 py-2.5">
                      <textarea
                        value={otherText[idx] || ''}
                        onChange={(e) => setOtherText((t) => ({ ...t, [idx]: e.target.value }))}
                        placeholder="Type your answer…"
                        className="w-full text-xs font-medium border border-border/80 bg-background/60 p-2.5 rounded-lg min-h-14 outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary resize-none placeholder:text-muted-foreground/60 leading-relaxed"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <textarea
                value={otherText[idx] || ''}
                onChange={(e) => setOtherText((t) => ({ ...t, [idx]: e.target.value }))}
                placeholder="Type your response..."
                className="w-full text-xs font-medium border border-border/80 bg-background/60 p-3 rounded-xl min-h-16 outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary resize-none placeholder:text-muted-foreground/60 leading-relaxed"
              />
            )}
          </>
        )}
      </div>

      {/* Footer / Nav */}
      <div className="px-4 py-3 border-t border-border/20 flex items-center justify-between gap-2 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={dismiss}
          className="flex items-center gap-1.5 text-destructive hover:bg-destructive-wash hover:text-destructive"
        >
          <X className="h-4 w-4" />
          <span>Dismiss</span>
        </Button>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={goBack}
            disabled={step === 0}
            className="flex items-center gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </Button>

          {isSummary ? (
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
              <span>{idx === total - 1 ? 'Review' : 'Next'}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
