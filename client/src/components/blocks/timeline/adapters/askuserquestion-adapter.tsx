import { HelpCircle } from 'lucide-react';
import type { Adapter, RailRowShape } from '../types';
import { parseArgs, statusOf } from '../types';

interface ParsedOption {
  label: string;
  description: string;
}
interface ParsedQuestion {
  question: string;
  header: string;
  options: ParsedOption[];
  multiSelect: boolean;
}

function parseQuestions(raw: unknown): ParsedQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedQuestion[] = [];
  for (const q of raw) {
    if (typeof q !== 'object' || q === null) continue;
    const obj = q as Record<string, unknown>;
    const options = Array.isArray(obj.options)
      ? obj.options
          .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
          .map((o) => ({
            label: typeof o.label === 'string' ? o.label : '',
            description: typeof o.description === 'string' ? o.description : '',
          }))
      : [];
    out.push({
      question: typeof obj.question === 'string' ? obj.question : '',
      header: typeof obj.header === 'string' ? obj.header : '',
      options,
      multiSelect: obj.multiSelect === true,
    });
  }
  return out;
}

/**
 * Claude `AskUserQuestion` — `questions[{ question, header, options[{ label,
 * description }], multiSelect }]`. The interactive answer UI lives in the
 * `question_request` block (QuestionCard); this rail row is a compact,
 * read-only echo of what was asked.
 */
export const AskUserQuestionAdapter: Adapter = (ctx): RailRowShape => {
  const args = parseArgs(ctx.call);
  const questions = parseQuestions(args?.questions);
  const first = questions[0];
  const detail =
    questions.length > 0 ? (
      <div className="space-y-2">
        {questions.map((q, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional question list
          <div key={i} className="space-y-1">
            {q.header && (
              <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/70">
                {q.header}
              </div>
            )}
            <div className="text-xs font-medium text-foreground/85">{q.question}</div>
            {q.options.length > 0 && (
              <ul className="space-y-0.5 pl-1">
                {q.options.map((o) => (
                  <li key={o.label} className="text-[11px] text-muted-foreground/85">
                    <span className="text-muted-foreground/55">•</span> {o.label}
                    {o.description && (
                      <span className="text-muted-foreground/55"> — {o.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    ) : undefined;

  return {
    icon: <HelpCircle className="h-3.5 w-3.5" />,
    verb: 'Asked',
    inline: first?.question ? (
      <span className="text-muted-foreground/75">{first.question}</span>
    ) : undefined,
    detail,
    status: statusOf(ctx),
  };
};
