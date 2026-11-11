import { RIGHT_RAIL_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

/** Keep the canvas interactive beside a node's properties. Chat keeps its dialog. */
export function NodeInspector({
  docked,
  inline,
  title,
  subtitle,
  busy,
  close,
  restoreFocus,
  children,
  actions,
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
  actions?: ReactNode;
}) {
  const { t } = useTranslation(),
    heading = useId(),
    panel = useRef<HTMLElement>(null);
  const restore = useRef(restoreFocus);
  useLayoutEffect(() => {
    restore.current = restoreFocus;
  }, [restoreFocus]);
  useEffect(() => {
    if (!docked) return;
    const opener = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (restore.current) restore.current();
      else if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, [docked]);
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
        }
      }}
      className={
        (inline
          ? RIGHT_RAIL_CONTENT_WIDTH_CLASS +
            ' relative shrink-0 border-y-0 border-r-0 border-l max-sm:w-full max-lg:absolute max-lg:inset-y-0 max-lg:right-0'
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
            className="line-clamp-2 break-words"
            title={title}
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
          }}
        >
          <DsIcon icon={X} />
        </Button>
      </header>
      {actions && (
        <div className="flex shrink-0 flex-wrap gap-ds-control-gap px-ds-panel-inset pb-ds-8">
          {actions}
        </div>
      )}
      {children}
    </aside>
  );
}
