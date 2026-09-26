import type { ReactNode } from "react";

export function PageHeading({
  action,
  eyebrow,
  lead,
  title,
}: {
  action?: ReactNode;
  eyebrow: string;
  lead: string;
  title: string;
}) {
  return (
    <header className="product-page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </header>
  );
}
