# Design Spec: Timeline Animation Bugs (Live Mode)

## Context

The live timeline uses per-dot CSS transitions to animate events drifting from right to left. Each dot mounts at a calculated percentage position, then a `requestAnimationFrame` callback sets a CSS transition to slide it to `-5%` (off-screen left) over the remaining time in the window.

This approach has pre-existing bugs unrelated to the rewind feature.

## Bug 1: Events animate at different speeds / pass each other

**Symptom:** Some dots visibly move faster than others, breaking chronological order. Events that should be behind overtake events ahead of them.

**Root cause:** Each dot independently computes `remainingMs = rangeMs - (Date.now() - event.timestamp)`. The `Date.now()` call happens sequentially in the `.map()` loop, so dots rendered later in the same frame get a slightly different `Date.now()`. More importantly, the ref callback fires in a `requestAnimationFrame` — by the time the rAF runs, additional milliseconds have elapsed since `remainingMs` was calculated. Each dot's rAF may fire at a slightly different time within the frame, compounding the skew.

**Why switching time range "fixes" it:** Changing the range bumps the generation counter, which remounts all dots with fresh keys. Every dot gets a new `Date.now()` call and a new rAF, resetting any accumulated timing drift.

**Core issue:** Per-dot timing calculations will always have micro-skew. The only way to guarantee uniform speed and preserve ordering is to animate all dots together (single animation source) rather than independently.

## Bug 2: Dots stall or move very slowly

**Symptom:** After running for a while, some dots appear to stop moving or creep along.

**Root cause:** The cleanup tick (5-second `setInterval`) triggers a React re-render. On re-render, React sets `style={{ left: newPosition }}` on each dot, overriding the CSS transition's current state. If the ref callback doesn't restart the animation (e.g., because of a guard like a WeakSet, or because the function identity changed), the dot has no active transition and just sits at whatever position React set.

Even without a guard, the ref callback restarting the animation creates a subtle issue: the dot snaps to the React-calculated position (small jump), then starts a fresh transition from there. Over many cleanup ticks, these micro-jumps accumulate.

**Core issue:** React's inline style and CSS transitions fight for control of the same `left` property. Every re-render disrupts the ongoing transition.

## Recommended approach: Single container animation

Instead of giving each dot its own CSS transition, animate the **container** that holds all dots. This eliminates every per-dot timing issue at once.

**Concept:**
- Record an `anchorTime` when the animation starts (or restarts)
- Position each dot at a static `left` percentage based on `(timestamp - anchorTime) / rangeMs * 100`
- Apply a single CSS animation or Web Animation on the container: `translateX(0)` to `translateX(-100%)` over `rangeMs`
- All dots move at exactly the same speed because they share one animation
- React re-renders only add/remove dots at static positions — they never interfere with the animation

**Why this works:**
- Speed accuracy: one animation, one rate, browser-controlled
- Ordering guarantee: dots have fixed relative positions, can never pass each other
- React compatibility: re-renders don't touch the animation
- Simplicity: no per-dot refs, no WeakSets, no timing calculations per dot

**Considerations:**
- The container animation needs periodic restart (every `rangeMs`) to re-anchor positions and clean up expired dots. The math cancels out so there's zero visual discontinuity on restart.
- New events arriving mid-cycle get positioned at `> 100%` of the container — off-screen right. The container's ongoing translation brings them into view naturally.
- The Web Animations API with `iterationComposite: 'accumulate'` can provide continuous infinite motion without looping, but browser support and edge cases around re-anchoring need careful testing.
- CSS `@keyframes` animation is an alternative that avoids the Web Animations API but is harder to restart cleanly.
- Tick marks (time labels) must be **outside** the animated container so they stay fixed while dots drift past them.
