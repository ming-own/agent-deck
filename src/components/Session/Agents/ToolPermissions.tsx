import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DsText } from '@/components/ui/ds-text';
import type { AgentToolId, AgentToolPolicy } from '@/service/sessionAgentApi';
import { useTranslation } from 'react-i18next';

export const nodeTools: readonly AgentToolId[] = [
  'calculate',
  'utc_time',
  'read_skill_reference',
];

export function ToolPermissions({
  policy,
  onChange,
  disabled,
}: {
  policy: AgentToolPolicy;
  onChange: (policy: AgentToolPolicy) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-ds-stack-related">
      <DsText role="meta" weight="semibold">
        {t('chat.node-tools')}
      </DsText>
      {nodeTools.map((tool) => (
        <div
          key={tool}
          role="group"
          aria-label={t('chat.node-tool-' + tool)}
          className="flex flex-wrap items-center justify-between gap-ds-control-gap"
        >
          <DsText role="base">{t('chat.node-tool-' + tool)}</DsText>
          <div className="flex flex-wrap gap-ds-control-gap">
            {(['off', 'turn', 'allow'] as const).map((mode) => {
              const active = (policy[tool] ?? 'off') === mode;
              return (
                <Button
                  key={mode}
                  size="xs"
                  type="button"
                  variant={active ? 'secondary' : 'ghost'}
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => {
                    const next = { ...policy };
                    if (mode === 'off') delete next[tool];
                    else next[tool] = mode;
                    onChange(next);
                  }}
                >
                  {t('chat.node-tool-' + mode)}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TurnTools({
  policy,
  selected,
  onChange,
  disabled,
}: {
  policy: AgentToolPolicy;
  selected: AgentToolId[];
  onChange: (ids: AgentToolId[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const choices = nodeTools.filter((id) => policy[id] === 'turn');
  if (!choices.length) return null;
  return (
    <div
      role="group"
      aria-label={t('chat.node-tool-consent')}
      className="flex flex-wrap items-center gap-ds-control-gap"
    >
      <DsText role="meta" weight="semibold">
        {t('chat.node-tool-consent')}
      </DsText>
      {choices.map((id) => (
        <label
          key={id}
          className="flex items-center gap-ds-control-gap py-ds-4"
        >
          <Checkbox
            aria-label={t('chat.node-tool-' + id)}
            checked={selected.includes(id)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange(
                checked === true
                  ? [...selected, id]
                  : selected.filter((x) => x !== id)
              )
            }
          />
          <DsText role="base">{t('chat.node-tool-' + id)}</DsText>
        </label>
      ))}
    </div>
  );
}
