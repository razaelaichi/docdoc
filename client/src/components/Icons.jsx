// Small stroke icons, drawn on a 24px grid. Decorative: the text next to each icon carries the meaning.
const Icon = ({ children }) => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const AlertIcon = () => (
  <Icon>
    <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </Icon>
);

export const FlagIcon = () => (
  <Icon>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </Icon>
);

export const InfoIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.8v.1" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const FileIcon = () => (
  <Icon>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Icon>
);

export const NoteIcon = () => (
  <Icon>
    <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />
  </Icon>
);

export const ListIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6v.1M4.5 12v.1M4.5 18v.1" />
  </Icon>
);

export const UploadIcon = () => (
  <Icon>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Icon>
);

export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const RecordIcon = () => (
  <Icon>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M9 10h7M9 14h7M9 18h4" />
  </Icon>
);

// The brand mark: a page with a citation bracket
export const BrandMark = () => (
  <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--accent)" />
    <path d="M9.5 7H7.5v10h2M14.5 7h2v10h-2" fill="none" stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
