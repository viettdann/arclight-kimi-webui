import { ArrowLeft, ArrowRight, Check, HelpCircle } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import type { QuestionItemDTO } from 'shared/types';
import { Button } from '@/components/ui/button';
import { sendWS } from '../../lib/ws-send';

interface QuestionCardProps {
  requestId: string;
  questions: QuestionItemDTO[];
}

export function QuestionCard({ requestId, questions }: QuestionCardProps) {
  const { id: sessionId } = useParams<{ id: string }>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const total = questions.length;
  const safeIdx = Math.min(activeIdx, total - 1);
  const q = questions[safeIdx];
  if (!q) return null;
  const qKey = `q_${safeIdx}`;
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
    if (Object.keys(answers).length === 0) return;
    sendWS('answer_question', { requestId, answers }, sessionId);
    setIsSubmitted(true);
  };

  const answeredCount = questions.reduce(
    (acc, _, i) => acc + ((answers[`q_${i}`] || '').trim() ? 1 : 0),
    0,
  );

  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200 ${
        isSubmitted ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-primary/20 bg-primary/5'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 select-none border-b border-border/20">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <HelpCircle
            className={`h-4.5 w-4.5 ${isSubmitted ? 'text-emerald-500' : 'text-primary'}`}
          />
          <span className={isSubmitted ? 'text-emerald-500' : 'text-primary'}>
            {isSubmitted ? 'Response Submitted' : 'Question from Assistant'}
          </span>
        </div>
        {!isSubmitted && total > 1 && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {safeIdx + 1} / {total}
          </span>
        )}
      </div>

      {/* Progress dots */}
      {!isSubmitted && total > 1 && (
        <div className="flex items-center gap-1.5 px-4 pt-3">
          {questions.map((_, i) => {
            const hasAns = !!(answers[`q_${i}`] || '').trim();
            const isActive = i === safeIdx;
            return (
              <button
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
            {q.options.map((opt, optIdx) => {
              const isSelected = q.multiSelect
                ? currentAnswer.split(', ').includes(opt.label)
                : currentAnswer === opt.label;

              return (
                <button
                  type="button"
                  key={optIdx}
                  disabled={isSubmitted}
                  onClick={() => handleSelectOption(opt.label)}
                  className={`flex flex-col items-start text-left p-3 rounded-xl border transition-all text-xs font-medium cursor-pointer ${
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/80 bg-background/50 hover:bg-muted/30 text-foreground/80'
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
              );
            })}
          </div>
        ) : (
          <textarea
            disabled={isSubmitted}
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
            disabled={isSubmitted || safeIdx === 0}
            className="flex items-center gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </Button>

          {isSubmitted ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-bold select-none font-sans">
              <Check className="h-4 w-4 stroke-[3]" />
              <span>Answers Recorded</span>
            </div>
          ) : isLast ? (
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
