"use client";

import { motion, useReducedMotion } from "motion/react";

export function MiningCore() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="mining-core" aria-label="PUTDUK 채굴 엔진 시각 체계 예시">
      <motion.div
        className="mining-core__orbit mining-core__orbit--outer"
        animate={reduceMotion ? false : { rotate: 360 }}
        transition={{ duration: 26, ease: "linear", repeat: Infinity }}
      >
        <span />
      </motion.div>
      <motion.div
        className="mining-core__orbit mining-core__orbit--inner"
        animate={reduceMotion ? false : { rotate: -360 }}
        transition={{ duration: 18, ease: "linear", repeat: Infinity }}
      >
        <span />
      </motion.div>
      <motion.div
        className="mining-core__body"
        animate={reduceMotion ? false : { y: [0, -5, 0] }}
        transition={{ duration: 4.5, ease: "easeInOut", repeat: Infinity }}
      >
        <svg viewBox="0 0 180 180" aria-hidden="true">
          <path d="m90 17 63 36.5v73L90 163l-63-36.5v-73L90 17Z" />
          <path d="m90 38 45 26v52l-45 26-45-26V64l45-26Z" />
          <path d="m61 105 36-42 22 24-36 40-22-22Z" />
          <path d="m69 106 14 13 28-32-14-15-28 34Z" />
        </svg>
      </motion.div>
      <div className="mining-core__datum mining-core__datum--top">
        <span>SERVER TIME</span>
        <strong>UTC</strong>
      </div>
      <div className="mining-core__datum mining-core__datum--bottom">
        <span>SETTLEMENT</span>
        <strong>IDEMPOTENT</strong>
      </div>
    </div>
  );
}
