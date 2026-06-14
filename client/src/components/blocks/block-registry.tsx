import type { Block } from 'shared/types';
import { ApprovalCard } from './approval-card';
import { CancelledBlock } from './cancelled-block';
import { ErrorBlock } from './error-block';
import { QuestionCard } from './question-card';
import { SubagentAccordion } from './subagent-accordion';
import { TextBlock } from './text-block';
import { ThinkingBlock } from './thinking-block';
import { ToolCallCard } from './tool-call-card';
import { ToolResultCard } from './tool-result-card';
import { UserBlock } from './user-block';
import { WorkflowBlock } from './workflow-block';

interface BlockRegistryProps {
  block: Block;
}

export function BlockRegistry({ block }: BlockRegistryProps) {
  switch (block.kind) {
    case 'user':
      return (
        <UserBlock content={block.content} status={block.status} createdAt={block.createdAt} />
      );
    case 'text':
      return <TextBlock content={block.content} isStreaming={block.isStreaming} />;
    case 'thinking':
      return (
        <ThinkingBlock
          content={block.content}
          encrypted={block.encrypted}
          isStreaming={block.isStreaming}
        />
      );
    case 'tool_call':
      return (
        <ToolCallCard
          name={block.name}
          args={block.args}
          argsStreaming={block.argsStreaming}
          isStreaming={block.isStreaming}
        />
      );
    case 'tool_result':
      return (
        <ToolResultCard
          toolCallId={block.toolCallId}
          toolName={block.toolName}
          output={block.output}
          message={block.message}
          displayBlocks={block.displayBlocks}
          isError={block.isError}
          synthetic={block.synthetic}
        />
      );
    case 'approval_request':
      return (
        <ApprovalCard
          requestId={block.requestId}
          action={block.action}
          description={block.description}
          resolution={block.resolution}
        />
      );
    case 'question_request':
      return (
        <QuestionCard
          requestId={block.requestId}
          questions={block.questions}
          resolved={block.resolved}
          answers={block.answers}
          variant="inline"
        />
      );
    case 'error':
      return <ErrorBlock code={block.code} message={block.message} createdAt={block.createdAt} />;
    case 'cancelled':
      return <CancelledBlock createdAt={block.createdAt} />;
    case 'subagent':
      return (
        <SubagentAccordion
          parentToolCallId={block.parentToolCallId}
          blocks={block.blocks}
          isStreaming={block.isStreaming}
          subagentType={block.subagentType}
          description={block.description}
        />
      );
    case 'workflow':
      return <WorkflowBlock block={block} />;
    default:
      return null;
  }
}
