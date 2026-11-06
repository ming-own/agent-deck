import {
  RIGHT_RAIL_CONTENT_WIDTH_CLASS,
  RIGHT_RAIL_STACKED_CONTENT_WIDTH_CLASS,
} from '@/components/Layout/rightRail';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Keep the canvas interactive beside a node's properties. Chat keeps its dialog. */
export function NodeInspector({
  docked,
  inline,
  expanded,
  title,
  subtitle,
  busy,
  close,
  restoreFocus,
  children,
}: {
  docked?: boolean;
  inline?: boolean;
  expanded?: boolean;
  title: string;
  subtitle?: string;
  busy: boolean;
  close: () => void;
  restoreFocus?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation(),
    heading = useId(),
    panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (docked) panel.current?.focus({ preventScroll: true });
  }, [docked, title]);
  if (!docked)
    return (
      <Dialog
        open
        onOpenChange={(v) => {
          if (!v && !busy) close();
        }}
      >
        <DialogContent
          size="md"
          overlayVariant="dimmed"
          aria-describedby={undefined}
          showCloseButton={!busy}
          onCloseAutoFocus={(e) => {
            if (restoreFocus) {
              e.preventDefault();
              restoreFocus();
            }
          }}
        >
          <DialogHeader title={title} subtitle={subtitle} />
          {children}
        </DialogContent>
      </Dialog>
    );
  return (
    <aside
      ref={panel}
      aria-labelledby={heading}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented && !busy) {
          e.stopPropagation();
          close();
          restoreFocus?.();
        }
      }}
      className={
        (inline
          ? RIGHT_RAIL_STACKED_CONTENT_WIDTH_CLASS +
            (expanded ? ' h-2/3' : ' h-1/2') +
            ' relative shrink-0 border-x-0 border-y-0 border-t max-sm:absolute max-sm:inset-0 max-sm:h-full lg:h-auto lg:border-x-0 lg:border-y-0 lg:border-l'
          : RIGHT_RAIL_CONTENT_WIDTH_CLASS +
            ' absolute inset-y-0 right-0 border-y-0 border-r-0 border-l max-sm:w-full') +
        ' z-20 flex min-h-0 min-w-0 flex-col border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default outline-none'
      }
    >
      <header className="flex shrink-0 items-start justify-between gap-ds-control-gap p-ds-panel-inset">
        <div className="min-w-0">
          <DsText
            as="h2"
            id={heading}
            role="title"
            weight="semibold"
            className="break-words"
          >
            {title}
          </DsText>
          {subtitle && (
            <DsText role="meta" className="text-ds-ink-muted-default">
              {subtitle}
            </DsText>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          buttonContent="icon-only"
          disabled={busy}
          aria-label={t('layout.close')}
          title={t('layout.close')}
          onClick={() => {
            close();
            restoreFocus?.();
          }}
        >
          <DsIcon icon={X} />
        </Button>
      </header>
      {children}
    </aside>
  );
}
