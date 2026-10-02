import { recordMockCall } from "../safety";

export default function FixtureLink({ href, children, onClick, ...props }) {
  return (
    <a
      href={String(href)}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        recordMockCall(`navigation:${String(href)}`);
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
