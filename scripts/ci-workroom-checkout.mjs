import { execFileSync } from "node:child_process";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== "goldeget/putduk-mining" ||
  !/^[a-f0-9]{40}$/.test(process.env.CI_HEAD_SHA ?? "") ||
  git("rev-parse", "HEAD") !== process.env.CI_HEAD_SHA ||
  ![
    "https://github.com/goldeget/putduk-mining",
    "https://github.com/goldeget/putduk-mining.git",
  ].includes(git("remote", "get-url", "origin"))
)
  throw Error("WORKROOM_CHECKOUT_TARGET_REJECTED");
git(
  "remote",
  "set-url",
  "origin",
  "https://github.com/goldeget/putduk-mining.git",
);
