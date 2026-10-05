import type { ReactNode } from "react";
import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ThemeControl } from "@/components/system/theme-control";
import { resolveDefaultStageInput } from "@/lib/mining-scene/default-stage";

import styles from "./auth-experience.module.css";

type AuthExperienceProps = {
  route: string;
  titleId: string;
  eyebrow: string;
  title: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
  children?: ReactNode;
  footer?: ReactNode;
  spacious?: boolean;
  state?: "loaded" | "error";
};

/** Static approved artwork only. It does not select a product or run mining. */
export function AuthArtwork() {
  const scene = resolveDefaultStageInput();
  if (!scene.productionAssetActive || !scene.master) return null;

  return (
    <picture className={styles.artwork}>
      {(["image/avif", "image/webp"] as const).flatMap((mimeType) => {
        const media = [...new Set(scene.responsiveSources.map((s) => s.media))];
        return media.flatMap((condition) => {
          const sources = scene.responsiveSources.filter(
            (source) =>
              source.mimeType === mimeType && source.media === condition,
          );
          if (!sources.length) return [];
          return [
            <source
              key={`${mimeType}-${condition}`}
              type={mimeType}
              media={condition || undefined}
              srcSet={sources
                .map((source) => `${source.assetPath} ${source.width}w`)
                .join(", ")}
              sizes="(min-width: 1100px) 54vw, (min-width: 768px) 75vw, 100vw"
            />,
          ];
        });
      })}
      {/* The allowlisted local derivative preserves the approved master material. */}
      <img
        src={scene.master.assetPath}
        width={scene.master.width}
        height={scene.master.height}
        alt=""
        fetchPriority="high"
        decoding="async"
      />
    </picture>
  );
}

export function AuthExperience({
  route,
  titleId,
  eyebrow,
  title,
  description,
  panelTitle,
  panelDescription,
  children,
  footer,
  spacious = false,
  state = "loaded",
}: AuthExperienceProps) {
  return (
    <main
      className={`${styles.root} ${spacious ? styles.spacious : ""}`}
      data-ui-ready={route}
      data-ui-state={state}
    >
      <div className={styles.stage}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="퍼뜩 채굴 홈">
            <BrandMark title="" />
            <span>
              <strong>퍼뜩</strong>
              <small>채굴</small>
            </span>
          </Link>
          <ThemeControl />
        </header>
        <div className={styles.composition} data-auth-layout="stage">
          <section className={styles.story} aria-labelledby={titleId}>
            <div className={styles.scene} aria-hidden="true">
              <AuthArtwork />
              <div className={styles.scrim} data-auth-scrim="" />
            </div>
            <div className={styles.storyCopy}>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1 id={titleId}>{title}</h1>
              <p className={styles.description}>{description}</p>
            </div>
          </section>
          <section className={styles.panel} aria-labelledby={`${titleId}-panel`}>
            <div className={styles.panelHeader}>
              <span className={styles.seal} aria-hidden="true">
                <PutdukIcon name="shield" size={24} />
              </span>
              <h2 id={`${titleId}-panel`}>{panelTitle}</h2>
              <p>{panelDescription}</p>
            </div>
            {children}
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </section>
        </div>
        <footer className={styles.pageFooter}>
          <Link href="/">퍼뜩 채굴 홈</Link>
          <span aria-hidden="true">·</span>
          <Link href="/recover">계정 복구</Link>
        </footer>
      </div>
    </main>
  );
}
