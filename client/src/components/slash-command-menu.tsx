import type { CommandInfo } from 'shared/commands';
import { cn } from '@/lib/utils';

interface SlashCommandMenuProps {
  /** Already-filtered, ordered flat list: Commands group first, then Skills. */
  items: CommandInfo[];
  /** Index into `items` of the keyboard-highlighted row. */
  activeIndex: number;
  /** Current filter token (without the leading slash), for match highlighting. */
  filter: string;
  onSelect: (cmd: CommandInfo) => void;
  onHover?: (index: number) => void;
}

const KIND_BADGE: Partial<Record<CommandInfo['kind'], string>> = {
  project: 'Project',
  skill: 'Skill',
};

/** Highlight the case-insensitive substring of `name` that matches `filter`. */
function HighlightedName({ name, filter }: { name: string; filter: string }) {
  if (!filter) return <>{`/${name}`}</>;
  const idx = name.toLowerCase().indexOf(filter.toLowerCase());
  if (idx < 0) return <>{`/${name}`}</>;
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + filter.length);
  const after = name.slice(idx + filter.length);
  return (
    <>
      {`/${before}`}
      <span className="text-primary">{match}</span>
      {after}
    </>
  );
}

function CommandRow({
  cmd,
  index,
  active,
  filter,
  onSelect,
  onHover,
}: {
  cmd: CommandInfo;
  index: number;
  active: boolean;
  filter: string;
  onSelect: (cmd: CommandInfo) => void;
  onHover?: (index: number) => void;
}) {
  const badge = KIND_BADGE[cmd.kind];
  return (
    <button
      type="button"
      // Keep textarea focus: selection runs on click, not on the mousedown that
      // would otherwise blur the composer.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={() => onHover?.(index)}
      onClick={() => onSelect(cmd)}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none',
        active ? 'bg-accent text-accent-foreground' : 'text-popover-foreground',
      )}
    >
      <span className="shrink-0 font-mono">
        <HighlightedName name={cmd.name} filter={filter} />
      </span>
      {cmd.argumentHint ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{cmd.argumentHint}</span>
      ) : null}
      {cmd.description ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {cmd.description}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {badge ? (
        <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function SlashCommandMenu({
  items,
  activeIndex,
  filter,
  onSelect,
  onHover,
}: SlashCommandMenuProps) {
  if (items.length === 0) return null;

  // Partition on kind. `items` is already ordered (commands before skills), so a
  // simple split preserves the incoming order within each group.
  const commands = items.filter((c) => c.kind === 'builtin' || c.kind === 'project');
  const skills = items.filter((c) => c.kind === 'skill');

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
      {commands.length > 0 && (
        <>
          <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
            Commands
          </div>
          {commands.map((cmd) => {
            const index = items.indexOf(cmd);
            return (
              <CommandRow
                key={cmd.name}
                cmd={cmd}
                index={index}
                active={index === activeIndex}
                filter={filter}
                onSelect={onSelect}
                onHover={onHover}
              />
            );
          })}
        </>
      )}

      {skills.length > 0 && (
        <>
          <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
            Skills
          </div>
          {skills.map((cmd) => {
            const index = items.indexOf(cmd);
            return (
              <CommandRow
                key={cmd.name}
                cmd={cmd}
                index={index}
                active={index === activeIndex}
                filter={filter}
                onSelect={onSelect}
                onHover={onHover}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
