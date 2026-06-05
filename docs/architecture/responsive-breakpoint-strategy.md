# Responsive Breakpoint Strategy
**Author:** Architect (APEX team)  
**Date:** 2026-06-05  
**Input:** Analyst audit `docs/requirements/responsive-audit.md` (3 CRITICAL, 4 HIGH, 7 MEDIUM findings)

---

## 1. Breakpoint Contract

| Token | `min-width` | Target devices | Key layout change |
|---|---|---|---|
| *(base)* | 0px | iPhone SE, narrow phones | Single-column; sidebar hidden |
| `xs` | 475px | Modern phones (iPhone 14 mini+) | ChatPanel wider; bubble max-w relaxed |
| `sm` | 640px | Large phones / small tablet portrait | Text padding increases; table visible |
| `md` | 768px | iPad portrait / large tablet | **Sidebar always visible** |
| `lg` | 1024px | iPad landscape / small laptop | Full two-column; wider content area |
| `xl` | 1280px | Desktop | Default design baseline |
| `2xl` | 1536px | Wide desktop | Max-width cap on chat content |

The `md` breakpoint (768px) is the **primary pivot**: below it the sidebar is a drawer, above it the sidebar is always in the DOM flow.

---

## 2. Tailwind Config Additions

Add a custom `xs` screen to `tailwind.config.ts`:

```ts
theme: {
  screens: {
    xs: '475px',   // add this; Tailwind defaults handle sm/md/lg/xl/2xl
  },
  extend: {
    // ... existing theme.extend stays here
  }
}
```

> **Why `extend` vs override:** Adding `screens` inside `theme` (not `theme.extend`) replaces Tailwind defaults. Instead, merge by adding `xs` into `theme.extend.screens` so `sm/md/lg/xl/2xl` remain.

Corrected form:

```ts
theme: {
  extend: {
    screens: {
      xs: '475px',
    },
    // ... rest of existing extend
  }
}
```

---

## 3. Mobile-First Class Conventions

**Rule:** Base class = mobile (0px+). Add responsive prefixes for larger screens only.

| Do | Don't |
|---|---|
| `px-3 sm:px-6` | `px-6` (no mobile version) |
| `w-full max-w-sm md:max-w-md` | `w-80` (fixed px width) |
| `flex-col md:flex-row` | `flex-row` (breaks mobile) |
| `text-sm md:text-base` | `text-base` (may be too large on 320px) |
| `hidden md:flex` | visibility without breakpoint guard |

**Container rule:** Never set a fixed `width` in `px` on any layout container. Use `w-full`, `max-w-*`, `min-w-0` (to allow flex-children to shrink).

**No horizontal overflow:** `html` and `body` must not have horizontal scroll. The root `flex h-screen overflow-hidden` in `app/page.tsx` is correct; preserve it and add `overflow-x-hidden` defensively to `:root` in `globals.css`.

---

## 4. Sidebar Collapse Pattern

### State
`app/page.tsx` owns a `sidebarOpen: boolean` state (default `false` on mobile, irrelevant on `md+`).

```tsx
// app/page.tsx
const [sidebarOpen, setSidebarOpen] = useState(false);
```

### Sidebar component (`components/home/Sidebar.tsx`)
```
Mobile (<md):  position: fixed, inset-y-0, left-0, z-50, w-64
               visibility controlled by sidebarOpen prop
               Close button (×) inside sidebar header, min 44×44px
Desktop (md+): position: static, flex, flex-shrink-0, w-64 (existing)
```

Tailwind pattern:
```tsx
<aside className={`
  fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300
  ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
  md:relative md:translate-x-0 md:z-auto
`}>
```

### Backdrop overlay (mobile only)
When sidebar is open on mobile, render a semi-transparent backdrop behind it:
```tsx
{sidebarOpen && (
  <div
    className="fixed inset-0 z-40 bg-black/40 md:hidden"
    onClick={() => setSidebarOpen(false)}
  />
)}
```

### Hamburger trigger (`components/home/ChatArea.tsx` header)
Add a hamburger button visible only below `md`. Minimum tap target 44×44px:
```tsx
<button
  className="flex md:hidden items-center justify-center w-11 h-11 -ml-2 rounded-lg"
  onClick={() => onToggleSidebar()}
  aria-label="Open navigation"
>
  <i className="ri-menu-line text-lg" />
</button>
```

---

## 5. ChatPanel Mobile Behaviour (Floating Widget)

`src/components/ChatPanel.tsx` currently uses `fixed bottom-24 right-6 w-96`.

**Replace with:**
```tsx
// Mobile: near-full-width, stays 1rem from each edge
// Tablet+: fixed 384px (w-96) anchored bottom-right
className="fixed bottom-20 right-2 left-2 xs:left-auto xs:right-6 z-40
           w-auto xs:w-96 max-w-[calc(100vw-1rem)]
           max-h-[calc(100dvh-6rem)]
           flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
```

Key changes:
- `left-2 right-2` on base (full-width minus 8px per side)
- `xs:left-auto xs:right-6` restores right-anchored position at 475px+
- `max-h-[calc(100dvh-6rem)]` uses `dvh` (dynamic viewport height) to account for mobile browser chrome/keyboard

---

## 6. Touch Target Rules

All interactive elements must meet **W3C minimum 44×44px** (WCAG 2.5.8 / Apple HIG):

| Element | Current | Required fix |
|---|---|---|
| Sidebar hamburger | — (new) | `w-11 h-11` (44px) ✓ |
| Sidebar close button | — (new) | `w-11 h-11` ✓ |
| ChatPanel header buttons (clear, close) | `w-7 h-7` (28px) | Wrap in `min-w-[44px] min-h-[44px]` or enlarge to `w-11 h-11` |
| Suggestion chips | ~36px height | Pad to `py-3` to reach 44px |
| FloatingButton | `w-14 h-14` (56px) | ✓ Already OK |
| ChatInput send button | varies | Ensure `min-h-[44px]` |

Apply `touch-action: manipulation` globally in `globals.css` to eliminate the 300ms tap delay on all interactive elements:
```css
button, a, input, select, textarea, [role="button"] {
  touch-action: manipulation;
}
```

---

## 7. Key Class Patterns by Component

| Component | Current problem | Correct pattern |
|---|---|---|
| `app/page.tsx` root | No mobile sidebar state | Add `sidebarOpen` state; pass to Sidebar + ChatArea |
| `Sidebar.tsx` | `w-64 flex-shrink-0` (never hides) | `fixed md:relative -translate-x-full md:translate-x-0` |
| `ChatArea.tsx` message list | `px-6 py-6` | `px-3 py-4 sm:px-6 sm:py-6` |
| `ChatArea.tsx` header | No hamburger | Add `<button className="md:hidden ...">` |
| `ChatPanel.tsx` | `w-96` overflows | See §5 above |
| `CaseResultList.tsx` | Table only | Stack cards at base, table at `sm:` |
| `MessageBubble.tsx` user bubble | `max-w-[72%]` too narrow | `max-w-[85%] xs:max-w-[75%] sm:max-w-[70%]` |
| `BotMessage.tsx` | `max-w-xs lg:max-w-md` missing sm step | `max-w-[90%] xs:max-w-xs sm:max-w-sm lg:max-w-md` |
| `UserMessage.tsx` | `max-w-xs` fills panel | `max-w-[85%] xs:max-w-xs` |

---

## 8. globals.css Additions

```css
/* Prevent horizontal body overflow on all viewports */
html, body { overflow-x: hidden; }

/* Eliminate 300ms tap delay on mobile */
button, a, input, select, textarea, [role="button"] {
  touch-action: manipulation;
}
```

No changes to existing CSS variables, animations, or scrollbar styles.

---

## 9. Acceptance Criteria (Architect sign-off gates)

The Frontend agent must satisfy these before the Tester runs task #10:

1. `320px`: zero horizontal page scroll; sidebar not visible; ChatPanel fits within viewport; no element clips.
2. `475px (xs)`: ChatPanel transitions to right-anchored mode.
3. `768px (md)`: sidebar permanently visible in DOM flow; hamburger hidden.
4. All tap targets ≥ 44px height and width.
5. `touch-action: manipulation` present on all interactive elements.
6. `max-h` uses `dvh` (not `vh`) where the mobile keyboard is relevant (ChatPanel, ChatArea input row).
7. No `w-{n}` fixed pixel width on any container element (only `max-w-*` allowed).
8. CaseResultList cards are readable (not horizontally scrolled) at 320px.

---

## 10. Out of Scope

- Backend / API routes — no changes.
- Business logic, types, hooks — no changes.
- Dark mode — deferred.
- Animation / transition timing beyond sidebar slide — deferred.
