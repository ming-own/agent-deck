import { Checkbox } from '@/components/ui/checkbox';
import { DsText } from '@/components/ui/ds-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
          <Select
            value={policy[tool] ?? 'off'}
            disabled={disabled}
            onValueChange={(mode) => {
              const next = { ...policy };
              if (mode === 'off') delete next[tool];
              else if (mode === 'allow' || mode === 'turn') next[tool] = mode;
              onChange(next);
            }}
          >
            <SelectTrigger size="sm" aria-label={t('chat.node-tool-' + tool)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent fitTrigger>
              {(['off', 'turn', 'allow'] as const).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t('chat.node-tool-' + mode)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
