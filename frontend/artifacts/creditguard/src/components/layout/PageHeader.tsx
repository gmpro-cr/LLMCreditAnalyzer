import type { ReactNode } from "react";

/**
 * The ink band a page title sits on. Content that follows should be wrapped in
 * <PageBody> so its first panel overlaps the band's lower edge.
 */
export function PageHeader({
  title,
  subtitle,
  crumbs,
  actions,
  children,
  width = "max-w-[1440px]",
  flush = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  crumbs?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  width?: string;
  /** No overlap allowance: the band ends flush (used when tabs close it). */
  flush?: boolean;
}) {
  return (
    <section className="band">
      <div className={`mx-auto ${width} px-4 pt-7 sm:px-8 ${flush ? "" : "pb-24"}`}>
        {crumbs && <div className="mb-2 text-xs text-muted-foreground">{crumbs}</div>}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-[1_1_420px]">
            <h1 className="text-[30px] leading-[1.15] sm:text-[36px]">{title}</h1>
            {subtitle && <div className="mt-1.5 text-sm text-muted-foreground">{subtitle}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function PageBody({ children, width = "max-w-[1440px]", className = "" }: { children: ReactNode; width?: string; className?: string }) {
  return <div className={`relative mx-auto -mt-16 ${width} px-4 pb-16 sm:px-8 ${className}`}>{children}</div>;
}
