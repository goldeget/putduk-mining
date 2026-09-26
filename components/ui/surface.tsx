import type { HTMLAttributes } from "react";

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: "article" | "aside" | "div" | "section";
  tone?: "default" | "raised" | "sunken";
};

export function Surface({
  as: Component = "div",
  className = "",
  tone = "default",
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={`surface surface--${tone} ${className}`.trim()}
      {...props}
    />
  );
}
