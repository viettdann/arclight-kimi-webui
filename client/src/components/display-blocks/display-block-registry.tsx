import type { DisplayBlock as DisplayBlockType } from 'shared/types';
import { BriefBlock } from './brief-block';
import { DiffBlock } from './diff-block';
import { ShellBlock } from './shell-block';
import { TodoBlock } from './todo-block';
import { UnknownBlock } from './unknown-block';

interface DisplayBlockRegistryProps {
  block: DisplayBlockType;
}

export function DisplayBlockRegistry({ block }: DisplayBlockRegistryProps) {
  switch (block.type) {
    case 'shell':
      return <ShellBlock command={block.command} language={block.language} />;
    case 'diff':
      return <DiffBlock path={block.path} oldText={block.oldText} newText={block.newText} />;
    case 'todo':
      return <TodoBlock items={block.items} />;
    case 'brief':
      return <BriefBlock text={block.text} />;
    default:
      return <UnknownBlock rawType={block.rawType} raw={block.raw} />;
  }
}
