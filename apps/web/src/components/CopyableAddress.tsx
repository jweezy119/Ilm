'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface CopyableAddressProps {
  address: string;
}

export function CopyableAddress({ address }: CopyableAddressProps) {
  const [copied, setCopied] = useState(false);
  const t = useTranslations('support');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback or ignore if clipboard API fails
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="mt-2 flex w-full items-center justify-between gap-3 rounded-md bg-bg-inset p-3 text-left transition-colors hover:bg-bg-subtle"
    >
      <code className="block flex-1 truncate text-xs text-fg">{address}</code>
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-accent" />
            <span className="text-accent">{t('addressCopied')}</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            <span>{t('copyAddress')}</span>
          </>
        )}
      </span>
    </button>
  );
}
