// Swipe down to close, for every bottom sheet (.sheet inside .sheet-backdrop).
//
// Installed once at start-up (main.jsx). It works on the page, so existing and future
// sheets get it without changing their code. Closing clicks the dimmed backdrop, which
// is exactly what tapping it already does, so each sheet's own onClose runs.
//
// Rules:
//  - Touch starts on the dimmed area or anywhere on the sheet. Taps still work: a touch
//    only becomes a drag after it moves down by more than START px.
//  - Mostly sideways moves are left alone (chips, carousels).
//  - If the touch is inside content that is scrolled down, the content scrolls first.
//    The sheet only starts to move once that content is back at the top.
//  - Letting go past CLOSE_AT px, or with a quick flick down, closes. Otherwise it springs back.

const START = 8; // px of downward movement before a touch counts as a drag
const CLOSE_AT = 110; // px dragged to close on release
const FLICK_SPEED = 0.6; // px per ms
const FLICK_MIN = 40; // a flick needs at least this much travel
const BACKDROP_ALPHA = 0.6; // matches .sheet-backdrop

const SKIP = "input[type=range], [data-no-sheet-drag]";

function scrolledAncestor(from, stopAt) {
  for (let el = from; el && el !== stopAt.parentElement; el = el.parentElement) {
    if (el.scrollTop > 0) {
      const oy = el.ownerDocument.defaultView.getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") return true;
    }
  }
  return false;
}

export function installSheetDrag(doc = document) {
  let g = null; // current gesture

  function reset(sheet, backdrop) {
    sheet.style.transform = "";
    sheet.style.transition = "";
    backdrop.style.backgroundColor = "";
  }

  function onStart(e) {
    if (e.touches.length !== 1) return;
    const t = e.target;
    if (!t.closest) return;
    const backdrop = t.closest(".sheet-backdrop");
    if (!backdrop) return;
    const sheet = t.closest(".sheet") || backdrop.querySelector(".sheet");
    if (!sheet || t.closest(SKIP)) return;
    const p = e.touches[0];
    g = { backdrop, sheet, target: t, x: p.clientX, y: p.clientY, t0: Date.now(), dragging: false, dy: 0, last: p.clientY, lastT: Date.now(), v: 0 };
  }

  function onMove(e) {
    if (!g) return;
    const p = e.touches[0];
    const dy = p.clientY - g.y;
    const dx = p.clientX - g.x;
    if (!g.dragging) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > START) { g = null; return; } // sideways
      if (dy < -START) { g = null; return; } // upward: normal scrolling
      if (dy <= START) return;
      if (g.target !== g.backdrop && scrolledAncestor(g.target, g.sheet)) { g = null; return; } // let content scroll
      g.dragging = true;
      g.sheet.style.transition = "none";
    }
    if (e.cancelable) e.preventDefault();
    const now = Date.now();
    const dt = now - g.lastT;
    if (dt > 0) g.v = (p.clientY - g.last) / dt;
    g.last = p.clientY;
    g.lastT = now;
    g.dy = Math.max(0, dy - START);
    g.sheet.style.transform = `translateY(${g.dy}px)`;
    const h = g.sheet.offsetHeight || 600;
    const fade = Math.max(0, 1 - g.dy / (h * 0.9));
    g.backdrop.style.backgroundColor = `rgba(6, 8, 11, ${(BACKDROP_ALPHA * fade).toFixed(3)})`;
  }

  function onEnd() {
    if (!g) return;
    const { sheet, backdrop, dragging, dy, v } = g;
    g = null;
    if (!dragging) return;
    const closing = dy > CLOSE_AT || (dy > FLICK_MIN && v > FLICK_SPEED);
    sheet.style.transition = "transform 0.2s ease";
    if (closing) {
      sheet.style.transform = "translateY(110%)";
      backdrop.style.backgroundColor = "rgba(6, 8, 11, 0)";
      setTimeout(() => {
        backdrop.click();
        // If the sheet is still on screen (its close did nothing), put it back.
        setTimeout(() => { if (sheet.isConnected) { reset(sheet, backdrop); } }, 60);
      }, 180);
    } else {
      sheet.style.transform = "translateY(0)";
      backdrop.style.backgroundColor = "";
      setTimeout(() => reset(sheet, backdrop), 220);
    }
  }

  doc.addEventListener("touchstart", onStart, { passive: true });
  doc.addEventListener("touchmove", onMove, { passive: false });
  doc.addEventListener("touchend", onEnd, { passive: true });
  doc.addEventListener("touchcancel", onEnd, { passive: true });

  return () => {
    doc.removeEventListener("touchstart", onStart);
    doc.removeEventListener("touchmove", onMove);
    doc.removeEventListener("touchend", onEnd);
    doc.removeEventListener("touchcancel", onEnd);
  };
}
