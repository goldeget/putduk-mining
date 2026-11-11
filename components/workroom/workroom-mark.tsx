import { WORKROOM_MARK } from "./brand";

/** Pure mark: fixed brand colours and geometry, independent of the surrounding theme. */
export function WorkroomMark({ size = 44 }: { size?: number } = {}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={WORKROOM_MARK.viewBox}
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
    >
      <rect
        width="44"
        height="44"
        rx={WORKROOM_MARK.radius}
        fill={WORKROOM_MARK.background}
      />
      <path
        d={WORKROOM_MARK.path}
        fill="none"
        stroke={WORKROOM_MARK.stroke}
        strokeWidth={WORKROOM_MARK.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
