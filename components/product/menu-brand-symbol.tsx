import { WorkroomMark } from "@/components/workroom/workroom-mark";

export function MenuBrandSymbol({
  className,
  idPrefix = "menu-hero-brand",
}: {
  className?: string;
  idPrefix?: string;
}) {
  return (
    <span className={className} data-brand-placement={idPrefix}>
      <WorkroomMark size={52} />
    </span>
  );
}
