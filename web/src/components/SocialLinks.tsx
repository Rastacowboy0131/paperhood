// Compact social link icons (website, X/twitter, telegram). Clicks open a new
// tab and stop propagation so parent rows keep their own navigation.

interface Props {
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  size?: number; // icon button size in px
}

function IconLink({ href, title, size, children }: { href: string; title: string; size: number; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center justify-center rounded-full border border-term-border text-term-dim transition-colors hover:bg-term-hover hover:text-term-text"
      style={{ width: size, height: size }}
    >
      {children}
    </a>
  );
}

export function SocialLinks({ website, twitter, telegram, size = 24 }: Props) {
  if (!website && !twitter && !telegram) return null;
  const svg = Math.round(size * 0.54);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {website && (
        <IconLink href={website} title="Website" size={size}>
          <svg viewBox="0 0 24 24" width={svg} height={svg} fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
          </svg>
        </IconLink>
      )}
      {twitter && (
        <IconLink href={twitter} title="X / Twitter" size={size}>
          <svg viewBox="0 0 24 24" width={svg - 2} height={svg - 2} fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </IconLink>
      )}
      {telegram && (
        <IconLink href={telegram} title="Telegram" size={size}>
          <svg viewBox="0 0 24 24" width={svg - 1} height={svg - 1} fill="currentColor">
            <path d="M21.9 4.4c.3-1.2-.9-2.2-2-1.7L2.7 9.9c-1.2.5-1.1 2.2.1 2.6l4.5 1.4 1.7 5.3c.3 1 1.6 1.3 2.3.5l2.4-2.4 4.5 3.3c.9.6 2.1.2 2.4-.9zM8.3 13.1l9.2-5.7c.3-.2.5.2.3.4l-7.4 6.9c-.3.3-.5.6-.5 1l-.2 2.1c0 .3-.4.3-.5 0l-1.1-3.5c-.1-.4 0-.9.2-1.2z" />
          </svg>
        </IconLink>
      )}
    </span>
  );
}
