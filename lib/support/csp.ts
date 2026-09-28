/** Channel Talk 공식 CSP에 적힌 호스트만 공개 앱에 추가한다. */
export const channelTalkCsp = {
  connect:
    "https://*.channel.io https://*.channel.app https://*.sentry.io wss://*.channel.io wss://*.front-ws.channel.io wss://*.desk-ws.channel.io",
  font: "https://*.channel.io",
  frame: "frame-src 'self' https://*.channel.io https://*.channel.app",
  img: "https://*.channel.io https://*.cdninstagram.com",
  media: "media-src 'self' https://*.channel.io",
  script: "https://*.channel.io https://*.sentry-cdn.com",
} as const;
