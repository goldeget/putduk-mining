import styles from "./workroom-app.module.css";
import { workroomSecondaryNavigation } from "../layout/workroom-navigation";
export function MemberSecondaryNavigation({ pathname }: { pathname: string }) {
  const navigation = workroomSecondaryNavigation(pathname);
  if (!navigation) return null;
  return (
    <nav className={styles.secondaryNav} aria-label={navigation.label}>
      {navigation.items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
