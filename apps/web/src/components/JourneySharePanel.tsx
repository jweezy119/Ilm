'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, Download, FileText, QrCode, Share2, X } from 'lucide-react';
import QRCode from 'qrcode';
import type { JourneyGraph } from '@ilm/shared';
import { buildJourneyShareUrl, journeyToMarkdown } from '@/lib/journey-export';

/**
 * Social sharing, offline QR code generator, and Markdown study guide exporter
 * for a Journey.
 *
 * Generates the QR code 100% locally in the browser using `qrcode` — no third-
 * party QR API calls, no tracking, and works offline/locally.
 */
export function JourneySharePanel({
  graph,
  onClose,
}: {
  graph: JourneyGraph;
  onClose: () => void;
}) {
  const t = useTranslations('journeys');
  const locale = useLocale();

  const [origin, setOrigin] = useState('https://ilm.app');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
      setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    }
  }, []);

  const shareInfo = useMemo(
    () => buildJourneyShareUrl(origin, locale, graph),
    [origin, locale, graph]
  );

  useEffect(() => {
    let cancelled = false;
    if (!shareInfo.qrSafe) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(shareInfo.url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: { dark: '#18181b', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [shareInfo]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareInfo.url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Clipboard unavailable
    }
  }, [shareInfo.url]);

  const nativeShare = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.share) return;
    try {
      await navigator.share({
        title: graph.journey.name,
        text: graph.journey.description ?? t('shareText', { name: graph.journey.name, count: graph.nodes.length }),
        url: shareInfo.url,
      });
    } catch {
      // User dismissed share sheet
    }
  }, [graph.journey.name, graph.journey.description, graph.nodes.length, shareInfo.url, t]);

  const downloadQr = useCallback(() => {
    if (!qrDataUrl) return;
    const slug = graph.journey.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'journey';
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${slug}-qr.png`;
    a.click();
  }, [qrDataUrl, graph.journey.name]);

  const copyMarkdown = useCallback(async () => {
    try {
      const md = journeyToMarkdown(graph, shareInfo.url);
      await navigator.clipboard.writeText(md);
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2500);
    } catch {
      // Clipboard unavailable
    }
  }, [graph, shareInfo.url]);

  const downloadMarkdown = useCallback(() => {
    const md = journeyToMarkdown(graph, shareInfo.url);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const slug = graph.journey.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'journey';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [graph, shareInfo.url]);

  return (
    <section
      aria-label={t('shareHeading')}
      className="mb-6 rounded-2xl border border-line bg-panel/60 p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <QrCode className="h-4 w-4 text-accent" aria-hidden />
            {t('shareHeading')}
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">{t('shareBody')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="icon-btn shrink-0"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div className="flex flex-col items-center gap-2">
          {qrDataUrl ? (
            <>
              <div className="rounded-xl border border-line bg-white p-2.5 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt={t('qrAlt', { name: graph.journey.name })}
                  width={168}
                  height={168}
                  className="h-[168px] w-[168px]"
                />
              </div>
              <button
                type="button"
                onClick={downloadQr}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-accent"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {t('downloadQr')}
              </button>
            </>
          ) : (
            <p className="max-w-[12rem] rounded-xl border border-dashed border-line p-4 text-center text-xs text-fg-muted">
              {t('qrTooLong')}
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div>
            <label htmlFor="journey-share-url" className="mb-1 block text-xs font-medium text-fg-muted">
              {t('shareLinkLabel')}
            </label>
            <div className="flex gap-1.5">
              <input
                id="journey-share-url"
                readOnly
                value={shareInfo.url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-fg-muted"
              />
              <button
                type="button"
                onClick={copyLink}
                className="btn btn-primary shrink-0 px-3 py-1.5 text-xs"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copiedLink ? t('copied') : t('copyLink')}
              </button>
            </div>
            {!shareInfo.notesIncluded && graph.nodes.some((n) => n.note) ? (
              <p className="mt-1 text-[11px] text-fg-faint">{t('notesOmittedHint')}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {canNativeShare ? (
              <button type="button" onClick={nativeShare} className="btn btn-secondary px-3 py-1.5 text-xs">
                <Share2 className="h-3.5 w-3.5" aria-hidden />
                {t('shareNative')}
              </button>
            ) : null}
            <button type="button" onClick={copyMarkdown} className="btn btn-secondary px-3 py-1.5 text-xs">
              {copiedMd ? <Check className="h-3.5 w-3.5" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
              {copiedMd ? t('copied') : t('copyMarkdown')}
            </button>
            <button type="button" onClick={downloadMarkdown} className="btn btn-secondary px-3 py-1.5 text-xs">
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t('downloadMarkdown')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
