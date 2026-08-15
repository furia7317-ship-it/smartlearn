export function PageHeader({
  title,
  desc,
  children,
  eyebrow = "学习工作台",
}: {
  title: string;
  desc?: string;
  children?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="web-page-header flex flex-wrap items-end justify-between gap-3">
      <div className="web-page-header__copy">
        <span className="web-page-header__eyebrow">{eyebrow}</span>
        <h1 className="font-display text-xl font-semibold tracking-tight">{title}</h1>
        {desc && (
          <p className="mt-1 text-[13px] text-muted-foreground">{desc}</p>
        )}
      </div>
      {children && <div className="web-page-header__actions flex items-center gap-2">{children}</div>}
    </div>
  );
}
