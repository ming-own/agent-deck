import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DsText } from '@/components/ui/ds-text';
import type { SkillOption } from '@/service/sessionAgentApi';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  load: () => Promise<SkillOption[]>;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}

export function SkillPicker({ load, selected, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<SkillOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setCatalog(null);
    load()
      .then((items) => {
        if (active) setCatalog(items);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [load, attempt]);

  const missing = selected.filter(
    (id) => !catalog?.some((item) => item.id === id)
  );
  const options = [
    ...(catalog ?? []),
    ...missing.map((id) => ({
      id,
      name: catalog ? t('chat.session-agents-missing-skill', { name: id }) : id,
    })),
  ];
  return (
    <fieldset
      disabled={disabled}
      className="m-0 min-w-0 border-0 border-x-0 border-y-0 p-0"
    >
      <DsText as="legend" role="meta" weight="semibold" className="p-0">
        {t('chat.session-agents-skills')}
      </DsText>
      {failed ? (
        <div role="alert">
          <DsText role="base">
            {t('chat.session-agents-skill-load-error')}
          </DsText>
          <Button
            type="button"
            variant="text"
            size="sm"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t('chat.session-agents-retry')}
          </Button>
        </div>
      ) : catalog === null ? (
        <DsText role="meta" aria-live="polite">
          {t('chat.session-agents-skill-loading')}
        </DsText>
      ) : (
        !options.length && (
          <DsText role="meta">{t('chat.session-agents-skill-empty')}</DsText>
        )
      )}
      <div className="grid gap-x-ds-panel-inset gap-y-ds-4 pt-ds-8 sm:grid-cols-2">
        {options.map(({ id, name }) => {
          const checked = selected.includes(id);
          return (
            <label
              key={id}
              className="flex min-w-0 items-center gap-ds-control-gap py-ds-6"
            >
              <Checkbox
                aria-label={name}
                checked={checked}
                disabled={disabled || (!checked && selected.length >= 32)}
                onCheckedChange={(value) =>
                  onChange(
                    value === true
                      ? [...selected, id]
                      : selected.filter((item) => item !== id)
                  )
                }
              />
              <DsText role="base" className="break-words">
                {name}
              </DsText>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
