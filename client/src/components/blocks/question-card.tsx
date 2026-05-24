import { ArrowRight, Check, HelpCircle } from 'lucide-react';
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
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSelectOption = (questionIdx: number, optionLabel: string, multiSelect = false) => {
    if (isSubmitted) return;

    const qKey = `q_${questionIdx}`;
    const current = answers[qKey] || '';

    if (multiSelect) {
      const selected = current ? current.split(', ') : [];
      if (selected.includes(optionLabel)) {
        const next = selected.filter((o) => o !== optionLabel).join(', ');
        setAnswers({ ...answers, [qKey]: next });
      } else {
        const next = [...selected, optionLabel].join(', ');
        setAnswers({ ...answers, [qKey]: next });
      }
    } else {
      setAnswers({ ...answers, [qKey]: optionLabel });
    }
  };

  const handleTextChange = (questionIdx: number, text: string) => {
    if (isSubmitted) return;
    setAnswers({ ...answers, [`q_${questionIdx}`]: text });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || isSubmitted) return;

    // Check if at least one question is answered
    if (Object.keys(answers).length === 0) return;

    // Send via WS
    sendWS('answer_question', { requestId, answers }, sessionId);
    setIsSubmitted(true);
  };

  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden backdrop-blur-sm animate-in fade-in duration-200 ${
        isSubmitted ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-primary/20 bg-primary/5'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold select-none border-b border-border/20">
        <HelpCircle
          className={`h-4.5 w-4.5 ${isSubmitted ? 'text-emerald-500' : 'text-primary'}`}
        />
        <span className={isSubmitted ? 'text-emerald-500' : 'text-primary'}>
          {isSubmitted ? 'Response Submitted' : 'Question from Assistant'}
        </span>
      </div>

      {/* Body / Form */}
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {questions.map((q, qIdx) => {
          const qKey = `q_${qIdx}`;
          const currentAnswer = answers[qKey] || '';
          const hasOptions = q.options && q.options.length > 0;

          return (
            <div key={qIdx} className="space-y-2.5">
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
                        onClick={() => handleSelectOption(qIdx, opt.label, q.multiSelect)}
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
                /* Text write-in fallback if no options defined */
                <textarea
                  disabled={isSubmitted}
                  value={currentAnswer}
                  onChange={(e) => handleTextChange(qIdx, e.target.value)}
                  placeholder="Type your response..."
                  className="w-full text-xs font-medium border border-border/80 bg-background/60 p-3 rounded-xl min-h-16 outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary resize-none placeholder:text-muted-foreground/60 leading-relaxed"
                />
              )}
            </div>
          );
        })}

        {/* Action Button */}
        <div className="pt-2 border-t border-border/20 flex justify-end">
          {!isSubmitted ? (
            <Button
              type="submit"
              disabled={Object.keys(answers).length === 0}
              className="flex items-center gap-1.5"
            >
              <span>Submit Answer</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-bold select-none font-sans">
              <Check className="h-4 w-4 stroke-[3]" />
              <span>Answers Recorded</span>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
