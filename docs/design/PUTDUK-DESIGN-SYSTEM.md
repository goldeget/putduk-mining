# PUTDUK Design System

## Quality target
PUTDUK must look like a mature, premium large-scale app/web product even in V1.

The visual language combines:
- fintech clarity
- premium digital/game immersion
- SaaS information discipline

It must not look like:
- a crypto landing-page template
- an emoji-heavy hobby project
- a cheap glassmorphism demo
- a UI generated from random gradients and cards
- an over-animated game advertisement

## Production icon policy
Do not use emoji as core UI icons.

Use:
- custom SVG for navigation
- custom SVG for actions/status
- SVG rank badges
- PUTDUK-specific AI mark
- illustration assets for events and empty states
- Motion/CSS for micro-interactions
- Three.js/R3F only for high-value mining scenes

## Token system
Minimum token families:
```text
background.*
surface.*
text.*
border.*
brand.*
status.*
world.*
spacing.*
radius.*
shadow.*
motion.*
z_index.*
```

Do not hardcode arbitrary visual values per page.

## Navigation
Mobile bottom navigation:
- 홈
- 채굴
- 자산
- 이벤트
- 메뉴

Each item uses a unified PUTDUK SVG icon family.

## Motion
Motion must explain state or improve perceived quality.
Avoid decoration-only motion that delays interaction.

Support:
- reduced-motion preference
- lower-performance devices
- graceful 3D → 2.5D fallback

## 3D
General app:
- 2D / 2.5D

Mining world:
- selective 3D

Use:
- lazy loading
- LOD
- compressed textures
- instancing
- capability detection
- effect reduction

## States
Every major screen needs:
- loading
- empty
- success
- warning
- error
- disabled
- offline/reconnecting where relevant

Never expose raw infrastructure/database error messages to users.

## Accessibility
- readable Korean typography
- adequate contrast
- generous tap areas
- keyboard navigation on desktop
- aria labels
- text scaling resilience
- reduced motion
