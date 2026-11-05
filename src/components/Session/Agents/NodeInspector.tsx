import { RIGHT_RAIL_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
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
  title,
  subtitle,
  busy,
  close,
  restoreFocus,
  children,
}: {
  docked?: boolean;
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
        RIGHT_RAIL_CONTENT_WIDTH_CLASS +
        ' absolute inset-y-0 right-0 z-20 flex min-w-0 flex-col border-y-0 border-r-0 border-l border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default outline-none max-sm:w-full'
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
